import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { getWsUrl } from "../api/client.js";

export type TalkbackHolder = "web" | "rtmp" | null;

const BAR_COUNT = 13;
const IDLE_LEVELS = () => new Array(BAR_COUNT).fill(3);

type RemoteHolders = Record<string, TalkbackHolder>;

interface TalkbackContextValue {
  remoteHolders: RemoteHolders;
  localDid: string | null;
  levels: number[];
  isLocal: (did: string) => boolean;
  isBusy: (did: string) => boolean;
  start: (did: string) => void;
  stop: () => void;
}

const TalkbackContext = createContext<TalkbackContextValue | null>(null);

export function useTalkback(): TalkbackContextValue {
  const ctx = useContext(TalkbackContext);
  if (!ctx) {
    throw new Error("useTalkback must be used within TalkbackProvider");
  }
  return ctx;
}

function busyMessage(holder: TalkbackHolder): string {
  if (holder === "rtmp") {
    return "Talk is in use from HomeKit or RTMP";
  }
  return "Talk is already in use";
}

export const TalkbackProvider: React.FC<{
  remoteHolders: RemoteHolders;
  children: React.ReactNode;
}> = ({ remoteHolders, children }) => {
  const [localDid, setLocalDid] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS);

  const localDidRef = useRef<string | null>(null);
  localDidRef.current = localDid;

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const cleanupAudio = useCallback(() => {
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
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          const did = localDidRef.current;
          ws.send(JSON.stringify({ type: "talk_stop", did }));
        } catch {}
      }
      try {
        ws.close();
      } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setLevels(IDLE_LEVELS());
  }, []);

  const stop = useCallback(() => {
    cleanupAudio();
    setLocalDid(null);
  }, [cleanupAudio]);

  const start = useCallback(
    (did: string) => {
      const holder = remoteHolders[did] ?? null;
      if (
        holder === "rtmp" ||
        (holder === "web" && localDidRef.current !== did)
      ) {
        toast.info(busyMessage(holder));
        return;
      }
      if (localDidRef.current === did) return;
      cleanupAudio();
      setLocalDid(did);
    },
    [cleanupAudio, remoteHolders],
  );

  useEffect(() => {
    if (!localDid) {
      cleanupAudio();
      return;
    }

    const did = localDid;
    let isMounted = true;

    async function initMic() {
      try {
        const ws = new WebSocket(getWsUrl());
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "talk_start", did }));
        };
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "talk_busy" && msg.did === did) {
              toast.info(busyMessage(msg.holder ?? "rtmp"));
              if (isMounted) stop();
              return;
            }
            if (msg.type === "talk_end" && msg.did === did) {
              if (isMounted) stop();
            }
          } catch {}
        };
        ws.onclose = () => {
          if (!isMounted || wsRef.current !== ws) return;
          stop();
        };

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
        const AudioCtx =
          window.AudioContext || (window as any).webkitAudioContext;
        let audioCtx: AudioContext;
        try {
          audioCtx = new AudioCtx({ sampleRate: 8000 });
        } catch {
          audioCtx = new AudioCtx();
        }
        audioContextRef.current = audioCtx;
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const highpass = audioCtx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 300;
        highpass.Q.value = Math.SQRT1_2;
        const lowpass = audioCtx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 3400;
        lowpass.Q.value = Math.SQRT1_2;
        source.connect(highpass);
        highpass.connect(lowpass);

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.55;
        lowpass.connect(analyser);
        analyserRef.current = analyser;

        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
        lowpass.connect(processor);

        let resamplePos = 0;
        const pcmBuffer: number[] = [];
        const FRAME_SIZE = 320; // 40 ms at 8000 Hz mono (320 samples)
        let packetsSent = 0;

        processor.onaudioprocess = (e) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
            return;
          const input = e.inputBuffer.getChannelData(0);
          const sampleRate = audioCtx.sampleRate;
          const ratio = sampleRate / 8000;

          while (resamplePos < input.length) {
            const idx = Math.floor(resamplePos);
            const frac = resamplePos - idx;
            const nextIdx = Math.min(idx + 1, input.length - 1);
            const sample = input[idx] * (1 - frac) + input[nextIdx] * frac;

            const scaled = Math.max(-1, Math.min(1, sample * 0.85));
            const int16 = Math.round(
              scaled < 0 ? scaled * 32768 : scaled * 32767,
            );
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
                console.log(
                  `[Talkback] Streamed ${packetsSent} packets (s16le 8 kHz, telephone 300–3400 Hz)`,
                );
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
        if (isMounted) stop();
      }
    }

    void initMic();

    return () => {
      isMounted = false;
      cleanupAudio();
    };
  }, [localDid, cleanupAudio, stop]);

  const value = useMemo<TalkbackContextValue>(
    () => ({
      remoteHolders,
      localDid,
      levels,
      isLocal: (did: string) => localDid === did,
      isBusy: (did: string) => {
        if (localDid === did) return false;
        const holder = remoteHolders[did] ?? null;
        return holder === "rtmp" || holder === "web";
      },
      start,
      stop,
    }),
    [remoteHolders, localDid, levels, start, stop],
  );

  return (
    <TalkbackContext.Provider value={value}>
      {children}
    </TalkbackContext.Provider>
  );
};
