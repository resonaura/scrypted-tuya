cmake_minimum_required(VERSION 3.16)
project(tuya_streamer VERSION 2.0.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Optimization flags
if(MSVC)
    add_compile_options(/O2 /W4)
else()
    add_compile_options(-O3 -Wall -Wextra -pthread)
endif()

include(FetchContent)

set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
set(NO_MEDIA OFF CACHE BOOL "" FORCE)
set(USE_NICE OFF CACHE BOOL "" FORCE)
set(USE_GNUTLS OFF CACHE BOOL "" FORCE)
set(USE_OPENSSL ON CACHE BOOL "" FORCE)
# OPENSSL_ROOT_DIR is left to the system (works on both macOS Homebrew and Linux Debian)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    glaze
    URL https://github.com/stephenberry/glaze/archive/refs/tags/v4.4.2.tar.gz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)

FetchContent_Declare(
    LibDataChannel
    GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
    GIT_TAG v0.22.3
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(glaze LibDataChannel)

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${glaze_SOURCE_DIR}/include
)

set(SOURCES
    src/crypto/aes.cpp
    src/media/reassembler.cpp
    src/rtsp/server.cpp
    src/p2p/cipher.cpp
    src/p2p/client.cpp
    src/webrtc/peer.cpp
    src/webrtc/browser_peer.cpp
    src/ipc/server.cpp
    src/session.cpp
    src/main.cpp
)

add_executable(tuya-streamer ${SOURCES})
target_include_directories(tuya-streamer PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${glaze_SOURCE_DIR}/include)
target_link_libraries(tuya-streamer PRIVATE glaze::glaze LibDataChannel::LibDataChannel pthread)

enable_testing()
add_executable(tuya-reassembler-test
    tests/reassembler_test.cpp
    src/crypto/aes.cpp
    src/media/reassembler.cpp
)
target_include_directories(tuya-reassembler-test PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${glaze_SOURCE_DIR}/include)
target_link_libraries(tuya-reassembler-test PRIVATE pthread)
add_test(NAME tuya-reassembler-test COMMAND tuya-reassembler-test)
