import React from "react";
import { Surface } from "@heroui/react";
import { Camera, CircleCheck, Radio, Wifi } from "lucide-react";

export const StatsBanner: React.FC<{ totalCameras: number; onlineCameras: number; isBridgeConnected: boolean }> = ({ totalCameras, onlineCameras, isBridgeConnected }) => {
  const offline = Math.max(0, totalCameras - onlineCameras);
  const stats = [
    { label: "Cameras", value: String(totalCameras), icon: Camera, tone: "bg-primary/10 text-primary" },
    { label: "Live streams", value: String(onlineCameras), icon: Radio, tone: "bg-success/10 text-success" },
    { label: "Recovering", value: String(offline), icon: CircleCheck, tone: offline ? "bg-warning/10 text-warning" : "bg-default-100 text-muted-foreground" },
    { label: "Realtime events", value: isBridgeConnected ? "Connected" : "Reconnecting", icon: Wifi, tone: isBridgeConnected ? "bg-success/10 text-success" : "bg-warning/10 text-warning" },
  ];
  return <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {stats.map(({ label, value, icon: Icon, tone }) => <Surface key={label} className="flex items-center gap-3 rounded-2xl border border-default-200/70 bg-content1/70 p-3.5"><div className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></div><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-lg font-semibold tracking-tight">{value}</p></div></Surface>)}
  </div>;
};
