import { Button, Chip, Dropdown, Label, Surface } from "@heroui/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  MoreVertical,
  Play,
  RefreshCw,
  Trash2,
  Video,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { preheatWebRtc } from "../api/client.js";
import type { Camera } from "../types/index.js";
import { copyText, getCameraUrls } from "../utils.js";
import { Card } from "./ui/Card.js";

interface CameraCardProps {
  camera: Camera;
  index: number;
  total: number;
  onPlay: (camera: Camera) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({
  camera,
  index,
  total,
  onPlay,
  onDelete,
  onMove,
}) => {
  const reduceMotion = useReducedMotion();
  const [snapshotKey, setSnapshotKey] = React.useState(Date.now());
  const [imgError, setImgError] = React.useState(false);
  const [copied, setCopied] = React.useState<"rtsp" | "snapshot" | null>(null);
  const [lastSnapshotAge, setLastSnapshotAge] = React.useState(-1);
  const lastSnapshotLoadRef = React.useRef(0);
  const { rtsp, snapshot } = getCameraUrls(camera);
  const lastPreheatRef = React.useRef(0);

  const handlePreheat = React.useCallback(() => {
    const now = Date.now();
    if (now - lastPreheatRef.current > 6000) {
      lastPreheatRef.current = now;
      void preheatWebRtc(camera.did);
    }
  }, [camera.did]);

  // Refresh snapshot every 10 seconds
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setSnapshotKey(Date.now());
    };
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [camera.id]);

  // Track snapshot age in seconds
  React.useEffect(() => {
    const ageTimer = window.setInterval(() => {
      if (lastSnapshotLoadRef.current > 0) {
        setLastSnapshotAge(
          Math.round((Date.now() - lastSnapshotLoadRef.current) / 1000),
        );
      }
    }, 1000);
    return () => window.clearInterval(ageTimer);
  }, []);

  const copy = async (kind: "rtsp" | "snapshot", value: string) => {
    try {
      await copyText(value);
      setCopied(kind);
      toast.success(
        kind === "snapshot" ? "Snapshot URL copied" : "RTSP URL copied",
      );
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${camera.name}"?`)) return;
    try {
      await onDelete(camera.id);
      toast.success(`${camera.name} deleted`);
    } catch {
      toast.error("Failed to delete camera");
    }
  };

  // Snapshot age label: "now" only if 0s, else "{N}s", "—" if never loaded
  const snapshotAgeLabel =
    lastSnapshotAge < 0
      ? "—"
      : lastSnapshotAge === 0
        ? "now"
        : `${lastSnapshotAge}s`;

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.22 }}
    >
      <Card onMouseEnter={handlePreheat} className="group overflow-hidden p-0">
        {/* Video preview — strictly flush to card boundaries, no container padding */}
        <div
          className="group/preview relative aspect-video w-full overflow-hidden bg-zinc-950 cursor-pointer select-none"
          onClick={() => {
            handlePreheat();
            onPlay(camera);
          }}
        >
          {!imgError ? (
            <img
              src={`${snapshot}?t=${snapshotKey}`}
              alt={`Latest snapshot from ${camera.name}`}
              className="h-full w-full object-cover"
              onLoad={() => {
                setImgError(false);
                lastSnapshotLoadRef.current = Date.now();
                setLastSnapshotAge(0);
              }}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="grid h-full place-items-center text-zinc-500">
              <div className="flex flex-col items-center gap-2">
                <Video className="size-8" />
                <span className="text-xs">Preview unavailable</span>
              </div>
            </div>
          )}

          {/* Hover play overlay — activates ONLY on preview hover, blurs the whole image with no zoom */}
          <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover/preview:opacity-100 backdrop-blur-md bg-black/40 transition-all duration-300 pointer-events-none">
            <Play className="size-12 fill-white text-white drop-shadow-2xl translate-x-0.5" />
          </div>

          {/* Top controls row — always on top of preview, above hover overlay */}
          <div
            className="absolute inset-x-0 top-0 z-20 flex items-start justify-between bg-linear-to-b from-black/70 to-transparent p-3 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-2">
              <Chip
                size="sm"
                variant="soft"
                color={camera.online ? "success" : "danger"}
                className="px-2.5 bg-black/45 text-white backdrop-blur-md"
              >
                {camera.online && (
                  <span className="mr-1.5 inline-block size-1.5 rounded-full bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.65)] motion-safe:animate-pulse" />
                )}
                {camera.online ? "Online" : "Reconnecting"}
              </Chip>
              <Chip
                size="sm"
                variant="soft"
                className="px-2.5 bg-black/45 font-mono text-[10px] text-white backdrop-blur-md"
              >
                {snapshotAgeLabel}
              </Chip>
            </div>
            <Dropdown>
              <Dropdown.Trigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`Actions for ${camera.name}`}
                  className="bg-black/35 text-white backdrop-blur-md"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  onAction={(key) => {
                    if (key === "up") onMove(camera.id, -1);
                    if (key === "down") onMove(camera.id, 1);
                    if (key === "delete") void remove();
                  }}
                >
                  <Dropdown.Item
                    id="up"
                    textValue="Move up"
                    isDisabled={index === 0}
                  >
                    <ArrowUp className="inline size-4" />
                    <Label>Move earlier</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="down"
                    textValue="Move down"
                    isDisabled={index === total - 1}
                  >
                    <ArrowDown className="inline size-4" />
                    <Label>Move later</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="delete"
                    textValue="Delete camera"
                    variant="danger"
                  >
                    <Trash2 className="text-danger inline size-4" />
                    <Label>Delete camera</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>

        {/* Camera Info — padding only here */}
        <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{camera.name}</h3>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {camera.did}
            </p>
          </div>
        </div>

        {/* Links & Actions — padding only here */}
        <div className="grid gap-2 px-4 pb-4 pt-1">
          <Surface className="flex min-w-0 items-center gap-2 rounded-xl border border-default-200/70 bg-default-50/60 p-2">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                RTSP Stream (H.264 + AAC)
              </p>
              <p className="truncate font-mono text-[11px]">{rtsp}</p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Copy RTSP URL"
              onPress={() => void copy("rtsp", rtsp)}
            >
              {copied === "rtsp" ? (
                <Check className="size-4 text-success" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </Surface>
          <Surface className="flex min-w-0 items-center gap-2 rounded-xl border border-default-200/70 bg-default-50/60 p-2">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Live snapshot URL
              </p>
              <p className="truncate font-mono text-[11px]">{snapshot}</p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Copy snapshot URL"
              onPress={() => void copy("snapshot", snapshot)}
            >
              {copied === "snapshot" ? (
                <Check className="size-4 text-success" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Refresh preview"
              onPress={() => {
                setImgError(false);
                setSnapshotKey(Date.now());
              }}
            >
              <RefreshCw className="size-4" />
            </Button>
          </Surface>
        </div>
      </Card>
    </motion.div>
  );
};
