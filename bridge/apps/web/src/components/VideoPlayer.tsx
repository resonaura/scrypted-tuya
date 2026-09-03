import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  DependencyList,
} from 'react';
import './VideoPlayer.scss';
import BlurEffect from 'react-progressive-blur';
import { MaterialIcon } from './MaterialIcon';
import clsx from 'clsx';

/* =========================
   Helper Utilities
   ========================= */

// Format seconds into HH:MM:SS or MM:SS
function humanVideoTime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !isFinite(totalSeconds)) return '00:00';
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Auto show/hide transition with smooth animation
function autoShowHideTransition(
  active: boolean,
  setHiddenStart: (v: boolean) => void,
  setHiddenEnd: (v: boolean) => void,
  delay = 300
): number | null {
  // hiddenStart manages DOM visibility / display
  // hiddenEnd controls the .hidden CSS class (opacity/visibility)
  if (active) {
    setHiddenStart(false);
    // Remove .hidden class on the next frame
    const t = window.setTimeout(() => setHiddenEnd(false), 0);
    return t;
  } else {
    // Apply .hidden immediately
    setHiddenEnd(true);
    // Remove from layout after transition delay
    const t = window.setTimeout(() => setHiddenStart(true), delay);
    return t;
  }
}

// Cross-platform event listener hook
function useEventListener<K extends keyof WindowEventMap>(
  target: Window | HTMLElement | null | undefined,
  type: K,
  handler: (ev: WindowEventMap[K] & Event) => any,
  options?: AddEventListenerOptions | boolean,
  deps?: DependencyList
) {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  }, [handler]);
  useEffect(() => {
    const el: any = target ?? window;
    if (!el?.addEventListener) return;
    const h = (e: Event) => saved.current(e as any);
    el.addEventListener(type, h, options);
    return () => el.removeEventListener(type, h, options);
  }, [target, type, options, deps]);
}

// Body zoom scale helper
function getBodyZoom() {
  return { value: 1, transformUsed: false };
}

/* =========================
   Icons (Minimal Set)
   ========================= */

// Icon button component
const IconButton: React.FC<
  React.PropsWithChildren<{
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onFocus?: () => void;
    className?: string;
    size?: 'mini' | 'default';
    title?: string;
    'aria-label'?: string;
  }>
