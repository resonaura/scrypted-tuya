#include "peer.hpp"
#include <iostream>
#include <regex>
#include <glaze/glaze.hpp>
#include "ipc/events.hpp"

namespace tuya {

WebRTCPeer::WebRTCPeer(const WebRTCConfig& config, std::shared_ptr<RTSPServer> rtsp_server, EventCallback event_cb)
    : config_(config), rtsp_server_(std::move(rtsp_server)), event_cb_(std::move(event_cb)) {}

WebRTCPeer::~WebRTCPeer() {
    stop();
}

bool WebRTCPeer::start() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (running_) return true;
    running_ = true;

    setup_peer_connection();

    keyframe_thread_ = std::thread(&WebRTCPeer::keyframe_loop, this);
    return true;
}

void WebRTCPeer::stop() {
    running_ = false;
    connected_ = false;

    if (keyframe_thread_.joinable()) {
        keyframe_thread_.join();
    }

    std::lock_guard<std::mutex> lock(mutex_);
    if (data_channel_) {
        try { data_channel_->close(); } catch (...) {}
        data_channel_.reset();
    }

    if (video_track_) {
        try { video_track_->close(); } catch (...) {}
        video_track_.reset();
    }

    if (audio_track_) {
        try { audio_track_->close(); } catch (...) {}
        audio_track_.reset();
    }

    if (pc_) {
        try { pc_->close(); } catch (...) {}
        pc_.reset();
    }
}

void WebRTCPeer::keyframe_loop() {
    while (running_) {
        std::this_thread::sleep_for(std::chrono::seconds(10));
        if (!running_) break;
        if (connected_) {
            request_keyframe();
        }
    }
}

void WebRTCPeer::setup_peer_connection() {
    rtc::Configuration rtc_cfg;

    for (const auto& ice : config_.ice_servers) {
        rtc::IceServer srv(ice.url);
        if (!ice.username.empty()) {
            srv.username = ice.username;
            srv.password = ice.password;
        }
        rtc_cfg.iceServers.push_back(srv);
    }

    rtc_cfg.bindAddress = "0.0.0.0";
    rtc_cfg.disableAutoNegotiation = false;

    pc_ = std::make_shared<rtc::PeerConnection>(rtc_cfg);

    pc_->onStateChange([this](rtc::PeerConnection::State state) {
        if (state == rtc::PeerConnection::State::Connected) {
            std::cout << "[WebRTCPeer] WebRTC Connected for " << config_.did << std::endl;
            connected_ = true;
            if (event_cb_) {
                event_cb_(to_json(EventWebRTCConnected{.did = config_.did}));
            }
        } else if (state == rtc::PeerConnection::State::Failed || state == rtc::PeerConnection::State::Closed) {
            std::cout << "[WebRTCPeer] WebRTC Disconnected for " << config_.did << std::endl;
            connected_ = false;
            if (event_cb_) {
                event_cb_(to_json(EventWebRTCDisconnected{.did = config_.did}));
            }
        }
    });

    pc_->onLocalDescription([this](rtc::Description desc) {
        std::string sdp = std::string(desc);

        // Remove a=extmap lines for Tuya camera hardware compatibility
        std::regex extmap_re(R"(\r?\na=extmap[^\r\n]*)");
        sdp = std::regex_replace(sdp, extmap_re, "");

        if (event_cb_) {
            event_cb_(to_json(EventWebRTCOffer{
                .did = config_.did,
                .sdp = sdp,
            }));
        }
    });

    pc_->onLocalCandidate([this](rtc::Candidate cand) {
        std::string cand_str = cand.candidate();
        if (event_cb_) {
            event_cb_(to_json(EventICECandidate{
                .did = config_.did,
                .candidate = cand_str,
                .mid = cand.mid(),
            }));
        }
    });

    pc_->onTrack([this](std::shared_ptr<rtc::Track> track) {
        auto desc = track->description();
        std::cout << "[WebRTCPeer] Received track: " << desc.type() << " mid=" << desc.mid() << std::endl;

        if (desc.type() == "video") {
            video_track_ = track;
            track->onMessage([this](rtc::message_variant msg) {
                if (std::holds_alternative<rtc::binary>(msg)) {
                    const auto& bin = std::get<rtc::binary>(msg);
                    if (rtsp_server_ && !bin.empty()) {
                        rtsp_server_->feed_raw_rtp(reinterpret_cast<const uint8_t*>(bin.data()), bin.size(), true);
                    }
                }
            });
        } else if (desc.type() == "audio") {
            audio_track_ = track;
            track->onMessage([this](rtc::message_variant msg) {
                if (std::holds_alternative<rtc::binary>(msg)) {
                    const auto& bin = std::get<rtc::binary>(msg);
                    if (rtsp_server_ && !bin.empty()) {
                        rtsp_server_->feed_raw_rtp(reinterpret_cast<const uint8_t*>(bin.data()), bin.size(), false);
                    }
                }
            });
        }
    });

    setup_tracks();
    pc_->setLocalDescription();
}

