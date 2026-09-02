#pragma once

#include <string>
#include <vector>
#include <memory>
#include <thread>
#include <atomic>
#include <mutex>
#include <unordered_map>
#include <netinet/in.h>
#include "../media/reassembler.hpp"

namespace tuya {

struct RTSPClientSession {
    int socket_fd = -1;
    std::string session_id;
    bool is_playing = false;
    bool wait_idr = true;
    uint8_t video_rtp_channel = 0;
    uint8_t video_rtcp_channel = 1;
    uint8_t audio_rtp_channel = 2;
    uint8_t audio_rtcp_channel = 3;
    uint16_t video_seq = 0;
    uint16_t audio_seq = 0;
    bool sent_gop = false;
};

class RTSPServer {
public:
    using KeyframeCallback = std::function<void()>;

    RTSPServer(int port, const std::string& path, KeyframeCallback kf_cb = nullptr, bool is_hevc = true);
    ~RTSPServer();

    bool start();
    void stop();

    void feed_frame(const MediaFrame& frame);
    void feed_raw_rtp(const uint8_t* data, size_t len, bool is_video);

    int get_port() const { return port_; }
    const std::string& get_path() const { return path_; }

private:
    void accept_loop();
    void client_loop(int client_fd);
    void handle_rtsp_request(int client_fd, const std::string& req, RTSPClientSession& session);

    void send_interleaved_packet(int fd, uint8_t channel, const uint8_t* rtp_data, size_t len);
    void packetize_and_send_video(const uint8_t* nalu, size_t len, uint32_t ts_90k, bool is_key);
    void packetize_and_send_audio(const uint8_t* data, size_t len, uint32_t ts_samples);

    int port_;
    std::string path_;
    KeyframeCallback kf_req_cb_;
    bool is_hevc_ = true;
    int server_fd_ = -1;
    std::atomic<bool> running_{false};
    std::thread accept_thread_;

    std::mutex clients_mutex_;
    std::unordered_map<int, RTSPClientSession> clients_;

    // In-band parameter sets
    std::vector<uint8_t> vps_;
    std::vector<uint8_t> sps_;
    std::vector<uint8_t> pps_;

    // Cached raw parameter RTP packets
    std::mutex param_mutex_;
    std::vector<uint8_t> vps_pkt_;
    std::vector<uint8_t> sps_pkt_;
    std::vector<uint8_t> pps_pkt_;

    // Instant Keyframe / IDR caching
    std::mutex idr_cache_mutex_;
    std::vector<std::vector<uint8_t>> idr_cache_pkts_;
    std::vector<std::vector<uint8_t>> current_idr_pkts_;
    bool collecting_idr_ = false;

    // GOP caching
    std::mutex gop_mutex_;
    std::vector<MediaFrame> gop_cache_;
    bool has_keyframe_ = false;
};

}  // namespace tuya
