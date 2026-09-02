#include "server.hpp"
#include <iostream>
#include <sstream>
#include <cstring>
#include <unistd.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <algorithm>

namespace tuya {

RTSPServer::RTSPServer(int port, const std::string& path, KeyframeCallback kf_cb, bool is_hevc)
    : port_(port), path_(path), kf_req_cb_(std::move(kf_cb)), is_hevc_(is_hevc) {}

RTSPServer::~RTSPServer() {
    stop();
}

bool RTSPServer::start() {
    server_fd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd_ < 0)
        return false;

    int opt = 1;
    setsockopt(server_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port_);

    if (bind(server_fd_, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        close(server_fd_);
        server_fd_ = -1;
        return false;
    }

    if (listen(server_fd_, 16) < 0) {
        close(server_fd_);
        server_fd_ = -1;
        return false;
    }

    running_ = true;
    accept_thread_ = std::thread(&RTSPServer::accept_loop, this);
    return true;
}

void RTSPServer::stop() {
    running_ = false;
    if (server_fd_ >= 0) {
        close(server_fd_);
        server_fd_ = -1;
    }
    if (accept_thread_.joinable()) {
        accept_thread_.join();
    }

    std::lock_guard<std::mutex> lock(clients_mutex_);
    for (auto& [fd, session] : clients_) {
        close(fd);
    }
    clients_.clear();
}

void RTSPServer::accept_loop() {
    while (running_) {
        sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);
        int client_fd = accept(server_fd_, (struct sockaddr*)&client_addr, &client_len);
        if (client_fd < 0) {
            if (!running_)
                break;
            usleep(10000);
            continue;
        }

        std::thread([this, client_fd]() { client_loop(client_fd); }).detach();
    }
}

void RTSPServer::client_loop(int client_fd) {
    RTSPClientSession session;
    session.socket_fd = client_fd;
    session.session_id = std::to_string(reinterpret_cast<uintptr_t>(this) ^ static_cast<uintptr_t>(client_fd));

    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        clients_[client_fd] = session;
    }

    char buffer[4096];
    std::string request_acc;

    while (running_) {
        ssize_t n = recv(client_fd, buffer, sizeof(buffer) - 1, 0);
        if (n <= 0)
            break;

        buffer[n] = '\0';
        request_acc.append(buffer, n);

        size_t pos;
        while ((pos = request_acc.find("\r\n\r\n")) != std::string::npos) {
            std::string req = request_acc.substr(0, pos + 4);
            request_acc.erase(0, pos + 4);
            handle_rtsp_request(client_fd, req, session);
        }
    }

    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        clients_.erase(client_fd);
    }
    close(client_fd);
}