void WebRTCPeer::setup_tracks() {
    if (!pc_) return;

    // Add Audio Track (PCMU / 8000, SendRecv for Tuya backchannel support)
    rtc::Description::Audio audio_desc("audio", rtc::Description::Direction::SendRecv);
    audio_desc.addPCMUCodec(0);
    audio_desc.addPCMACodec(8);
    audio_desc.addOpusCodec(111);
    audio_track_ = pc_->addTrack(audio_desc);
    audio_track_->setMediaHandler(std::make_shared<rtc::RtcpReceivingSession>());

    audio_track_->onMessage([this](rtc::message_variant msg) {
        if (std::holds_alternative<rtc::binary>(msg)) {
            const auto& bin = std::get<rtc::binary>(msg);
            std::cout << "[WebRTCPeer] 🔊 Received RTP Audio Packet: " << bin.size() << " bytes" << std::endl;
            if (rtsp_server_ && !bin.empty()) {
                rtsp_server_->feed_raw_rtp(reinterpret_cast<const uint8_t*>(bin.data()), bin.size(), false);
            }
        }
    });

    // Add Video Track (H.264 / H.265, RecvOnly)
    rtc::Description::Video video_desc("video", rtc::Description::Direction::RecvOnly);
    video_desc.addH264Codec(96, "packetization-mode=1;profile-level-id=42001f");
    video_desc.addH264Codec(97, "packetization-mode=1;profile-level-id=42e01f");
    video_desc.addH265Codec(98);
    video_track_ = pc_->addTrack(video_desc);
    video_track_->setMediaHandler(std::make_shared<rtc::RtcpReceivingSession>());

    video_track_->onMessage([this](rtc::message_variant msg) {
        if (std::holds_alternative<rtc::binary>(msg)) {
            const auto& bin = std::get<rtc::binary>(msg);
            if (bin.size() >= 16) {
                std::ostringstream oss;
                for (size_t i = 0; i < 16 && i < bin.size(); i++) {
                    oss << std::hex << std::setw(2) << std::setfill('0') << (int)std::to_integer<uint8_t>(bin[i]) << " ";
                }
                std::cout << "[WebRTCPeer] 📹 RTP len=" << std::dec << bin.size() << " hex: " << oss.str() << std::endl;
            }
            if (rtsp_server_ && !bin.empty()) {
                rtsp_server_->feed_raw_rtp(reinterpret_cast<const uint8_t*>(bin.data()), bin.size(), true);
            }
        }
    });
}

void WebRTCPeer::setup_data_channel() {
    if (!pc_) return;

    rtc::DataChannelInit dc_init;
    dc_init.reliability.type = rtc::Reliability::Type::Rexmit;
    dc_init.reliability.rexmit = 5;
    dc_init.reliability.unordered = false;

    data_channel_ = pc_->createDataChannel("fmp4Stream", dc_init);

    data_channel_->onOpen([this]() {
        std::cout << "[WebRTCPeer] 🎉 DataChannel fmp4Stream OPENED for " << config_.did << std::endl;
        send_data_channel_msg("codec", "");
    });

    data_channel_->onClosed([this]() {
        std::cout << "[WebRTCPeer] DataChannel fmp4Stream CLOSED for " << config_.did << std::endl;
    });

    data_channel_->onError([this](std::string err) {
        std::cout << "[WebRTCPeer] DataChannel ERROR: " << err << std::endl;
    });

    data_channel_->onMessage([this](rtc::message_variant msg) {
        if (std::holds_alternative<std::string>(msg)) {
            const std::string& str = std::get<std::string>(msg);
            std::cout << "[WebRTCPeer] 📩 DataChannel text msg: " << str << std::endl;
            if (str.find("\"codec\"") != std::string::npos) {
                send_data_channel_msg("start", "frame");
            } else if (str.find("\"recv\"") != std::string::npos) {
                send_data_channel_msg("complete", "");
            }
        } else if (std::holds_alternative<rtc::binary>(msg)) {
            const auto& bin = std::get<rtc::binary>(msg);
            std::cout << "[WebRTCPeer] 📹 Received DataChannel binary RTP packet: " << bin.size() << " bytes" << std::endl;
            if (rtsp_server_ && !bin.empty()) {
                rtsp_server_->feed_raw_rtp(reinterpret_cast<const uint8_t*>(bin.data()), bin.size(), true);
            }
        }
    });
}

