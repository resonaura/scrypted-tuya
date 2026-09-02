import React from "react";
import {
  Surface,
  Button,
  ButtonGroup,
  Chip,
} from "@heroui/react";
import {
  Play,
  Trash2,
  Navigation,
  Volume2,
  VolumeX,
  Copy,
  Check,
} from "lucide-react";
import { motion } from "framer-motion";
import type { Camera } from "../types/index.js";
import { getApiBase } from "../api/client.js";
import { toast } from "sonner";

interface CameraCardProps {
  camera: Camera;
  onPlay: (camera: Camera) => void;
  onDelete: (id: string) => void;
  onPtz: (id: string, dir: "up" | "down" | "left" | "right" | "stop") => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({
  camera,
  onPlay,
  onDelete,
  onPtz,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);
  const [snapshotKey, setSnapshotKey] = React.useState(Date.now());

  // Auto-refresh snapshot every 5 seconds if online
  React.useEffect(() => {
    if (!camera.online) return;
    const timer = setInterval(() => {
      setSnapshotKey(Date.now());
      setImgError(false);
    }, 5000);
    return () => clearInterval(timer);
  }, [camera.online, camera.id]);

  const cleanSlug =
    camera.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || camera.did;
  const snapshotUrl = `${getApiBase()}/api/cameras/${camera.id}/snapshot?t=${snapshotKey}`;
  const rtspUrl = `rtsp://${window.location.hostname || "127.0.0.1"}:${camera.rtspPort || 8655}/${camera.rtspPath || `live/${cleanSlug}`}`;
  const h264Url =
    camera.transcodeH264 && camera.h264Port
      ? `rtsp://${window.location.hostname || "127.0.0.1"}:${camera.h264Port}/live/${cleanSlug}_h264`
      : null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("RTSP link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    try {
      await onDelete(camera.id);
      toast.success(`Camera ${camera.name} deleted`);
    } catch {
      toast.error("Failed to delete camera");
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.18 }}
    >
      <Surface className="flex flex-col rounded-3xl overflow-hidden shadow-xs">
        {/* Stream Viewport */}
        <div className="relative aspect-video w-full bg-zinc-950 flex items-center justify-center overflow-hidden group">
          {!imgError ? (
            <img
              src={snapshotUrl}
              alt={camera.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={() => setImgError(true)}
              onLoad={() => setImgError(false)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-zinc-500">
              <Play className="size-8 opacity-40" />
              <span className="text-xs font-mono">{camera.online ? "Connecting stream..." : "Offline"}</span>
            </div>
          )}

          {/* Badges */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
            <Chip
              size="sm"
              variant="soft"
              color={camera.online ? "success" : "danger"}
              className="backdrop-blur-md bg-black/60 text-white text-[10px] font-semibold h-5 px-2"
            >
              {camera.online ? "Online" : "Connecting"}
            </Chip>

            <Chip
              size="sm"
              variant="soft"
              className="backdrop-blur-md bg-black/60 text-white text-[10px] uppercase font-mono h-5 px-2"
            >
              {camera.quality || "HD"}
            </Chip>

            {camera.transcodeH264 && (
              <Chip
                size="sm"
                variant="soft"
                className="backdrop-blur-md bg-purple-500/80 text-white text-[10px] font-semibold h-5 px-2"
              >
                x264
              </Chip>
            )}
          </div>

          {/* Audio Badge */}
          <div className="absolute top-2.5 right-2.5 z-10">
            <div className="p-1 rounded-md bg-black/60 backdrop-blur-md text-white">
              {camera.audioEnabled ? (
                <Volume2 className="size-3 text-emerald-400" />
              ) : (
                <VolumeX className="size-3 text-white/50" />
              )}
            </div>
          </div>

          {/* Play Overlay Button */}
          <Button
            isIconOnly
            size="md"
            variant="primary"
            onPress={() => onPlay(camera)}
            className="absolute z-20 rounded-full shadow-lg hover:scale-110 transition-transform"
            aria-label="Play Live Stream"
          >
            <Play className="size-5 fill-current ml-0.5" />
          </Button>
        </div>

        {/* Info & RTSP Snippet */}
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="overflow-hidden">
              <h3 className="font-bold text-foreground text-sm tracking-tight truncate">
                {camera.name}
              </h3>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {camera.did}
              </p>
            </div>
            <Chip size="sm" variant="soft" className="text-[11px] font-mono font-semibold shrink-0">
              :{camera.rtspPort || 8655}
            </Chip>
          </div>

          {/* RTSP Stream Link Bar */}
          <Surface className="flex items-center justify-between gap-2 p-2 rounded-xl">
            <span className="text-[11px] font-mono truncate text-muted-foreground">
              {rtspUrl}
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={() => handleCopy(rtspUrl)}
              className="size-6 min-w-6 rounded-lg text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </Button>
          </Surface>

          {h264Url && (
            <Surface className="flex items-center justify-between gap-2 p-2 rounded-xl bg-purple-500/10">
              <span className="text-[11px] font-mono truncate text-purple-400">
                {h264Url}
              </span>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => handleCopy(h264Url)}
                className="size-6 min-w-6 rounded-lg text-purple-400"
              >
                <Copy className="size-3" />
              </Button>
            </Surface>
          )}

          {/* Quick Footer Controls */}
          <div className="flex items-center justify-between pt-1">
            <ButtonGroup size="sm" variant="secondary">
              <Button isIconOnly onPress={() => onPtz(camera.id, "left")} aria-label="Left">
                <Navigation className="size-3.5 -rotate-90" />
              </Button>
              <Button isIconOnly onPress={() => onPtz(camera.id, "up")} aria-label="Up">
                <ButtonGroup.Separator />
                <Navigation className="size-3.5" />
              </Button>
              <Button isIconOnly onPress={() => onPtz(camera.id, "down")} aria-label="Down">
                <ButtonGroup.Separator />
                <Navigation className="size-3.5 rotate-180" />
              </Button>
              <Button isIconOnly onPress={() => onPtz(camera.id, "right")} aria-label="Right">
                <ButtonGroup.Separator />
                <Navigation className="size-3.5 rotate-90" />
              </Button>
            </ButtonGroup>

            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={handleDelete}
              className="text-muted-foreground hover:text-danger"
              aria-label="Delete Camera"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </Surface>
    </motion.div>
  );
};