> = ({
  children,
  onClick,
  onFocus,
  className,
  size = 'default',
  title,
  ...rest
}) => {
  return (
    <button
      type="button"
      className={`icon-button ${size} ${className ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onFocus={onFocus}
      title={title}
      {...rest}
    >
      {children}
    </button>
  );
};

/* =========================
   Animated Volume Indicator
   ========================= */

enum VolumeIconState {
  Muted = 'muted',
  VeryLow = 'very-low-volume',
  Low = 'low-volume',
  Mid = 'mid-volume',
  High = 'high-volume',
}

const VolumeAnimatedIcon: React.FC<{
  state: VolumeIconState;
  ['data-unique-id']?: string;
}> = props => {
  return (
    <svg
      data-unique-id={props['data-unique-id']}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      className={`animated-volume-icon ${props.state}`}
      fill="white"
      viewBox="0 0 24 24"
      aria-hidden
    >
      {/* Outer audio wave */}
      <path
        d="M16.5,12C16.5,12.7 16.342,13.362 16.025,13.987C15.708,14.612 15.292,15.125 14.775,15.525C14.608,15.625 14.438,15.629 14.263,15.538C14.088,15.446 14,15.3 14,15.1L14,8.85C14,8.65 14.088,8.504 14.263,8.413C14.438,8.321 14.608,8.325 14.775,8.425C15.292,8.842 15.708,9.367 16.025,10C16.342,10.633 16.5,11.3 16.5,12Z"
        className="part low-part"
      />
      <path
        d="M19,11.975C19,10.592 18.633,9.329 17.9,8.188C17.167,7.046 16.183,6.192 14.95,5.625C14.7,5.508 14.517,5.329 14.4,5.087C14.283,4.846 14.267,4.6 14.35,4.35C14.45,4.083 14.629,3.892 14.888,3.775C15.146,3.658 15.408,3.658 15.675,3.775C17.292,4.492 18.583,5.587 19.55,7.063C20.517,8.538 21,10.175 21,11.975C21,13.775 20.517,15.413 19.55,16.888C18.583,18.363 17.292,19.458 15.675,20.175C15.408,20.292 15.146,20.292 14.888,20.175C14.629,20.058 14.45,19.867 14.35,19.6C14.267,19.35 14.283,19.104 14.4,18.863C14.517,18.621 14.7,18.442 14.95,18.325C16.183,17.758 17.167,16.904 17.9,15.762C18.633,14.621 19,13.358 19,11.975Z"
        className="part high-part"
      />
      {/* Speaker body */}
      <path
        d="M7,15L4,15C3.717,15 3.479,14.904 3.288,14.713C3.096,14.521 3,14.283 3,14L3,10C3,9.717 3.096,9.479 3.288,9.288C3.479,9.096 3.717,9 4,9L7,9L10.3,5.7C10.617,5.383 10.979,5.313 11.388,5.488C11.796,5.662 12,5.975 12,6.425L12,17.575C12,18.025 11.796,18.338 11.388,18.513C10.979,18.688 10.617,18.617 10.3,18.3L7,15Z"
        className="icon-main"
      />
      {/* Muted cross */}
      <path
        d="M18,13.4L16.1,15.3C15.917,15.483 15.683,15.575 15.4,15.575C15.117,15.575 14.883,15.483 14.7,15.3C14.517,15.117 14.425,14.883 14.425,14.6C14.425,14.317 14.517,14.083 14.7,13.9L16.6,12L14.7,10.1C14.517,9.917 14.425,9.683 14.425,9.4C14.425,9.117 14.517,8.883 14.7,8.7C14.883,8.517 15.117,8.425 15.4,8.425C15.683,8.425 15.917,8.517 16.1,8.7L18,10.6L19.9,8.7C20.083,8.517 20.317,8.425 20.6,8.425C20.883,8.425 21.117,8.517 21.3,8.7C21.483,8.883 21.575,9.117 21.575,9.4C21.575,9.683 21.483,9.917 21.3,10.1L19.4,12L21.3,13.9C21.483,14.083 21.575,14.317 21.575,14.6C21.575,14.883 21.483,15.117 21.3,15.3C21.117,15.483 20.883,15.575 20.6,15.575C20.317,15.575 20.083,15.483 19.9,15.3L18,13.4Z"
        className="part mute-part"
      />
    </svg>
  );
};

/* =========================
   Progress Time Tooltip
   ========================= */

const ProgressTimeTooltip: React.FC<{
  active: boolean;
  positionX: number; // px - tooltip left offset
  time: number; // seconds
  ['data-unique-id']?: string;
}> = ({ active, positionX, time, ...rest }) => {
  const [hiddenStart, setHiddenStart] = useState(!active);
  const [hiddenEnd, setHiddenEnd] = useState(!active);
  const [timer, setTimer] = useState<number | null>(null);

  useEffect(() => {
    if (timer) window.clearTimeout(timer);
    const t = autoShowHideTransition(active, setHiddenStart, setHiddenEnd);
    setTimer(t);
    return () => {
      t && window.clearTimeout(t);
    };
  }, [active]);

  if (hiddenStart) return null;
  return (
    <div
      {...rest}
      className={`video-progress-time-tooltip player-text ${hiddenEnd ? 'hidden' : ''}`}
      style={{ left: positionX }}
    >
      {humanVideoTime(time)}
    </div>
  );
};

/* =========================
   Progress Bar (Drag / Hover)
   ========================= */

const ProgressBar: React.FC<{
  playbackPercent: number; // 0..100
  playbackDuration: number; // total seconds
  onChange?: (newTime: number, newPercent: number) => void;
  onDragStart?: () => void;
  onDragStop?: () => void;
  translation: typeof defaultStrings;
  ['data-unique-id']?: string;
}> = props => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const [cursorX, setCursorX] = useState(0);
  const [cursorPercent, setCursorPercent] = useState(0);

  const stop = useCallback(() => {
    props.onDragStop?.();
  }, [props.onDragStop]);

  const startDrag = (evt: React.MouseEvent | React.TouchEvent) => {
    props.onDragStart?.();
    setDragging(true);

    if (!rootRef.current) return;
    const zoom = getBodyZoom();
    const v = zoom.transformUsed ? zoom.value : 1;
    const rect = rootRef.current.getBoundingClientRect();
    const clientX = 'clientX' in evt ? evt.clientX : evt.touches[0].clientX;
    const x = clientX / zoom.value - rect.left / v;
    setCursorX(x);
    let ratio = x / (rect.width / v);
    ratio = Math.max(0, Math.min(1, ratio));
    setCursorPercent(ratio * 100);
    props.onChange?.(ratio * props.playbackDuration, ratio * 100);
  };

  const move = (evt: MouseEvent | TouchEvent) => {
    if (!rootRef.current) return;
    evt.preventDefault();

    const zoom = getBodyZoom();
    const v = zoom.transformUsed ? zoom.value : 1;
    const rect = rootRef.current.getBoundingClientRect();
    const clientX =
      evt instanceof MouseEvent ? evt.clientX : evt.touches[0].clientX;
    const x = clientX / zoom.value - rect.left / v;
    setCursorX(x);
    let ratio = x / (rect.width / v);
    ratio = Math.max(0, Math.min(1, ratio));
    setCursorPercent(ratio * 100);
    if (dragging) props.onChange?.(ratio * props.playbackDuration, ratio * 100);
  };

  // Global listeners for drag interactions
  useEventListener(window, 'mousemove', move as any);
  useEventListener(window, 'touchmove', move as any, { passive: false });
  useEventListener(window, 'mouseup', () => {
    setDragging(false);

    if (dragging) {
      stop();
    }
  });
  useEventListener(window, 'mouseleave', () => {
    setDragging(false);
    if (dragging) {
      stop();
    }
  });
  useEventListener(window, 'touchend', () => {
    setDragging(false);
    if (dragging) {
      stop();
    }
  });
  useEventListener(window, 'touchcancel', () => {
    setDragging(false);
    if (dragging) {
      stop();
    }
  });

  return (
    <div
      data-unique-id={props['data-unique-id']}
      className="video-progress-bar-wrapper"
    >
      <ProgressTimeTooltip
        active={hover || dragging}
        time={(cursorPercent / 100) * props.playbackDuration}
        positionX={cursorX - 25}
      />
      <div
        ref={rootRef}
        className="video-progress-bar player-shape"
        tabIndex={0}
        aria-label={props.translation.seek}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div
          className="progress"
          style={{ width: `${props.playbackPercent}%` }}
        />
      </div>
    </div>
  );
};

/* =========================
   Vertical Volume Slider
   ========================= */

const VolumeSlider: React.FC<{
  visible: boolean;
  isMuted: boolean;
  playbackVolume: number; // 0..1
  setPlaybackVolume: (v: number) => void;
  disableScrollingToChangeVolume?: boolean;
  ['data-unique-id']?: string;
}> = ({
  visible,
  isMuted,
  playbackVolume,
  setPlaybackVolume,
  disableScrollingToChangeVolume,
  ...rest
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const [hiddenStart, setHiddenStart] = useState(!visible);
  const [hiddenEnd, setHiddenEnd] = useState(!visible);
  const [smooth] = useState(false);
  const [drag, setDrag] = useState(false);
  const [timer, setTimer] = useState<number | null>(null);

  useEffect(() => {
    if (timer) window.clearTimeout(timer);
    const t = autoShowHideTransition(visible, setHiddenStart, setHiddenEnd);
    setTimer(t);
    return () => {
      t && window.clearTimeout(t);
    };
  }, [visible]);

  const setByEvent = (evt: MouseEvent | TouchEvent) => {
    if (!sliderRef.current) return;
    const zoom = getBodyZoom();
    const v = zoom.transformUsed ? zoom.value : 1;
    const clientY =
      evt instanceof MouseEvent ? evt.clientY : evt.touches[0].clientY;
    const rect = sliderRef.current.getBoundingClientRect();
    let ratio =
      (rect.height / v - (clientY / zoom.value - rect.top / v)) /
      (rect.height / v);
    ratio = Math.max(0, Math.min(1, ratio));
    setPlaybackVolume(ratio);
  };

  const start = (evt: React.MouseEvent | React.TouchEvent) => {
    setDrag(true);
    setByEvent((evt as any).nativeEvent as any);
  };

  const move = (evt: MouseEvent | TouchEvent) => {
    if (!drag) return;
    evt.preventDefault();
    setByEvent(evt);
  };

  useEventListener(window, 'mousemove', move as any);
  useEventListener(window, 'touchmove', move as any, { passive: false });
  useEventListener(window, 'mouseup', () => setDrag(false));
  useEventListener(window, 'mouseleave', () => setDrag(false));
  useEventListener(window, 'touchend', () => setDrag(false));
  useEventListener(window, 'touchcancel', () => setDrag(false));

  if (hiddenStart) return null;
  return (
    <div
      {...rest}
      ref={wrapperRef}
      className={`volume-bar${isMuted ? ' ' + 'muted' : ''}${hiddenEnd ? ' ' + 'hidden' : ''}${smooth ? ' ' + 'smooth' : ''}`}
      onMouseDown={start}
      onTouchStart={start}
    >
      <div ref={sliderRef} className="volume-slider">
        <div
          className="slider-main player-shape"
          style={{ height: `${playbackVolume * 100}%` }}
        />
      </div>
    </div>
  );
};

/* =========================
   Localized Strings
   ========================= */

const defaultStrings = {
  actions: {
    play: 'Play',
    pause: 'Pause',
    mute: 'Mute',
    unmute: 'Unmute',
    goFullscreen: 'Go fullscreen',
    exitFullscreen: 'Exit fullscreen',
  },
  seek: 'Seek',
  controlPanel: 'Playback control panel',
  defaultErrorText: 'Something went wrong...',
};

/* =========================
   Main Video Player
   ========================= */

export interface VideoPlayerProps {
  source?: string;
  srcObject?: MediaStream | null;
  isLive?: boolean;
  autoPlay?: boolean;
  alwaysShowControls?: boolean;
  width?: number;
  height?: number;
  disablePlaybackIcon?: boolean;
  disableScrollingToChangeVolume?: boolean;
  translation?: typeof defaultStrings;
  ['data-unique-id']?: string;
  poster?: string; // Poster thumbnail
  aspectRatio?: number | string; // Aspect ratio, e.g. 16/9 or 1.777
  fluid?: boolean; // Stretch to 100% of container width/height
  className?: string;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  muted?: boolean;
  onMuteChange?: (muted: boolean) => void;
  isLoading?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onPlaying?: () => void;
  onLoadedData?: () => void;
  onError?: (e?: any) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  source,
  srcObject,
  isLive = false,
  autoPlay = false,
  width,
  height,
  alwaysShowControls = false,
  disablePlaybackIcon = false,
  disableScrollingToChangeVolume = false,
  translation = defaultStrings,
  poster,
  className,
  aspectRatio,
  fluid = false,
  volume: propVolume,
  onVolumeChange,
  muted: propMuted,
  onMuteChange,
  isLoading = false,
  videoRef: externalVideoRef,
  onPlaying,
  onLoadedData,
  onError: propOnError,
  ...rest
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const overlayFocusRef = useRef<HTMLDivElement | null>(null);
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalVideoRef || internalVideoRef;

  // State
  const [showControls, setShowControls] = useState(alwaysShowControls);
  const [hiddenStart, setHiddenStart] = useState(!showControls);
  const [hiddenEnd, setHiddenEnd] = useState(!showControls);
  const [hideTimer, setHideTimer] = useState<number | null>(null);

  const [error, setError] = useState(false);
  const [buffering, setBuffer] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setFS] = useState(false);

  const [progressPct, setProgressPct] = useState(0);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const [volume, setVolume] = useState(propVolume ?? 1);
  const [muted, setMuted] = useState(propMuted ?? false);
  const [draggingScrub, setDraggingScrub] = useState(false);

  const [volPopover, setVolPopover] = useState(false);

  const handleSetVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
    if (clamped > 0 && muted) {
      setMuted(false);
    }
  };

  useEffect(() => {
    if (propVolume !== undefined) {
      setVolume(propVolume);
    }
  }, [propVolume]);

  useEffect(() => {
    if (propMuted !== undefined) {
      setMuted(propMuted);
    }
  }, [propMuted]);

  // Volume & mute synchronization
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = volume;
    videoRef.current.muted = muted;
    onVolumeChange?.(volume);
    onMuteChange?.(muted);
  }, [volume, muted, onVolumeChange, onMuteChange]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (srcObject !== undefined) {
      if (v.srcObject !== srcObject) {
        v.srcObject = srcObject;
      }
      if (autoPlay) {
        v.play().catch(() => {});
      }
    }
  }, [srcObject, autoPlay]);

  useEffect(() => {
    function onFSChange() {
      setFS(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFSChange);
    return () => document.removeEventListener('fullscreenchange', onFSChange);
  }, []);

  // Time text formatting
  const currentText = humanVideoTime(currentTime);
  const durationText = humanVideoTime(duration);

  useEffect(() => {
    const v = videoRef.current;
    const id = window.setInterval(() => {
      if (!v || draggingScrub) return;
      if (typeof v.currentTime === 'number' && !isNaN(v.currentTime)) {
        setCurrent(v.currentTime);
      }
      if (v.duration && isFinite(v.duration)) {
        setProgressPct((v.currentTime / v.duration) * 100);
        setDuration(v.duration);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [draggingScrub]);

  // Toggle playback
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  // Keyboard navigation
  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (!videoRef.current || !wrapperRef.current) return;
    const target = e.target as HTMLElement | null;
    if (!target || !wrapperRef.current.contains(target)) return;

    let t = 0;
    switch (e.key) {
      case ' ':
        if (!(target instanceof HTMLButtonElement)) togglePlay();
        break;
      case 'ArrowLeft':
        if (isLive) break;
        t = Math.max(0, currentTime - 5);
        videoRef.current.currentTime = t;
        setCurrent(t);
        setProgressPct(
          (videoRef.current.currentTime / (videoRef.current.duration || 1)) *
            100
        );
        break;
      case 'ArrowRight':
        if (isLive) break;
        t = Math.min(duration, currentTime + 5);
        videoRef.current.currentTime = t;
        setCurrent(t);
        setProgressPct(
          (videoRef.current.currentTime / (videoRef.current.duration || 1)) *
            100
        );
        break;
      case 'ArrowUp':
        handleSetVolume(Math.min(1, volume + 0.1));
        break;
      case 'ArrowDown':
        handleSetVolume(Math.max(0, volume - 0.1));
        break;
      default:
        // "M"
        if ((e as any).keyCode === 77) setMuted(m => !m);
    }
  });

  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (!videoRef.current) return;

    switch (e.key) {
      case ' ':
        if (isFullscreen) {
          e.stopPropagation();
          e.preventDefault();
          togglePlay();
        }
        break;
    }
  });

  // Auto show/hide controls
  useEffect(() => {
    if (hideTimer) window.clearTimeout(hideTimer);
    const t = autoShowHideTransition(
      showControls,
      setHiddenStart,
      setHiddenEnd
    );
    setHideTimer(t);
    return () => {
      t && window.clearTimeout(t);
    };
  }, [showControls]);

  // Fullscreen mode
  const toggleFullscreen = (e?: React.MouseEvent<HTMLButtonElement>) => {
    const root = wrapperRef.current;
    if (!root) return;
    if (!document.fullscreenElement) {
      root.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    // Return focus to overlay after click
    if (e?.target instanceof HTMLButtonElement) {
      overlayFocusRef.current?.focus();
    }
  };

  // Progress scrubbing
  const onScrubStart = () => setDraggingScrub(true);
  const onScrubStop = () => {
    setDraggingScrub(false);
    if (videoRef.current) {
      videoRef.current.currentTime = currentTime;
    }
  };
  const onScrubChange = (newTime: number, newPercent: number) => {
    setCurrent(newTime);
    setProgressPct(newPercent);
  };
  // Volume popover (open/close)
  const showVolume = () => setVolPopover(true);
  const hideVolume = () => setVolPopover(false);

  // Volume icon state
  let volState: VolumeIconState = VolumeIconState.High;
  if (muted) volState = VolumeIconState.Muted;
  else if (volume === 0) volState = VolumeIconState.VeryLow;
  else if (volume < 0.5) volState = VolumeIconState.Low;
  else if (volume < 0.7) volState = VolumeIconState.Mid;

  // Show controls on any user interaction
  const onOverlayClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setShowControls(true);
    togglePlay();
  };

  useEffect(() => {
    if (alwaysShowControls) return;

    const el = wrapperRef.current;
    if (!el) return;

    let timeoutId: number;

    const resetControlsTimer = () => {
      if (!videoRef.current || videoRef.current.paused) {
        setShowControls(true);
        return;
      }

      setShowControls(true);
      if (timeoutId) clearTimeout(timeoutId);

      timeoutId = window.setTimeout(() => {
        setShowControls(false);
      }, 2000);
    };

    const activityHandler = () => resetControlsTimer();

    el.addEventListener('mousemove', activityHandler);
    el.addEventListener('mousedown', activityHandler);
    el.addEventListener('touchstart', activityHandler);
    el.addEventListener('keydown', activityHandler);

    // Initial timer setup
    resetControlsTimer();

    return () => {
      clearTimeout(timeoutId);
      el.removeEventListener('mousemove', activityHandler);
      el.removeEventListener('mousedown', activityHandler);
      el.removeEventListener('touchstart', activityHandler);
      el.removeEventListener('keydown', activityHandler);
    };
  }, [playing, alwaysShowControls]);

  return (
    <div
      {...rest}
      className={clsx(
        'video-player-wrapper h-full max-h-full w-full max-w-full rounded-[10px]',
        className
      )}
    >
      <div
        ref={wrapperRef}
        style={{
          aspectRatio: aspectRatio
            ? typeof aspectRatio === 'number'
              ? `${aspectRatio}`
              : aspectRatio
            : undefined,

          width: fluid ? '100%' : width,
          height: height,
          backgroundImage: poster ? `url(${poster})` : undefined,
          backgroundSize: 'contain',
          backgroundPosition: 'center',
        }}
        className={`video-player ${error ? 'error' : ''} h-full max-w-full`}
      >
        {/* Media element */}
        {!error && (
          <div className="video-media-element">
            <video
              ref={videoRef}
              controls={false}
              src={source}
              poster={poster}
              autoPlay={autoPlay}
              playsInline
              muted={muted}
              onLoadStart={() => setBuffer(true)}
              onWaiting={() => setBuffer(true)}
              onCanPlay={() => {
                setBuffer(false);
                setError(false);
                onLoadedData?.();
              }}
              onLoadedData={() => {
                setBuffer(false);
                setError(false);
                onLoadedData?.();
              }}
              onPlaying={() => {
                setPlaying(true);
                setBuffer(false);
                onPlaying?.();
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={() => {
                if (videoRef.current && !draggingScrub) {
                  setCurrent(videoRef.current.currentTime);
                }
              }}
              onError={(e) => {
                setError(true);
                setBuffer(false);
                propOnError?.(e);
              }}
            />
          </div>
        )}

        <div className="video-controls">
          {/* Overlay (play/pause / error / spinner) */}
          <div
            ref={overlayFocusRef}
            className={`overlay ${(!playing && !disablePlaybackIcon) || buffering || isLoading ? '' : 'hidden'}`}
            onClick={!isLoading ? onOverlayClick : undefined}
            tabIndex={isFullscreen ? undefined : -1}
          >
            {!error && !disablePlaybackIcon && (
              <div
                className="playback-icon"
                title={
                  buffering || isLoading
                    ? undefined
                    : playing
                      ? translation.actions.pause
                      : translation.actions.play
                }
              >
                {!buffering && !isLoading && !error && !disablePlaybackIcon && (
                  <MaterialIcon
                    size={80}
                    className="player-icon"
                    filled={true}
                    icon={playing ? 'pause' : 'play-arrow'}
                  />
                )}
                {(buffering || isLoading) && (
                  <div className="loading-animation" aria-hidden>
                    <div className="spinner" />
                  </div>
                )}
              </div>
            )}
            {error && (
              <div className="playback-error flex flex-col items-center gap-[5px]">
                <MaterialIcon icon="warning" filled={true} size={80} />
                <p>{translation.defaultErrorText}</p>
              </div>
            )}
          </div>

          {/* Control panel */}
          {!error && !hiddenStart && (
            <div
              className={`main-actions ${hiddenEnd ? 'hidden' : ''}`}
              aria-label={translation.controlPanel}
            >
              <div className="content-layer">
                <BlurEffect
                  className={`blur-effect-overlay pointer-events-none absolute inset-x-0 bottom-0 z-2 ${isFullscreen ? 'fullscreen' : 'default'}`}
                  position="bottom"
                  intensity={200}
                />
                <div className="main relative z-[10] flex items-center gap-4 px-6">
                  {/* Play/Pause */}
                  <IconButton
                    className="play-toggle player-icon"
                    size="mini"
                    onClick={() => togglePlay()}
                    aria-label={
                      playing
                        ? translation.actions.pause
                        : translation.actions.play
                    }
                    title={
                      playing
                        ? translation.actions.pause
                        : translation.actions.play
                    }
                  >
                    <MaterialIcon
                      size={24}
                      filled={true}
                      icon={playing ? 'pause' : 'play-arrow'}
                    />
                  </IconButton>

                  {/* Current time */}
                  <div className="time-info current-time player-text">
                    {currentText}
                  </div>

                  {/* Progress bar */}
                  {!isLive ? (
                    <>
                      <ProgressBar
                        playbackPercent={progressPct}
                        playbackDuration={duration}
                        onDragStart={onScrubStart}
                        onDragStop={onScrubStop}
                        onChange={onScrubChange}
                        translation={translation}
                      />
                      <div className="time-info duration player-text">
                        {durationText}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1" />
                  )}

                  {/* Right side controls */}
                  <div className="ml-auto flex items-center gap-4">
                    {/* Volume */}
                    <div
                      className="volume-section flex items-center"
                      onMouseEnter={showVolume}
                      onMouseLeave={hideVolume}
                    >
                      <VolumeSlider
                        visible={volPopover}
                        isMuted={muted}
                        playbackVolume={volume}
                        setPlaybackVolume={handleSetVolume}
                        disableScrollingToChangeVolume={
                          disableScrollingToChangeVolume
                        }
                      />
                      <IconButton
                        className="mute-toggle player-icon"
                        size="mini"
                        onClick={() => setMuted((m) => !m)}
                        onFocus={showVolume}
                        aria-label={
                          muted
                            ? translation.actions.unmute
                            : translation.actions.mute
                        }
                        title={
                          muted
                            ? translation.actions.unmute
                            : translation.actions.mute
                        }
                      >
                        <VolumeAnimatedIcon state={volState} />
                      </IconButton>
                    </div>

                    {/* Fullscreen */}
                    <IconButton
                      className="fullscreen-toggle player-icon ml-1"
                      size="mini"
                      onClick={toggleFullscreen}
                      aria-label={
                        isFullscreen
                          ? translation.actions.exitFullscreen
                          : translation.actions.goFullscreen
                      }
                      title={
                        isFullscreen
                          ? translation.actions.exitFullscreen
                          : translation.actions.goFullscreen
                      }
                    >
                      <MaterialIcon
                        size={22}
                        className="player-icon"
                        icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
                      />
                    </IconButton>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