void WebRTCPeer::send_data_channel_msg(const std::string& type, const std::string& msg) {
    if (!data_channel_ || !data_channel_->isOpen()) return;
    std::string payload = "{\"type\":\"" + type + "\",\"msg\":\"" + msg + "\"}";
    std::cout << "[WebRTCPeer] 📤 Sending DataChannel message: " << payload << std::endl;
    try {
        data_channel_->send(payload);
    } catch (const std::exception& e) {
        std::cerr << "[WebRTCPeer] Failed to send DataChannel msg: " << e.what() << std::endl;
    }
}

void WebRTCPeer::set_remote_description(const std::string& raw_sdp, const std::string& type) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!pc_) return;
    try {
        std::string sdp = raw_sdp;

        // Fix 1: Missing newline between c= and m=
        sdp = std::regex_replace(sdp, std::regex(R"(0\.0\.0\.0m=)"), "0.0.0.0\r\nm=");

        // Fix 2: Strip IPv6 candidates
        sdp = std::regex_replace(sdp, std::regex(R"(\r?\na=candidate:[^\r\n]*:[^\r\n]*)"), "");

        // Fix 3: Malformed a=rtpmap:6001 AES/KCP 3
        sdp = std::regex_replace(sdp, std::regex(R"(\r?\na=rtpmap:6001\s+AES/KCP[^\r\n]*)"), "");

        // Fix 4: Malformed custom attributes not in WebRTC standard
        sdp = std::regex_replace(sdp, std::regex(R"(\r?\na=aes-key:[^\r\n]*)"), "");

        rtc::Description desc(sdp, type);
        pc_->setRemoteDescription(desc);
        std::cout << "[WebRTCPeer] Remote description successfully set (" << type << ")" << std::endl;

        // Also extract and add all candidates from the answer SDP if present
        std::istringstream stream(sdp);
        std::string line;
        std::string current_mid = "audio";
        while (std::getline(stream, line)) {
            if (line.rfind("a=mid:", 0) == 0) {
                current_mid = line.substr(6);
                while (!current_mid.empty() && (current_mid.back() == '\r' || current_mid.back() == '\n' || current_mid.back() == ' '))
                    current_mid.pop_back();
            } else if (line.rfind("a=candidate:", 0) == 0) {
                std::string cand_str = line.substr(2);
                while (!cand_str.empty() && (cand_str.back() == '\r' || cand_str.back() == '\n' || cand_str.back() == ' '))
                    cand_str.pop_back();
                try {
                    rtc::Candidate cand(cand_str, current_mid);
                    if (cand.family() != rtc::Candidate::Family::Ipv6) {
                        pc_->addRemoteCandidate(cand);
                        std::cout << "[WebRTCPeer] Added embedded ICE candidate: " << cand_str << " mid=" << current_mid << std::endl;
                    }
                } catch (const std::exception& e) {
                    std::cerr << "[WebRTCPeer] Candidate error: " << e.what() << std::endl;
                }
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[WebRTCPeer] Error setting remote description: " << e.what() << std::endl;
    }
}

void WebRTCPeer::add_remote_candidate(const std::string& candidate, const std::string& mid) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!pc_) return;
    try {
        std::string cand_cleaned = candidate;
        if (cand_cleaned.rfind("a=", 0) == 0) {
            cand_cleaned = cand_cleaned.substr(2);
        }
        while (!cand_cleaned.empty() && (cand_cleaned.back() == '\r' || cand_cleaned.back() == '\n' || cand_cleaned.back() == ' '))
            cand_cleaned.pop_back();

        if (cand_cleaned.empty()) return;

        std::string target_mid = mid.empty() ? "audio" : mid;
        rtc::Candidate cand(cand_cleaned, target_mid);
        if (cand.family() != rtc::Candidate::Family::Ipv6) {
            pc_->addRemoteCandidate(cand);
            std::cout << "[WebRTCPeer] Added remote ICE candidate: " << cand_cleaned << " mid=" << target_mid << std::endl;
        }
    } catch (const std::exception& e) {
        std::cerr << "[WebRTCPeer] Error adding remote candidate: " << e.what() << std::endl;
    }
}

void WebRTCPeer::request_keyframe() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (video_track_ && video_track_->isOpen()) {
        try {
            video_track_->requestKeyframe();
            std::cout << "[WebRTCPeer] 🔑 Sent RTCP PLI/FIR keyframe request" << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "[WebRTCPeer] Keyframe request error: " << e.what() << std::endl;
        }
    }
    if (data_channel_ && data_channel_->isOpen()) {
        send_data_channel_msg("keyframe", "");
    }
}

void WebRTCPeer::set_quality(int channel) {
    send_data_channel_msg("quality", std::to_string(channel));
}

void WebRTCPeer::ptz(int action, int speed) {
    send_data_channel_msg("ptz", "{\"action\":" + std::to_string(action) + ",\"speed\":" + std::to_string(speed) + "}");
}

}  // namespace tuya
