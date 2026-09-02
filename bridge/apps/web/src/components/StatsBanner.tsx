import React from "react";
import { Surface, Chip } from "@heroui/react";
import { Video, Radio } from "lucide-react";

interface StatsBannerProps {
  totalCameras: number;
  onlineCameras: number;
}

export const StatsBanner: React.FC<StatsBannerProps> = ({
  totalCameras,
  onlineCameras,
}) => {
  const isHealthy = onlineCameras > 0 || totalCameras === 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 gap-3.5 mb-6 max-w-md">
      <Surface className="flex items-center gap-3 p-3.5 rounded-2xl">
        <div className="p-2 rounded-xl bg-primary/10 text-primary">
          <Video className="size-4" />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground font-medium">Total Cameras</p>
          <p className="text-lg font-bold tracking-tight">{totalCameras}</p>
        </div>
      </Surface>

      <Surface className="flex items-center gap-3 p-3.5 rounded-2xl">
        <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
          <Radio className="size-4" />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground font-medium">Active Streams</p>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold tracking-tight">{onlineCameras}</span>
            <Chip
              size="sm"
              variant="soft"
              color={isHealthy ? "success" : "warning"}
              className="h-4 text-[9px] px-1.5"
            >
              {isHealthy ? "Live" : "Offline"}
            </Chip>
          </div>
        </div>
      </Surface>
    </div>
  );
};
