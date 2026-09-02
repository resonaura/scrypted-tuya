#include <cassert>
#include <cstdint>
#include <iostream>
#include <vector>
#include <cstring>
#include "crypto/aes.hpp"
#include "media/reassembler.hpp"

int main() {
    // 1. Test AES-128 ECB
    const uint8_t aes_key[16] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f};
    const uint8_t sample_block[16] = {'1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'a', 'b', 'c', 'd', 'e', 'f'};
    auto dec = tuya::AES128::decrypt_ecb(aes_key, sample_block, 16);
    assert(dec.size() == 16);

    // 2. Test AVIOReassembler
    tuya::AVIOReassembler reassembler;

    int received_frames = 0;
    reassembler.set_frame_callback([&](const tuya::MediaFrame& frame) {
        if (frame.is_video) {
            received_frames++;
        }
    });

    // Feed a frame: 16 bytes header + payload
    std::vector<uint8_t> packet(16 + 32, 0);
    // frag_idx = 0
    packet[0] = 0;
    packet[1] = 0;
    // total_frags = 1
    packet[2] = 1;
    packet[3] = 0;
    // timestamp_ms = 1000
    packet[4] = 0xe8;
    packet[5] = 0x03;
    packet[6] = 0;
    packet[7] = 0;
    // total_size = 32
    packet[12] = 32;
    packet[13] = 0;
    packet[14] = 0;
    packet[15] = 0;

    reassembler.feed_packet(1, 0, packet.data(), packet.size());
    assert(received_frames == 1);

    std::cout << "✅ Native Reassembler and AES tests passed successfully!" << std::endl;
    return 0;
}
