import React, { useEffect, useRef, useState } from "react";
import { Modal } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import type { Camera } from "../types/index.js";
import { createWebRtcViewer, stopWebRtcViewer } from "../api/client.js";
import { getCameraUrls } from "../utils.js";
import { VideoPlayer } from "./VideoPlayer.js";

export const VideoPlayerModal: React.FC<{ camera: Camera; isOpen: boolean; onClose: () => void }> = ({ camera, isOpen, onClose }) => {
  const [viewerKey, setViewerKey] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [snapshotKey, setSnapshotKey] = useState(Date.now());
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { snapshot } = getCameraUrls(camera);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    let peer: RTCPeerConnection | undefined;
    let sessionId: string | undefined;
    let reconnectTimer: number | undefined;
    let mediaTimer: number | undefined;
    setStatus("connecting");

    const waitForIce = (pc: RTCPeerConnection) => new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const finish = () => { pc.removeEventListener("icegatheringstatechange", change); resolve(); };
      const change = () => pc.iceGatheringState === "complete" && finish();
      pc.addEventListener("icegatheringstatechange", change);
      window.setTimeout(finish, 4000);
    });

    const start = async () => {
      try {
        peer = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
        const transceiver = peer.addTransceiver("video", { direction: "recvonly" });
        peer.addTransceiver("audio", { direction: "recvonly" });
        const capabilities = RTCRtpReceiver.getCapabilities("video");
        const h264 = capabilities?.codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/h264") || [];
        if (h264.length && "setCodecPreferences" in transceiver) transceiver.setCodecPreferences(h264);
        peer.ontrack = (event) => {
          if (event.track.kind === "video") {
            const stream = new MediaStream([event.track]);
            setVideoStream(stream);
          } else if (event.track.kind === "audio") {
            if (audioRef.current) {
              const stream = new MediaStream([event.track]);
              audioRef.current.srcObject = stream;
              audioRef.current.muted = isMuted;
              audioRef.current.volume = volume;
              void audioRef.current.play().catch(() => {});
            }
          }
        };
        peer.onconnectionstatechange = () => {
          if (disposed || !peer) return;
          if (peer.connectionState === "connected") {
            setStatus("live");
          } else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            setStatus("error");
            reconnectTimer = window.setTimeout(() => setViewerKey((value) => value + 1), 2000);
          } else if (peer.connectionState === "disconnected") {
            setStatus((prev) => (prev === "live" ? "live" : "connecting"));
          }
        };
        await peer.setLocalDescription(await peer.createOffer());
        await waitForIce(peer);
        if (!peer.localDescription) throw new Error("No browser WebRTC offer");
        const created = await createWebRtcViewer(camera.did, peer.localDescription.toJSON());
        if (disposed) { await stopWebRtcViewer(camera.did, created.sessionId); return; }
        sessionId = created.sessionId;
        await peer.setRemoteDescription(created.answer);
        mediaTimer = window.setTimeout(() => {
          if (disposed) return;
          if (peer?.connectionState === "connected") {
            setStatus("live");
            return;
          }
          setStatus("error");
          peer?.close();
          reconnectTimer = window.setTimeout(() => setViewerKey((value) => value + 1), 1000);
        }, 12_000);
      } catch {
        if (!disposed) { setStatus("error"); reconnectTimer = window.setTimeout(() => setViewerKey((value) => value + 1), 3000); }
      }
    };
    void start();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (mediaTimer) window.clearTimeout(mediaTimer);
      setVideoStream(null);
      if (audioRef.current) audioRef.current.srcObject = null;
      peer?.close();
      if (sessionId) void stopWebRtcViewer(camera.did, sessionId);
    };
  }, [camera.did, isOpen, viewerKey]);

  useEffect(() => {
    if (status === "live") return;
    const timer = window.setInterval(() => setSnapshotKey(Date.now()), 3000);
    return () => window.clearInterval(timer);
  }, [status]);

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()} variant="blur">
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog className="relative sm:max-w-5xl overflow-hidden p-0 border-0 bg-transparent shadow-none">
          <Modal.CloseTrigger className="absolute right-3 top-3 z-30 size-9 rounded-full bg-black/60 text-white shadow-lg backdrop-blur-md hover:bg-black/80 transition-colors" />
          <div
            className="relative aspect-video w-full overflow-hidden rounded-2xl bg-zinc-950 shadow-2xl [clip-path:inset(0_round_1rem)] [-webkit-mask-image:-webkit-radial-gradient(white,black)] [mask-image:radial-gradient(white,black)]"
            style={{
              WebkitMaskImage: "-webkit-radial-gradient(white, black)",
              maskImage: "radial-gradient(white, black)",
              clipPath: "inset(0 round 1rem)",
              WebkitClipPath: "inset(0 round 1rem)",
            }}
          >
            <VideoPlayer
              srcObject={videoStream}
              isLive={true}
              autoPlay={true}
              fluid={true}
              volume={volume}
              muted={isMuted}
              onVolumeChange={(v) => {
                setVolume(v);
                if (audioRef.current) audioRef.current.volume = v;
              }}
              onMuteChange={(m) => {
                setIsMuted(m);
                if (audioRef.current) {
                  audioRef.current.muted = m;
                  if (!m) void audioRef.current.play().catch(() => {});
                }
              }}
              onPlaying={() => setStatus("live")}
              onLoadedData={() => setStatus("live")}
              onError={() => setStatus("error")}
              poster={`${snapshot}?t=${snapshotKey}`}
              className="h-full w-full"
            />
            <audio ref={audioRef} autoPlay muted={isMuted} />
            {status !== "live" && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]">
                <div className="rounded-2xl bg-black/60 px-5 py-4 text-center text-white backdrop-blur-md">
                  <RefreshCw className={`mx-auto mb-2 size-5 ${status === "connecting" ? "animate-spin" : ""}`} />
                  <p className="text-sm font-semibold">{status === "error" ? "Restoring the stream" : "Opening RTSP through WebRTC"}</p>
                  <p className="mt-1 text-xs text-white/65">The latest backend snapshot remains available.</p>
                </div>
              </div>
            )}
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
};