static std::string base64_encode(const uint8_t* data, size_t len) {
    static const char tbl[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string ret;
    int val = 0, valb = -6;
    for (size_t i = 0; i < len; ++i) {
        val = (val << 8) + data[i];
        valb += 8;
        while (valb >= 0) {
            ret.push_back(tbl[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) ret.push_back(tbl[((val << 8) >> (valb + 8)) & 0x3F]);
    while (ret.size() % 4) ret.push_back('=');
    return ret;
}

void RTSPServer::handle_rtsp_request(int client_fd, const std::string& req, RTSPClientSession& session) {
    std::istringstream stream(req);
    std::string method, url, version;
    stream >> method >> url >> version;

    std::string cseq = "1";
    std::string line;
    while (std::getline(stream, line)) {
        if (line.find("CSeq:") != std::string::npos || line.find("Cseq:") != std::string::npos) {
            size_t colon = line.find(':');
            if (colon != std::string::npos) {
                cseq = line.substr(colon + 1);
                cseq.erase(0, cseq.find_first_not_of(" \t\r\n"));
                cseq.erase(cseq.find_last_not_of(" \t\r\n") + 1);
            }
        }
    }

    std::ostringstream resp;

    if (method == "OPTIONS") {
        resp << "RTSP/1.0 200 OK\r\n"
             << "CSeq: " << cseq << "\r\n"
             << "Public: OPTIONS, DESCRIBE, SETUP, PLAY, PAUSE, TEARDOWN\r\n\r\n";
    } else if (method == "DESCRIBE") {
        std::ostringstream sdp;
        sdp << "v=0\r\n"
            << "o=- " << session.session_id << " 1 IN IP4 127.0.0.1\r\n"
            << "s=Tuya Native Stream\r\n"
            << "t=0 0\r\n"
            << "a=control:*\r\n"
            << "m=video 0 RTP/AVP 96\r\n";
        if (is_hevc_) {
            sdp << "a=rtpmap:96 H265/90000\r\n";
            std::lock_guard<std::mutex> param_lock(param_mutex_);
            if (!vps_pkt_.empty() && !sps_pkt_.empty() && !pps_pkt_.empty()) {
                std::string b64_vps = base64_encode(vps_pkt_.data() + 12, vps_pkt_.size() - 12);
                std::string b64_sps = base64_encode(sps_pkt_.data() + 12, sps_pkt_.size() - 12);
                std::string b64_pps = base64_encode(pps_pkt_.data() + 12, pps_pkt_.size() - 12);
                sdp << "a=fmtp:96 sprop-vps=" << b64_vps << ";sprop-sps=" << b64_sps << ";sprop-pps=" << b64_pps << "\r\n";
            }
        } else {
            sdp << "a=rtpmap:96 H264/90000\r\n"
                << "a=fmtp:96 packetization-mode=1;profile-level-id=42001f\r\n";
        }
        sdp << "a=control:track0\r\n"
            << "m=audio 0 RTP/AVP 0\r\n"
            << "a=rtpmap:0 PCMU/8000\r\n"
            << "a=control:track1\r\n";

        std::string sdp_str = sdp.str();
        resp << "RTSP/1.0 200 OK\r\n"
             << "CSeq: " << cseq << "\r\n"
             << "Content-Type: application/sdp\r\n"
             << "Content-Length: " << sdp_str.length() << "\r\n\r\n"
             << sdp_str;
    } else if (method == "SETUP") {
        std::string transport = "";
        bool is_tcp = false;
        size_t tr_pos = req.find("Transport:");
        if (tr_pos == std::string::npos) tr_pos = req.find("transport:");
        if (tr_pos != std::string::npos) {
            size_t eol = req.find("\r\n", tr_pos);
            std::string tr_line = req.substr(tr_pos, eol - tr_pos);
            size_t il_pos = tr_line.find("interleaved=");
            if (il_pos != std::string::npos || tr_line.find("RTP/AVP/TCP") != std::string::npos) {
                is_tcp = true;
                bool is_audio = (url.find("track1") != std::string::npos || url.find("audio") != std::string::npos);
                int rtp_ch = is_audio ? 2 : 0;
                int rtcp_ch = rtp_ch + 1;
                if (il_pos != std::string::npos) {
                    sscanf(tr_line.c_str() + il_pos, "interleaved=%d-%d", &rtp_ch, &rtcp_ch);
                }
                if (is_audio) {
                    session.audio_rtp_channel = static_cast<uint8_t>(rtp_ch);
                    session.audio_rtcp_channel = static_cast<uint8_t>(rtcp_ch);
                } else {
                    session.video_rtp_channel = static_cast<uint8_t>(rtp_ch);
                    session.video_rtcp_channel = static_cast<uint8_t>(rtcp_ch);
                }
                transport = "RTP/AVP/TCP;unicast;interleaved=" + std::to_string(rtp_ch) + "-" + std::to_string(rtcp_ch);
            }
        }

        if (!is_tcp) {
            // Immediately reject UDP with 461 so VLC / Live555 falls back to TCP interleaved instantaneously (<10ms)
            resp << "RTSP/1.0 461 Unsupported Transport\r\n"
                 << "CSeq: " << cseq << "\r\n\r\n";
            std::string resp_str = resp.str();
            send(client_fd, resp_str.data(), resp_str.length(), 0);
            return;
        }

        {
            std::lock_guard<std::mutex> lock(clients_mutex_);
            clients_[client_fd] = session;
        }
        resp << "RTSP/1.0 200 OK\r\n"
             << "CSeq: " << cseq << "\r\n"
             << "Session: " << session.session_id << ";timeout=60\r\n"
             << "Transport: " << transport << "\r\n\r\n";
    } else if (method == "PLAY") {
        session.is_playing = true;
        session.wait_idr = true; // Wait for clean keyframe start so zero image artifacts
        {
            std::lock_guard<std::mutex> lock(clients_mutex_);
            clients_[client_fd] = session;
        }

        resp << "RTSP/1.0 200 OK\r\n"
             << "CSeq: " << cseq << "\r\n"
             << "Session: " << session.session_id << "\r\n"
             << "Range: npt=0.000-\r\n"
             << "RTP-Info: url=" << url << "\r\n\r\n";

        std::string resp_str = resp.str();
        send(client_fd, resp_str.data(), resp_str.length(), 0);

        // Prime late RTSP clients from the last complete parameter-set + IDR cache.
        // This avoids waiting for the camera's next GOP before VLC/Scrypted can decode.
        std::vector<std::vector<uint8_t>> cached_idr;
        {
            std::lock_guard<std::mutex> cache_lock(idr_cache_mutex_);
            cached_idr = idr_cache_pkts_;
        }
        if (!cached_idr.empty()) {
            std::lock_guard<std::mutex> clients_lock(clients_mutex_);
            auto it = clients_.find(client_fd);
            if (it != clients_.end() && it->second.is_playing) {
                for (const auto& packet : cached_idr) {
                    send_interleaved_packet(client_fd, it->second.video_rtp_channel, packet.data(), packet.size());
                }
                it->second.wait_idr = false;
            }
        }

        // Also ask for a fresh keyframe so the cached GOP is replaced immediately.
        if (kf_req_cb_) kf_req_cb_();
        return;
    } else if (method == "TEARDOWN") {
        session.is_playing = false;
        resp << "RTSP/1.0 200 OK\r\n"
             << "CSeq: " << cseq << "\r\n\r\n";
    }

    std::string resp_str = resp.str();
    send(client_fd, resp_str.data(), resp_str.length(), 0);
}

void RTSPServer::send_interleaved_packet(int fd, uint8_t channel, const uint8_t* rtp_data, size_t len) {
    uint8_t header[4];
    header[0] = '$';
    header[1] = channel;
    header[2] = static_cast<uint8_t>((len >> 8) & 0xFF);
    header[3] = static_cast<uint8_t>(len & 0xFF);

    std::vector<uint8_t> packet;
    packet.reserve(4 + len);
    packet.insert(packet.end(), header, header + 4);
    packet.insert(packet.end(), rtp_data, rtp_data + len);

    send(fd, packet.data(), packet.size(), MSG_NOSIGNAL);
}

void RTSPServer::feed_frame(const MediaFrame& frame) {
    if (frame.is_video) {
        if (frame.is_keyframe) {
            std::lock_guard<std::mutex> lock(gop_mutex_);
            gop_cache_.clear();
            has_keyframe_ = true;
        }

        if (has_keyframe_) {
            std::lock_guard<std::mutex> lock(gop_mutex_);
            gop_cache_.push_back(frame);
            if (gop_cache_.size() > 120)
                gop_cache_.erase(gop_cache_.begin());
        }

        packetize_and_send_video(frame.data.data(), frame.data.size(), frame.timestamp_ms * 90, frame.is_keyframe);
    } else {
        packetize_and_send_audio(frame.data.data(), frame.data.size(), frame.timestamp_ms * 16);
    }
}

void RTSPServer::packetize_and_send_video(const uint8_t* nalu, size_t len, uint32_t ts_90k, bool /*is_key*/) {
    if (len == 0)
        return;

    std::lock_guard<std::mutex> lock(clients_mutex_);
    for (auto& [fd, session] : clients_) {
        if (!session.is_playing)
            continue;

        // Standard RTP Header (12 bytes)
        uint8_t rtp_header[12];
        rtp_header[0] = 0x80;
        rtp_header[1] = 96;  // Dynamic H.265 Payload Type
        rtp_header[2] = (session.video_seq >> 8) & 0xFF;
        rtp_header[3] = session.video_seq & 0xFF;
        session.video_seq++;

        rtp_header[4] = (ts_90k >> 24) & 0xFF;
        rtp_header[5] = (ts_90k >> 16) & 0xFF;
        rtp_header[6] = (ts_90k >> 8) & 0xFF;
        rtp_header[7] = ts_90k & 0xFF;

        rtp_header[8] = 0x12;
        rtp_header[9] = 0x34;
        rtp_header[10] = 0x56;
        rtp_header[11] = 0x78;  // SSRC

        // If fits in single MTU (<= 1400)
        if (len <= 1400) {
            rtp_header[1] |= 0x80;  // Marker bit
            std::vector<uint8_t> rtp_packet(12 + len);
            std::memcpy(rtp_packet.data(), rtp_header, 12);
            std::memcpy(rtp_packet.data() + 12, nalu, len);
            send_interleaved_packet(fd, session.video_rtp_channel, rtp_packet.data(), rtp_packet.size());
        } else {
            // Fragmentation Unit (FU)
            uint8_t nal_type = (nalu[0] & 0x7E) >> 1;
            size_t offset = 2;  // HEVC 2-byte header
            size_t remaining = len - offset;
            bool first = true;

            while (remaining > 0) {
                size_t chunk = std::min<size_t>(remaining, 1400);
                bool last = (chunk == remaining);

                rtp_header[2] = (session.video_seq >> 8) & 0xFF;
                rtp_header[3] = session.video_seq & 0xFF;
                session.video_seq++;

                if (last)
                    rtp_header[1] |= 0x80;
                else
                    rtp_header[1] &= 0x7F;

                uint8_t fu_header[3];
                fu_header[0] = (49 << 1);  // HEVC FU type 49
                fu_header[1] = 1;
                fu_header[2] = (first ? 0x80 : 0x00) | (last ? 0x40 : 0x00) | (nal_type & 0x3F);

                std::vector<uint8_t> rtp_packet(12 + 3 + chunk);
                std::memcpy(rtp_packet.data(), rtp_header, 12);
                std::memcpy(rtp_packet.data() + 12, fu_header, 3);
                std::memcpy(rtp_packet.data() + 15, nalu + offset, chunk);

                send_interleaved_packet(fd, session.video_rtp_channel, rtp_packet.data(), rtp_packet.size());

                offset += chunk;
                remaining -= chunk;
                first = false;
            }
        }
    }
}

void RTSPServer::packetize_and_send_audio(const uint8_t* data, size_t len, uint32_t ts_samples) {
    if (len == 0)
        return;

    std::lock_guard<std::mutex> lock(clients_mutex_);
    for (auto& [fd, session] : clients_) {
        if (!session.is_playing)
            continue;

        uint8_t rtp_header[12 + 4];
        rtp_header[0] = 0x80;
        rtp_header[1] = 97 | 0x80;  // AAC Payload Type with Marker
        rtp_header[2] = (session.audio_seq >> 8) & 0xFF;
        rtp_header[3] = session.audio_seq & 0xFF;
        session.audio_seq++;

        rtp_header[4] = (ts_samples >> 24) & 0xFF;
        rtp_header[5] = (ts_samples >> 16) & 0xFF;
        rtp_header[6] = (ts_samples >> 8) & 0xFF;
        rtp_header[7] = ts_samples & 0xFF;

        rtp_header[8] = 0x98;
        rtp_header[9] = 0x76;
        rtp_header[10] = 0x54;
        rtp_header[11] = 0x32;  // Audio SSRC

        // AU Header for AAC-hbr
        rtp_header[12] = 0x00;
        rtp_header[13] = 0x10;  // AU-headers-length (16 bits = 2 bytes)
        rtp_header[14] = (len >> 5) & 0xFF;
        rtp_header[15] = ((len & 0x1F) << 3);

        std::vector<uint8_t> rtp_packet(16 + len);
        std::memcpy(rtp_packet.data(), rtp_header, 16);
        std::memcpy(rtp_packet.data() + 16, data, len);

        send_interleaved_packet(fd, session.audio_rtp_channel, rtp_packet.data(), rtp_packet.size());
    }
}

void RTSPServer::feed_raw_rtp(const uint8_t* data, size_t len, bool is_video) {
    if (!data || len < 14) return;

    if (!is_video) {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        for (auto& [fd, session] : clients_) {
            if (!session.is_playing) continue;
            send_interleaved_packet(fd, session.audio_rtp_channel, data, len);
        }
        return;
    }

    // Video packet processing
    uint8_t nal_type = (data[12] >> 1) & 0x3F;
    std::vector<uint8_t> rtp_out;

    if (nal_type == 32 || nal_type == 33 || nal_type == 34) {
        // Parameter sets (VPS / SPS / PPS)
        {
            std::lock_guard<std::mutex> param_lock(param_mutex_);
            if (nal_type == 32) {
                vps_pkt_.assign(data, data + len);
                collecting_idr_ = true;
                current_idr_pkts_.clear();
            } else if (nal_type == 33) {
                sps_pkt_.assign(data, data + len);
            } else if (nal_type == 34) {
                pps_pkt_.assign(data, data + len);
            }
        }
        rtp_out.assign(data, data + len);
        if (collecting_idr_) {
            current_idr_pkts_.push_back(rtp_out);
        }
    } else if (nal_type == 30 || nal_type == 14) {
        // Fragmented HEVC packet from Tuya
        uint8_t fu_header = data[13];
        bool start_bit = (fu_header & 0x80) != 0;
        bool end_bit = (fu_header & 0x40) != 0;
        uint8_t real_nal = (nal_type == 30) ? 19 : 1;

        size_t payload_offset = start_bit ? 15 : 14;
        if (len > payload_offset) {
            size_t payload_len = len - payload_offset;
            rtp_out.resize(15 + payload_len);
            // Copy 12-byte RTP header
            std::memcpy(rtp_out.data(), data, 12);
            // Standard RFC 7798 HEVC FU Header
            rtp_out[12] = 0x62; // FU type 49, LayerId high = 0
            rtp_out[13] = 0x01; // LayerId low = 0, TID = 1
            rtp_out[14] = (start_bit ? 0x80 : 0x00) | (end_bit ? 0x40 : 0x00) | (real_nal & 0x3F);
            std::memcpy(rtp_out.data() + 15, data + payload_offset, payload_len);
        }

        if (nal_type == 30 && collecting_idr_ && !rtp_out.empty()) {
            current_idr_pkts_.push_back(rtp_out);
            if (end_bit) {
                collecting_idr_ = false;
                std::lock_guard<std::mutex> lock(idr_cache_mutex_);
                idr_cache_pkts_ = current_idr_pkts_;
            }
        }
    } else {
        // Single NAL unit (e.g. NAL 1 unfragmented)
        rtp_out.assign(data, data + len);
    }

    if (rtp_out.empty()) return;

    bool is_param_set = (nal_type == 32 || nal_type == 33 || nal_type == 34);
    bool is_idr_frag = (nal_type == 30);
    bool is_idr_start = is_idr_frag && ((data[13] & 0x80) != 0);
    bool is_idr_end = is_idr_frag && ((data[13] & 0x40) != 0);

    std::lock_guard<std::mutex> lock(clients_mutex_);
    for (auto& [fd, session] : clients_) {
        if (!session.is_playing) continue;

        if (session.wait_idr) {
            if (is_idr_start) {
                // Send cached parameter sets (VPS, SPS, PPS) right before IDR so decoder is immediately primed
                std::lock_guard<std::mutex> plock(param_mutex_);
                if (!vps_pkt_.empty()) send_interleaved_packet(fd, session.video_rtp_channel, vps_pkt_.data(), vps_pkt_.size());
                if (!sps_pkt_.empty()) send_interleaved_packet(fd, session.video_rtp_channel, sps_pkt_.data(), sps_pkt_.size());
                if (!pps_pkt_.empty()) send_interleaved_packet(fd, session.video_rtp_channel, pps_pkt_.data(), pps_pkt_.size());
            }

            if (is_param_set || is_idr_frag) {
                send_interleaved_packet(fd, session.video_rtp_channel, rtp_out.data(), rtp_out.size());
                if (is_idr_end) {
                    session.wait_idr = false; // Successfully synchronized on a clean keyframe!
                }
            }
            // Do not forward P-slices to clients waiting for an IDR
            continue;
        }

        // For synchronized clients, forward all frames
        send_interleaved_packet(fd, session.video_rtp_channel, rtp_out.data(), rtp_out.size());
    }
}

}  // namespace tuya
