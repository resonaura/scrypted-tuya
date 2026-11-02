#include "rtsp/server.hpp"
#include <cstdlib>

int main() {
    tuya::RTSPServer server(0, "live/test");
    tuya::MediaFrame frame;
    frame.is_video = true;
    frame.is_keyframe = true;
    frame.data = {0, 0, 0, 1, 0x26, 1, 0x80};
    server.feed_frame(frame);
    uint64_t at = 0, again = 0;
    if (server.get_latest_annexb(&at) != frame.data || at < 1700000000000ULL)
        std::abort();
    if (server.get_latest_annexb(&again) != frame.data || at != again)
        std::abort();
    server.clear_snapshot_annexb();
    if (!server.get_latest_annexb(&again).empty() || again != 0)
        std::abort();
}
