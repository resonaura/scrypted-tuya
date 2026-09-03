import React, { useEffect, useRef, useState } from "react";
import { Button, Chip, Modal, Surface } from "@heroui/react";
import { Check, Copy, Maximize, Play, RefreshCw, Video, Volume2, VolumeX } from "lucide-react";
import type { Camera } from "../types/index.js";
import { createWebRtcViewer, stopWebRtcViewer } from "../api/client.js";
import { copyText, getCameraUrls } from "../utils.js";
import { toast } from "sonner";

export const VideoPlayerModal: React.FC<{ camera: Camera; isOpen: boolean; onClose: () => void }> = ({ camera, isOpen, onClose }) => {
  const [viewerKey, setViewerKey] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [snapshotKey, setSnapshotKey] = useState(Date.now());
  const [copied, setCopied] = useState<"rtsp" | "snapshot" | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { rtsp, snapshot } = getCameraUrls(camera);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    let peer: RTCPeerConnection | undefined;
    let sessionId: string | undefined;
    let reconnectTimer: number | undefined;
    let mediaTimer: number | undefined;
    const remoteStream = new MediaStream();
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
          if (!videoRef.current) return;
          if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) remoteStream.addTrack(event.track);
          videoRef.current.srcObject = remoteStream;
          videoRef.current.play().catch(() => {
            if (videoRef.current) {
              videoRef.current.muted = true;
              setIsMuted(true);
              void videoRef.current.play().catch(() => {});
            }
          });
        };
        peer.onconnectionstatechange = () => {
          if (disposed || !peer) return;
          if (peer.connectionState === "connected") setStatus("connecting");
          if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            setStatus("error");
            reconnectTimer = window.setTimeout(() => setViewerKey((value) => value + 1), 2000);
          }
          if (peer.connectionState === "disconnected") setStatus("connecting");
        };
        await peer.setLocalDescription(await peer.createOffer());
        await waitForIce(peer);
        if (!peer.localDescription) throw new Error("No browser WebRTC offer");
        const created = await createWebRtcViewer(camera.did, peer.localDescription.toJSON());
        if (disposed) { await stopWebRtcViewer(camera.did, created.sessionId); return; }
        sessionId = created.sessionId;
        await peer.setRemoteDescription(created.answer);
        mediaTimer = window.setTimeout(() => {
          if (disposed || !videoRef.current || videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
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
      if (videoRef.current) videoRef.current.srcObject = null;
      peer?.close();
      if (sessionId) void stopWebRtcViewer(camera.did, sessionId);
    };
  }, [camera.did, isOpen, viewerKey]);

  useEffect(() => {
    if (status === "live") return;
    const timer = window.setInterval(() => setSnapshotKey(Date.now()), 3000);
    return () => window.clearInterval(timer);
  }, [status]);

  const copy = async (kind: "rtsp" | "snapshot", value: string) => {
    try { await copyText(value); setCopied(kind); toast.success(kind === "snapshot" ? "Snapshot URL copied" : "RTSP URL copied"); window.setTimeout(() => setCopied(null), 1500); }
    catch { toast.error("Could not copy the URL"); }
  };

  return <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()} variant="blur">
    <Modal.Container placement="center" size="lg"><Modal.Dialog className="sm:max-w-4xl"><Modal.CloseTrigger />
      <Modal.Header><Modal.Icon className="bg-primary/10 text-primary"><Video className="size-5" /></Modal.Icon><div><div className="flex items-center gap-2"><Modal.Heading>{camera.name}</Modal.Heading><Chip size="sm" variant="soft" color={status === "live" ? "success" : status === "error" ? "danger" : "warning"}>{status === "live" ? "WebRTC live" : status === "error" ? "Recovering" : "Connecting"}</Chip></div><p className="font-mono text-[11px] text-muted-foreground">{camera.did}</p></div></Modal.Header>
      <Modal.Body className="space-y-4 p-4">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-zinc-950 shadow-inner">
          <video ref={videoRef} autoPlay playsInline controls muted={isMuted} onPlaying={() => setStatus("live")} onError={() => setStatus("error")} className={`h-full w-full object-contain transition-opacity ${status === "live" ? "opacity-100" : "opacity-0"}`} />
          {status !== "live" && <img src={`${snapshot}?t=${snapshotKey}`} alt={`Snapshot from ${camera.name}`} className="absolute inset-0 h-full w-full object-contain opacity-60 blur-[1px]" />}
          {status !== "live" && <div className="absolute inset-0 grid place-items-center bg-black/30"><div className="rounded-2xl bg-black/55 px-5 py-4 text-center text-white backdrop-blur-md"><RefreshCw className={`mx-auto mb-2 size-5 ${status === "connecting" ? "animate-spin" : ""}`} /><p className="text-sm font-semibold">{status === "error" ? "Restoring the stream" : "Opening RTSP through WebRTC"}</p><p className="mt-1 text-xs text-white/65">The latest backend snapshot remains available.</p></div></div>}
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <Button isIconOnly size="sm" variant="secondary" className="bg-black/45 text-white backdrop-blur" aria-label={isMuted ? "Unmute" : "Mute"} onPress={() => { if (videoRef.current) { videoRef.current.muted = !videoRef.current.muted; setIsMuted(videoRef.current.muted); } }}>{isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</Button>
            <Button isIconOnly size="sm" variant="secondary" className="bg-black/45 text-white backdrop-blur" aria-label="Enter fullscreen" onPress={() => void videoRef.current?.requestFullscreen()}><Maximize className="size-4" /></Button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {[
            { kind: "rtsp" as const, label: "RTSP stream (H.264 + AAC)", value: rtsp },
            { kind: "snapshot" as const, label: "Stable snapshot URL", value: snapshot },
          ].map((item) => <Surface key={item.kind} className="flex min-w-0 items-center gap-2 rounded-2xl border border-default-200/70 p-3"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p><p className="truncate font-mono text-xs">{item.value}</p></div><Button isIconOnly size="sm" variant="ghost" aria-label={`Copy ${item.label}`} onPress={() => void copy(item.kind, item.value)}>{copied === item.kind ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}</Button></Surface>)}
        </div>
      </Modal.Body>
      <Modal.Footer><Button variant="secondary" onPress={() => { setStatus("connecting"); setViewerKey((value) => value + 1); }}><Play className="size-4" /> Reconnect</Button><Button variant="primary" onPress={onClose}>Done</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>;
};
