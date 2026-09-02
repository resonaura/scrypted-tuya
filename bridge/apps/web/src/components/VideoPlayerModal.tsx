import React, { useState } from "react";
import {
  Modal,
  Button,
  ButtonGroup,
  Chip,
  Surface,
} from "@heroui/react";
import {
  Signal,
  Navigation,
  Volume2,
  VolumeX,
  RefreshCw,
  Copy,
  Video,
} from "lucide-react";
import type { Camera } from "../types/index.js";
import { getApiBase } from "../api/client.js";
import { toast } from "sonner";

interface VideoPlayerModalProps {
  camera: Camera;
  isOpen: boolean;
  onClose: () => void;
  onPtz: (id: string, dir: "up" | "down" | "left" | "right" | "stop") => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  camera,
  isOpen,
  onClose,
  onPtz,
}) => {
  const [isAudioMuted, setIsAudioMuted] = useState(!camera.audioEnabled);
  const [snapshotKey, setSnapshotKey] = useState(Date.now());
  const [streamError, setStreamError] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(true);

  const apiBase = getApiBase();
  const cleanSlug =
    camera.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || camera.did;
  const mjpegStreamUrl = `${apiBase}/api/cameras/${camera.id}/mjpeg`;
  const snapshotUrl = `${apiBase}/api/cameras/${camera.id}/snapshot?t=${snapshotKey}`;
  const videoFeedSrc = isLiveMode && !streamError ? mjpegStreamUrl : snapshotUrl;
  const rtspUrl = `rtsp://${window.location.hostname || "127.0.0.1"}:${camera.rtspPort || 8655}/${camera.rtspPath || `live/${cleanSlug}`}`;
  const h264Url =
    camera.transcodeH264 && camera.h264Port
      ? `rtsp://${window.location.hostname || "127.0.0.1"}:${camera.h264Port}/live/${cleanSlug}_h264`
      : null;

  const handleRefreshSnapshot = () => {
    setIsLiveMode(false);
    setStreamError(false);
    setSnapshotKey(Date.now());
    toast.info("Snapshot refreshed");
  };

  const handleToggleLive = () => {
    setIsLiveMode(true);
    setStreamError(false);
    toast.info("Switched to continuous live feed");
  };

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("RTSP link copied!");
  };

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant="blur"
    >
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-primary/10 text-primary">
              <Video className="size-5" />
            </Modal.Icon>
            <div className="flex items-center gap-2">
              <Modal.Heading>{camera.name}</Modal.Heading>
              <Chip
                size="sm"
                variant="soft"
                color={camera.online ? "success" : "danger"}
                className="text-[10px] font-semibold h-5 px-2"
              >
                {camera.online ? (isLiveMode ? "Live Stream" : "Snapshot") : "Offline"}
              </Chip>
              <Chip size="sm" variant="soft" className="text-[10px] uppercase font-mono h-5 px-2">
                {camera.quality || "HD"}
              </Chip>
            </div>
          </Modal.Header>

          <Modal.Body className="p-4 space-y-3">
            {/* Player Viewport */}
            <div className="relative aspect-video w-full bg-zinc-950 rounded-2xl overflow-hidden flex items-center justify-center">
              <img
                src={videoFeedSrc}
                alt={camera.name}
                className="w-full h-full object-contain"
                onError={() => {
                  if (isLiveMode) {
                    setStreamError(true);
                    setIsLiveMode(false);
                  }
                }}
              />

              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                <Chip
                  size="sm"
                  variant="soft"
                  className="backdrop-blur-md bg-black/60 text-white text-[10px]"
                >
                  <Signal className="size-2.5 text-emerald-400 mr-1 inline-block animate-pulse" />
                  RTSP :{camera.rtspPort || 8655}
                </Chip>
              </div>

              {/* PTZ Overlay */}
              <div className="absolute bottom-2.5 right-2.5 bg-black/60 backdrop-blur-md p-1 rounded-xl">
                <ButtonGroup size="sm" variant="secondary">
                  <Button isIconOnly onPress={() => onPtz(camera.id, "left")} aria-label="Left">
                    <Navigation className="size-3.5 -rotate-90 text-white" />
                  </Button>
                  <Button isIconOnly onPress={() => onPtz(camera.id, "up")} aria-label="Up">
                    <ButtonGroup.Separator />
                    <Navigation className="size-3.5 text-white" />
                  </Button>
                  <Button isIconOnly onPress={() => onPtz(camera.id, "down")} aria-label="Down">
                    <ButtonGroup.Separator />
                    <Navigation className="size-3.5 rotate-180 text-white" />
                  </Button>
                  <Button isIconOnly onPress={() => onPtz(camera.id, "right")} aria-label="Right">
                    <ButtonGroup.Separator />
                    <Navigation className="size-3.5 rotate-90 text-white" />
                  </Button>
                </ButtonGroup>
              </div>
            </div>

            {/* RTSP Links */}
            <div className="space-y-2">
              <Surface className="flex items-center justify-between gap-2 p-2.5 rounded-xl">
                <span className="text-xs font-mono truncate text-muted-foreground">
                  {rtspUrl}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => handleCopy(rtspUrl)}
                  className="text-xs h-7 px-2"
                >
                  <Copy className="size-3 mr-1" />
                  Copy
                </Button>
              </Surface>

              {h264Url && (
                <Surface className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-purple-500/10">
                  <span className="text-xs font-mono truncate text-purple-400">
                    {h264Url}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => handleCopy(h264Url)}
                    className="text-xs h-7 px-2 text-purple-400"
                  >
                    <Copy className="size-3 mr-1" />
                    Copy x264
                  </Button>
                </Surface>
              )}
            </div>
          </Modal.Body>

          <Modal.Footer className="flex items-center justify-start gap-2">
            <Button
              size="sm"
              variant={isLiveMode ? "primary" : "secondary"}
              onPress={handleToggleLive}
            >
              <Signal className="size-3.5 mr-1 text-emerald-400" />
              Live Stream
            </Button>
            <Button
              size="sm"
              variant={!isLiveMode ? "primary" : "secondary"}
              onPress={handleRefreshSnapshot}
            >
              <RefreshCw className="size-3.5 mr-1" />
              Snapshot
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => setIsAudioMuted(!isAudioMuted)}
            >
              {isAudioMuted ? (
                <VolumeX className="size-3.5 mr-1 text-muted-foreground" />
              ) : (
                <Volume2 className="size-3.5 mr-1 text-emerald-400" />
              )}
              {isAudioMuted ? "Muted" : "Audio"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
};
