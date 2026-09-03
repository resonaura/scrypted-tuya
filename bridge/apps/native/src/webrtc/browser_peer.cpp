#include "browser_peer.hpp"

#include <arpa/inet.h>
#include <array>
#include <chrono>
#include <cstring>
#include <iostream>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include "ipc/events.hpp"

namespace tuya {

BrowserPeer::BrowserPeer(std::string viewer_id, std::string did, EventCallback event_cb,
                         std::vector<rtc::IceServer> ice_servers)
    : viewer_id_(std::move(viewer_id)), did_(std::move(did)), event_cb_(std::move(event_cb)),
      ice_servers_(std::move(ice_servers)) {
    const auto seed = std::hash<std::string>{}(viewer_id_);
    ssrc_ = static_cast<uint32_t>((seed & 0x7fffffffU) | 0x10000000U);
    audio_ssrc_ = ssrc_ ^ 0x5a5a5a5aU;
}

BrowserPeer::~BrowserPeer() {
    stop();
}

bool BrowserPeer::start(const std::string& remote_offer) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (running_) return true;

    auto bind_receiver = [](int& socket_fd, int& port) {
        socket_fd = socket(AF_INET, SOCK_DGRAM, 0);
        if (socket_fd < 0) return false;

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;
        if (bind(socket_fd, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr)) < 0) {
            close(socket_fd);
            socket_fd = -1;
            return false;
        }

        socklen_t addr_len = sizeof(addr);
        if (getsockname(socket_fd, reinterpret_cast<sockaddr*>(&addr), &addr_len) != 0) {
            close(socket_fd);
            socket_fd = -1;
            return false;
        }
        port = ntohs(addr.sin_port);
        int recv_buffer = 2 * 1024 * 1024;
        setsockopt(socket_fd, SOL_SOCKET, SO_RCVBUF, &recv_buffer, sizeof(recv_buffer));
        return true;
    };

    if (!bind_receiver(socket_fd_, rtp_port_) || !bind_receiver(audio_socket_fd_, audio_rtp_port_)) {
        if (socket_fd_ >= 0) close(socket_fd_);
        if (audio_socket_fd_ >= 0) close(audio_socket_fd_);
        socket_fd_ = -1;
        audio_socket_fd_ = -1;
        return false;
    }

    rtc::Configuration config;
    config.bindAddress = "0.0.0.0";
    config.disableAutoNegotiation = false;
    for (const auto& ice : ice_servers_) {
        config.iceServers.push_back(ice);
    }
    pc_ = std::make_shared<rtc::PeerConnection>(config);

    pc_->onStateChange([this](rtc::PeerConnection::State state) {
        if (!event_cb_) return;
        if (state == rtc::PeerConnection::State::Connected) {
            event_cb_(to_json(EventViewerState{.viewer_id = viewer_id_, .did = did_, .state = "connected"}));
        } else if (state == rtc::PeerConnection::State::Failed ||
                   state == rtc::PeerConnection::State::Closed) {
            event_cb_(to_json(EventViewerState{.viewer_id = viewer_id_, .did = did_, .state = "closed"}));
        }
    });

    pc_->onGatheringStateChange([this](rtc::PeerConnection::GatheringState state) {
        if (state != rtc::PeerConnection::GatheringState::Complete || !event_cb_ || !pc_) return;
        auto description = pc_->localDescription();
        if (!description) return;
        event_cb_(to_json(EventViewerOffer{
            .viewer_id = viewer_id_,
            .did = did_,
            .sdp = std::string(*description),
            .rtp_port = rtp_port_,
            .audio_rtp_port = audio_rtp_port_,
        }));
    });

    running_ = true;
    receiver_thread_ = std::thread(&BrowserPeer::receive_loop, this, socket_fd_, true);
    audio_receiver_thread_ = std::thread(&BrowserPeer::receive_loop, this, audio_socket_fd_, false);
    try {
        pc_->setRemoteDescription(rtc::Description(remote_offer, "offer"));

        rtc::Description::Video video("0", rtc::Description::Direction::SendOnly);
        video.addH264Codec(96, "packetization-mode=1;profile-level-id=42e01f;level-asymmetry-allowed=1");
        video.addSSRC(ssrc_, "tuya-browser-video");
        video_track_ = pc_->addTrack(video);

        rtc::Description::Audio audio("1", rtc::Description::Direction::SendOnly);
        audio.addOpusCodec(111);
        audio.addSSRC(audio_ssrc_, "tuya-browser-audio");
        audio_track_ = pc_->addTrack(audio);

        pc_->setLocalDescription();
    } catch (const std::exception& e) {
        running_ = false;
        if (event_cb_) event_cb_(to_json(EventError{.did = did_, .message = "Browser WebRTC offer rejected: " + std::string(e.what())}));
        return false;
    }
    return true;
}

void BrowserPeer::receive_loop(int socket_fd, bool is_video) {
    std::array<std::byte, 2048> buffer{};
    while (running_) {
        const auto len = recv(socket_fd, buffer.data(), buffer.size(), 0);
        if (len <= 0) {
            if (running_) std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }
        if (len < static_cast<ssize_t>(sizeof(rtc::RtpHeader))) continue;

        auto* header = reinterpret_cast<rtc::RtpHeader*>(buffer.data());
        if (header->version() != 2) continue;
        header->setPayloadType(is_video ? 96 : 111);
        header->setSsrc(is_video ? ssrc_ : audio_ssrc_);

        auto track = is_video ? video_track_ : audio_track_;
        if (!track || !track->isOpen()) continue;
        try {
            track->send(buffer.data(), static_cast<size_t>(len));
        } catch (...) {
        }
    }
}

void BrowserPeer::stop() {
    running_ = false;
    if (socket_fd_ >= 0) {
        shutdown(socket_fd_, SHUT_RDWR);
        close(socket_fd_);
        socket_fd_ = -1;
    }
    if (audio_socket_fd_ >= 0) {
        shutdown(audio_socket_fd_, SHUT_RDWR);
        close(audio_socket_fd_);
        audio_socket_fd_ = -1;
    }
    if (receiver_thread_.joinable()) receiver_thread_.join();
    if (audio_receiver_thread_.joinable()) audio_receiver_thread_.join();

    std::lock_guard<std::mutex> lock(mutex_);
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

}  // namespace tuya
