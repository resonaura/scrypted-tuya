import { AnimatePresence, motion } from "framer-motion";
import { Mic, X } from "lucide-react";
import React from "react";
import { useTalkback } from "./TalkbackProvider.js";
import { Button } from "./ui/Button.js";

interface TalkbackPillProps {
  did?: string;
  className?: string;
}

export const TalkbackPill: React.FC<TalkbackPillProps> = ({
  did,
  className = "",
}) => {
  const talk = useTalkback();
  if (!did) return null;

  const isActive = talk.isLocal(did);
  const isBusy = talk.isBusy(did);
  const levels = talk.levels;

  const busyTitle =
    (talk.remoteHolders[did] ?? null) === "rtmp"
      ? "Talk is in use from HomeKit or RTMP"
      : "Talk is already in use";

  return (
    <motion.div
      initial={false}
      animate={{ width: isActive ? 130 : 78 }}
      transition={{
        type: "spring",
        stiffness: 350,
        damping: 28,
      }}
      className={`relative h-8 overflow-hidden rounded-full shrink-0 flex items-center ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {!isActive ? (
          <motion.div
            key="talk-btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full h-full"
            title={
              isBusy
                ? busyTitle
                : "Talk (Experimental ⚠️: voice playback on camera speaker may sound distorted)"
            }
          >
            <Button
              size="sm"
              variant="default-soft"
              isDisabled={isBusy}
              aria-label={isBusy ? busyTitle : "Talk"}
              className="h-8 w-full rounded-full cursor-pointer px-3 flex items-center justify-center gap-1.5 shadow-xs backdrop-blur-md disabled:cursor-not-allowed"
              onPress={() => talk.start(did)}
            >
              <Mic className="size-3.5" />
              <span>Talk</span>
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="talk-active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full h-full"
          >
            <Button
              size="sm"
              variant="default-soft"
              className="h-8 w-full rounded-full cursor-pointer px-2.5 flex items-center justify-center gap-2.5 shadow-xs select-none backdrop-blur-md"
              onPress={() => talk.stop()}
              aria-label="Cancel talkback"
            >
              <div className="flex h-5 items-center gap-1">
                {levels.map((height, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-current transition-all duration-75"
                    style={{
                      width: "3px",
                      height: `${height}px`,
                      minHeight: "3px",
                      maxHeight: "18px",
                    }}
                  />
                ))}
              </div>
              <X className="size-3.5 stroke-[2.5] shrink-0 opacity-75" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
