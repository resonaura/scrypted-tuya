import React from "react";
import { Button, Card, Chip, Dropdown, Label, Surface } from "@heroui/react";
import { ArrowDown, ArrowUp, Check, Copy, MoreVertical, Play, RefreshCw, Trash2, Video } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { Camera } from "../types/index.js";
import { copyText, getCameraUrls } from "../utils.js";
import { toast } from "sonner";

interface CameraCardProps {
  camera: Camera;
  index: number;
  total: number;
  onPlay: (camera: Camera) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({ camera, index, total, onPlay, onDelete, onMove }) => {
  const reduceMotion = useReducedMotion();
  const [snapshotKey, setSnapshotKey] = React.useState(Date.now());
  const [imgError, setImgError] = React.useState(false);
  const [copied, setCopied] = React.useState<"rtsp" | "snapshot" | null>(null);
  const { rtsp, snapshot } = getCameraUrls(camera);

  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setSnapshotKey(Date.now());
    };
    const timer = window.setInterval(refresh, camera.online ? 3500 : 7000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [camera.id, camera.online]);

  const copy = async (kind: "rtsp" | "snapshot", value: string) => {
    try {
      await copyText(value);
      setCopied(kind);
      toast.success(kind === "snapshot" ? "Snapshot URL copied" : "RTSP URL copied");
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete “${camera.name}”?`)) return;
    try {
      await onDelete(camera.id);
      toast.success(`${camera.name} deleted`);
    } catch {
      toast.error("Failed to delete camera");
    }
  };

  return (
    <motion.div layout initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, scale: 0.97 }} transition={{ duration: 0.22 }}>
      <Card className="group overflow-hidden rounded-3xl border border-default-200/70 bg-content1/90 shadow-sm transition-shadow hover:shadow-xl">
        <Card.Content className="p-0">
          <div className="relative aspect-video overflow-hidden bg-zinc-950">
            {!imgError ? (
              <img src={`${snapshot}?t=${snapshotKey}`} alt={`Latest snapshot from ${camera.name}`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]" onLoad={() => setImgError(false)} onError={() => setImgError(true)} />
            ) : (
              <div className="grid h-full place-items-center text-zinc-500">
                <div className="flex flex-col items-center gap-2"><Video className="size-8" /><span className="text-xs">Preview unavailable</span></div>
              </div>
            )}
            <div className="absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-3 pb-8">
              <div className="flex gap-2">
                <Chip size="sm" variant="soft" color={camera.online ? "success" : "danger"} className="px-2.5 bg-black/45 text-white backdrop-blur-md">
                  {camera.online && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.65)] motion-safe:animate-pulse" />}
                  {camera.online ? "Online" : "Reconnecting"}
                </Chip>
                <Chip size="sm" variant="soft" className="px-2.5 bg-black/45 font-mono text-[10px] uppercase text-white backdrop-blur-md">{camera.quality || "HD"}</Chip>
              </div>
              <Dropdown>
                <Dropdown.Trigger>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={`Actions for ${camera.name}`} className="bg-black/35 text-white backdrop-blur-md"><MoreVertical className="size-4" /></Button>
                </Dropdown.Trigger>
                <Dropdown.Popover placement="bottom end">
                  <Dropdown.Menu onAction={(key) => {
                    if (key === "up") onMove(camera.id, -1);
                    if (key === "down") onMove(camera.id, 1);
                    if (key === "delete") void remove();
                  }}>
                    <Dropdown.Item id="up" textValue="Move up" isDisabled={index === 0}><ArrowUp className="mr-2 inline size-4" /><Label>Move earlier</Label></Dropdown.Item>
                    <Dropdown.Item id="down" textValue="Move down" isDisabled={index === total - 1}><ArrowDown className="mr-2 inline size-4" /><Label>Move later</Label></Dropdown.Item>
                    <Dropdown.Item id="delete" textValue="Delete camera" variant="danger"><Trash2 className="mr-2 inline size-4" /><Label>Delete camera</Label></Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
            <Button variant="primary" size="md" onPress={() => onPlay(camera)} className="absolute bottom-3 left-3 rounded-full shadow-lg"><Play className="size-4 fill-current" /> Open live view</Button>
          </div>
        </Card.Content>

        <Card.Header className="items-start justify-between gap-3 px-4 pb-2 pt-4">
          <div className="min-w-0"><Card.Title className="truncate text-base font-semibold">{camera.name}</Card.Title><Card.Description className="truncate font-mono text-[11px]">{camera.did}</Card.Description></div>
          <Chip size="sm" variant="soft" className="shrink-0 font-mono text-[10px]">:{camera.rtspPort || 8655}</Chip>
        </Card.Header>

        <Card.Footer className="grid gap-2 px-4 pb-4 pt-1">
          <Surface className="flex min-w-0 items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-2">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-success">RTSP Stream (H.264 + AAC)</p>
              <p className="truncate font-mono text-[11px]">{rtsp}</p>
            </div>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Copy RTSP URL" onPress={() => void copy("rtsp", rtsp)}>
              {copied === "rtsp" ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </Button>
          </Surface>
          <Surface className="flex min-w-0 items-center gap-2 rounded-xl border border-default-200/70 bg-default-50/60 p-2">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Live snapshot URL</p>
              <p className="truncate font-mono text-[11px]">{snapshot}</p>
            </div>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Copy snapshot URL" onPress={() => void copy("snapshot", snapshot)}>
              {copied === "snapshot" ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh preview" onPress={() => { setImgError(false); setSnapshotKey(Date.now()); }}>
              <RefreshCw className="size-4" />
            </Button>
          </Surface>
        </Card.Footer>
      </Card>
    </motion.div>
  );
};
