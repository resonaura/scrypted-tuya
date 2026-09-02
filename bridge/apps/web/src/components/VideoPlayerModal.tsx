import React, { useEffect, useRef, useState } from "react";
import { Button, Chip, Modal, Surface } from "@heroui/react";
import { Check, Copy, Maximize, Play, RefreshCw, Video } from "lucide-react";
import type { Camera } from "../types/index.js";
import { createWebRtcViewer, stopWebRtcViewer } from "../api/client.js";
import { copyText, getCameraUrls } from "../utils.js";
import { toast } from "sonner";

export const VideoPlayerModal: React.FC<{ camera: Camera; isOpen: boolean; onClose: () => void }> = ({ camera, isOpen, onClose }) => {
  const [viewerKey, setViewerKey] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [snapshotKey, setSnapshotKey] = useState(Date.now());
  const [copied, setCopied] = useState<"rtsp" | "snapshot" | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { rtsp, snapshot } = getCameraUrls(camera);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    let peer: RTCPeerConnection | undefined;
    let sessionId: string | undefined;
    let reconnectTimer: number | undefined;
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
        const capabilities = RTCRtpReceiver.getCapabilities("video");
        const h264 = capabilities?.codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/h264") || [];
        if (h264.length && "setCodecPreferences" in transceiver) transceiver.setCodecPreferences(h264);
        peer.ontrack = (event) => {
          if (!videoRef.current) return;
          videoRef.current.srcObject = event.streams[0] || new MediaStream([event.track]);
          void videoRef.current.play().catch(() => {});
        };
        peer.onconnectionstatechange = () => {
          if (disposed || !peer) return;
          if (peer.connectionState === "connected") setStatus("live");
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
      } catch {
        if (!disposed) { setStatus("error"); reconnectTimer = window.setTimeout(() => setViewerKey((value) => value + 1), 3000); }
      }
    };
    void start();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
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
    try { await copyText(value); setCopied(kind); toast.success(kind === "rtsp" ? "RTSP URL copied" : "Snapshot URL copied"); window.setTimeout(() => setCopied(null), 1500); }
    catch { toast.error("Could not copy the URL"); }
  };

  return <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()} variant="blur">
    <Modal.Container placement="center" size="lg"><Modal.Dialog className="sm:max-w-4xl"><Modal.CloseTrigger />
      <Modal.Header><Modal.Icon className="bg-primary/10 text-primary"><Video className="size-5" /></Modal.Icon><div><div className="flex items-center gap-2"><Modal.Heading>{camera.name}</Modal.Heading><Chip size="sm" variant="soft" color={status === "live" ? "success" : status === "error" ? "danger" : "warning"}>{status === "live" ? "WebRTC live" : status === "error" ? "Recovering" : "Connecting"}</Chip></div><p className="font-mono text-[11px] text-muted-foreground">{camera.did}</p></div></Modal.Header>
      <Modal.Body className="space-y-4 p-4">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-zinc-950 shadow-inner">
          <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-contain transition-opacity ${status === "live" ? "opacity-100" : "opacity-0"}`} />
          {status !== "live" && <img src={`${snapshot}?t=${snapshotKey}`} alt={`Snapshot from ${camera.name}`} className="absolute inset-0 h-full w-full object-contain opacity-60 blur-[1px]" />}
          {status !== "live" && <div className="absolute inset-0 grid place-items-center bg-black/30"><div className="rounded-2xl bg-black/55 px-5 py-4 text-center text-white backdrop-blur-md"><RefreshCw className={`mx-auto mb-2 size-5 ${status === "connecting" ? "animate-spin" : ""}`} /><p className="text-sm font-semibold">{status === "error" ? "Restoring the stream" : "Opening RTSP through WebRTC"}</p><p className="mt-1 text-xs text-white/65">The latest backend snapshot remains available.</p></div></div>}
          <Button isIconOnly size="sm" variant="secondary" className="absolute bottom-3 right-3 bg-black/45 text-white backdrop-blur" aria-label="Enter fullscreen" onPress={() => void videoRef.current?.requestFullscreen()}><Maximize className="size-4" /></Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {[{ kind: "rtsp" as const, label: "RTSP stream", value: rtsp }, { kind: "snapshot" as const, label: "Stable snapshot URL", value: snapshot }].map((item) => <Surface key={item.kind} className="flex min-w-0 items-center gap-2 rounded-2xl border border-default-200/70 p-3"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p><p className="truncate font-mono text-xs">{item.value}</p></div><Button isIconOnly size="sm" variant="ghost" aria-label={`Copy ${item.label}`} onPress={() => void copy(item.kind, item.value)}>{copied === item.kind ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}</Button></Surface>)}
        </div>
      </Modal.Body>
      <Modal.Footer><Button variant="secondary" onPress={() => { setStatus("connecting"); setViewerKey((value) => value + 1); }}><Play className="size-4" /> Reconnect</Button><Button variant="primary" onPress={onClose}>Done</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>;
};
