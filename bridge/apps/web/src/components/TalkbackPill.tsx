import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X } from "lucide-react";
import { Button } from "./ui/Button.js";
import { getWsUrl } from "../api/client.js";

interface TalkbackPillProps {
  did?: string;
  isActive: boolean;
  onToggle: () => void;
  onStop: () => void;
  className?: string;
}

const BAR_COUNT = 13;

export const TalkbackPill: React.FC<TalkbackPillProps> = ({
  did,
  isActive,
  onToggle,
  onStop,
  className = "",
}) => {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(3));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    if (!isActive) {
      cleanupAudio();
      return;
    }

    let isMounted = true;

    async function initMic() {
      try {
        if (did) {
          try {
            const ws = new WebSocket(getWsUrl());
            ws.binaryType = "arraybuffer";
            wsRef.current = ws;
            ws.onopen = () => {
              ws.send(JSON.stringify({ type: "talk_start", did }));
            };
          } catch (e) {
            console.warn("[Talkback] WebSocket connection failed:", e);
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        mediaStreamRef.current = stream;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.55;
        source.connect(analyser);
        analyserRef.current = analyser;

        // Set up real-time audio pipeline: 8000Hz PCMU streaming
        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        // Connect to silent gain node so user doesn't hear microphone loopback
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
        source.connect(processor);

        let resamplePos = 0;
        const pcmBuffer: number[] = [];
        const FRAME_SIZE = 160; // 20ms at 8000Hz
        let packetsSent = 0;

        processor.onaudioprocess = (e) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const sampleRate = audioCtx.sampleRate;
          const ratio = sampleRate / 8000;

          while (resamplePos < input.length) {
            const idx = Math.floor(resamplePos);
            const frac = resamplePos - idx;
            const nextIdx = Math.min(idx + 1, input.length - 1);
            const sample = input[idx] * (1 - frac) + input[nextIdx] * frac;

            const scaled = Math.max(-1, Math.min(1, sample * 0.85));
            const int16 = Math.round(scaled < 0 ? scaled * 32768 : scaled * 32767);
            pcmBuffer.push(int16);

            resamplePos += ratio;
          }
          resamplePos -= input.length;

          while (pcmBuffer.length >= FRAME_SIZE) {
            const samples = pcmBuffer.splice(0, FRAME_SIZE);
            const int16Array = new Int16Array(samples);
            const chunk = new Uint8Array(int16Array.buffer);
            try {
              wsRef.current.send(chunk);
              packetsSent++;
              if (packetsSent === 1 || packetsSent % 50 === 0) {
                console.log(`[Talkback] Streamed ${packetsSent} audio packets (16-bit PCM, 320B)`);
              }
            } catch {}
          }
        };

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateWaveform = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);

          const midIndex = Math.floor(BAR_COUNT / 2);
          const nextLevels = [];

          for (let i = 0; i < BAR_COUNT; i++) {
            const distFromCenter = Math.abs(i - midIndex) / midIndex;
            const weight = Math.max(0.15, 1 - distFromCenter * 0.7);

            const binIdx = Math.min(
              dataArray.length - 1,
              Math.floor(1 + (i * (dataArray.length - 2)) / BAR_COUNT),
            );
            const raw = dataArray[binIdx] / 255;

            // Height: min 3px (dot), max 18px (vertical line)
            const minH = 3;
            const maxH = 18;
            const dynamicH = minH + (maxH - minH) * Math.pow(raw * weight, 1.3);

            nextLevels.push(Math.round(dynamicH));
          }

          setLevels(nextLevels);
          animFrameRef.current = requestAnimationFrame(updateWaveform);
        };

        animFrameRef.current = requestAnimationFrame(updateWaveform);
      } catch (err) {
        console.warn("[Talkback] Microphone error:", err);
        onStopRef.current();
      }
    }

    void initMic();

    return () => {
      isMounted = false;
      cleanupAudio();
    };
  }, [isActive, did]);

  const cleanupAudio = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "talk_stop", did }));
        } catch {}
      }
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setLevels(new Array(BAR_COUNT).fill(3));
  };

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
          >
            <Button
              size="sm"
              variant="default-soft"
              className="h-8 w-full rounded-full cursor-pointer px-3 flex items-center justify-center gap-1.5 shadow-xs backdrop-blur-md"
              onPress={onToggle}
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
              onPress={onStop}
              aria-label="Cancel talkback"
            >
              {/* Waveform vertical bars */}
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

              {/* Close icon with compact gap */}
              <X className="size-3.5 stroke-[2.5] shrink-0 opacity-75" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
