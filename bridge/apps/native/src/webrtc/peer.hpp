#pragma once

#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <mutex>
#include <rtc/rtc.hpp>
#include "media/reassembler.hpp"
#include "rtsp/server.hpp"

namespace tuya {

struct IceServerConfig {
    std::string url;
    std::string username;
    std::string password;
};

struct WebRTCConfig {
    std::string did;
    std::vector<IceServerConfig> ice_servers;
    bool is_hevc = false;
    std::string resolution = "hd";
};

class WebRTCPeer {
public:
    using EventCallback = std::function<void(const std::string&)>;
    using FrameCallback = std::function<void(const MediaFrame&)>;

    WebRTCPeer(const WebRTCConfig& config, std::shared_ptr<RTSPServer> rtsp_server, EventCallback event_cb);
    ~WebRTCPeer();

    bool start();
    void stop();

    void set_remote_description(const std::string& sdp, const std::string& type = "answer");
    void add_remote_candidate(const std::string& candidate, const std::string& mid = "");

    void request_keyframe();
    void set_quality(int channel);
    void ptz(int action, int speed);

private:
    void setup_peer_connection();
    void setup_tracks();
    void setup_data_channel();
    void send_data_channel_msg(const std::string& type, const std::string& msg = "");
    void keyframe_loop();

    WebRTCConfig config_;
    std::shared_ptr<RTSPServer> rtsp_server_;
    EventCallback event_cb_;

    std::shared_ptr<rtc::PeerConnection> pc_;
    std::shared_ptr<rtc::Track> video_track_;
    std::shared_ptr<rtc::Track> audio_track_;
    std::shared_ptr<rtc::DataChannel> data_channel_;

    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};
    std::thread keyframe_thread_;
    std::mutex mutex_;
};

}  // namespace tuya
