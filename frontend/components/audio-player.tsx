"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Hls from "hls.js";
import { Pause, Play } from "lucide-react";

import { AUDIO_SEGMENT_CAPS } from "@/hooks/use-game";
import { proxiedTidalPreviewUrl } from "@/lib/preview-url";

const TIMELINE_GAME_SECONDS = 16;
const TIMELINE_WIN_SECONDS = 30;

const DIVIDER_SECONDS = [1, 2, 4, 7, 11] as const;

function clampAttempt(n: number): number {
  return Math.min(
    Math.max(Math.floor(n), 0),
    AUDIO_SEGMENT_CAPS.length - 1,
  );
}

function segmentLimitForAttempt(attempt: number): number {
  return AUDIO_SEGMENT_CAPS[clampAttempt(attempt)];
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}

export type AudioPlayerProps = {
  previewUrl: string | null | undefined;
  currentAttempt: number;
  attemptEpoch: number;
  /** When this changes (e.g. category switch), scrub time + progress bar reset for the new deck. */
  deckId?: string;
  disabled?: boolean;
  expandTimelineTo30s?: boolean;
  /** After WON/LOST — allow full preview segment instead of capping at the winning attempt length. */
  isFinished?: boolean;
  onPlayingChange?: (playing: boolean) => void;
};

export function AudioPlayer({
  previewUrl,
  currentAttempt,
  attemptEpoch,
  deckId = "",
  disabled,
  expandTimelineTo30s = false,
  isFinished = false,
  onPlayingChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  /** Parent often passes an inline `onPlayingChange` → must not land in effect deps. */
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);

  const segmentLimit = useMemo(() => {
    if (isFinished) {
      return TIMELINE_WIN_SECONDS;
    }
    return segmentLimitForAttempt(currentAttempt);
  }, [currentAttempt, isFinished]);

  const visualTotalSeconds =
    expandTimelineTo30s || isFinished
      ? TIMELINE_WIN_SECONDS
      : TIMELINE_GAME_SECONDS;

  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const setPlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setIsPlaying(next);
    onPlayingChangeRef.current?.(next);
  }, []);

  const pumpPlayback = useCallback(() => {
    // Use a local `tick` closure to avoid self-referencing `pumpPlayback`
    // (helps keep React/ESLint happy and ensures RAF cancellation works).
    const tick = () => {
      const el = audioRef.current;
      if (!el || !playingRef.current) {
        stopRaf();
        return;
      }

      const t = el.currentTime;
      if (t >= segmentLimit) {
        el.pause();
        el.currentTime = segmentLimit;
        setDisplayTime(segmentLimit);
        setPlaying(false);
        stopRaf();
        return;
      }

      setDisplayTime(t);
      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, [segmentLimit, setPlaying, stopRaf]);

  useEffect(() => {
    if (!previewUrl) {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayTime(0);
      stopRaf();
      playingRef.current = false;
      setIsPlaying(false);
      onPlayingChangeRef.current?.(false);
      return undefined;
    }

    let cancelled = false;
    /** Snapshot for cleanup (avoid stale `audioRef.current` in teardown). */
    let boundEl: HTMLAudioElement | null = null;

    const teardown = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (boundEl) {
        boundEl.pause();
        boundEl.removeAttribute("src");
        boundEl.load();
      }
      boundEl = null;
    };

    const attach = (el: HTMLAudioElement) => {
      teardown();
      boundEl = el;
      el.crossOrigin = "anonymous";
      el.removeAttribute("src");
      el.load();

      const hlsUrl = isHlsUrl(previewUrl);

      if (hlsUrl && Hls.isSupported()) {
        const hls = new Hls({
          // Worker fetch can break CORS on some CDN manifests; main-thread XHR is more predictable.
          enableWorker: false,
          lowLatencyMode: false,
          // TIDAL does not send CORS headers; route every XHR through the API (backend must run).
          xhrSetup: (xhr, url) => {
            xhr.open("GET", proxiedTidalPreviewUrl(url), true);
          },
        });
        hlsRef.current = hls;
        hls.loadSource(previewUrl);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            hls.destroy();
            hlsRef.current = null;
          }
        });
      } else if (hlsUrl && el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = proxiedTidalPreviewUrl(previewUrl);
      } else {
        el.src = proxiedTidalPreviewUrl(previewUrl);
      }
    };

    const elNow = audioRef.current;
    if (elNow) {
      attach(elNow);
    } else {
      const raf = requestAnimationFrame(() => {
        if (cancelled) return;
        const next = audioRef.current;
        if (next) attach(next);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        teardown();
      };
    }

    return () => {
      cancelled = true;
      teardown();
    };
  }, [previewUrl, stopRaf]);

  // Only reset media when the *round* changes — not on every parent re-render (unstable callbacks
  // from inline props used to make this effect re-run constantly and kill HLS / currentTime).
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !previewUrl) return;
    el.pause();
    el.currentTime = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayTime(0);
    playingRef.current = false;
    setIsPlaying(false);
    onPlayingChangeRef.current?.(false);
    stopRaf();
  }, [attemptEpoch, previewUrl, segmentLimit, stopRaf, deckId]);

  useEffect(() => () => stopRaf(), [stopRaf]);

  const toggle = useCallback(() => {
    if (disabled || !previewUrl) return;
    const el = audioRef.current;
    if (!el) return;

    if (isPlaying) {
      el.pause();
      setPlaying(false);
      stopRaf();
      return;
    }

    if (el.currentTime >= segmentLimit - 0.0005) {
      el.currentTime = 0;
      setDisplayTime(0);
    }

    void el
      .play()
      .then(() => {
        setPlaying(true);
        stopRaf();
        rafRef.current = requestAnimationFrame(pumpPlayback);
      })
      .catch(() => {
        setPlaying(false);
        stopRaf();
      });
  }, [
    disabled,
    previewUrl,
    isPlaying,
    segmentLimit,
    pumpPlayback,
    setPlaying,
    stopRaf,
  ]);

  // While the game is "LOCKED" (guess submitting), freeze playback immediately.
  // This prevents any additional snippet time from being consumed during verification.
  useEffect(() => {
    if (!disabled) return;
    const el = audioRef.current;
    if (!el) return;
    if (!playingRef.current) return;
    el.pause();
    playingRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsPlaying(false);
    stopRaf();
    onPlayingChangeRef.current?.(false);
  }, [disabled, stopRaf]);

  // Chrome cannot play TIDAL HLS via raw <audio src>; hls.js handles that. Never gate the button on
  // canplay — those events often never fire for m3u8 in Chromium.
  const playDisabled = Boolean(disabled) || !previewUrl;

  const timeLabelColor = isPlaying ? "#0000FF" : "rgba(0,0,0,0.55)";

  return (
    <div className="w-full">
      {previewUrl ? (
        <audio
          key={previewUrl}
          ref={audioRef}
          preload="auto"
          playsInline
          className="hidden"
          onPause={() => {
            stopRaf();
          }}
          onEnded={() => {
            setPlaying(false);
            stopRaf();
          }}
        />
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={playDisabled}
          onClick={toggle}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-bold transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ backgroundColor: "#0000FF", color: "#ffffff" }}
          aria-label={isPlaying ? "Pauza" : "Odtwórz"}
        >
          {isPlaying ? (
            <Pause className="h-5 w-5 fill-current text-white" aria-hidden />
          ) : (
            <Play className="ml-0.5 h-5 w-5 fill-current text-white" aria-hidden />
          )}
        </button>

        <SegmentedProgressVisualizer
          visualTotalSeconds={visualTotalSeconds}
          segmentLimitSeconds={segmentLimit}
          progressSeconds={displayTime}
          dividerSeconds={DIVIDER_SECONDS}
        />
      </div>

      <div className="mt-4 flex items-end justify-between">
        <span
          className="font-mono text-[10px] font-bold tabular-nums"
          style={{ color: timeLabelColor }}
        >
          {displayTime.toFixed(1)} sekundy / {segmentLimit.toFixed(1)} sekundy
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wide text-black/45">
          [Powered by TIDAL]
        </span>
      </div>
    </div>
  );
}

type SegmentedProgressVisualizerProps = {
  visualTotalSeconds: number;
  segmentLimitSeconds: number;
  progressSeconds: number;
  dividerSeconds: readonly number[];
};

function SegmentedProgressVisualizer({
  visualTotalSeconds,
  segmentLimitSeconds,
  progressSeconds,
  dividerSeconds,
}: SegmentedProgressVisualizerProps) {
  const limitPct = (segmentLimitSeconds / visualTotalSeconds) * 100;
  const progressPct =
    (Math.min(progressSeconds, segmentLimitSeconds) / visualTotalSeconds) *
    100;

  return (
    <div className="min-w-0 flex-1">
      <div className="relative h-3 overflow-visible rounded-sm border border-black/20 bg-[#EBE7DF]">
        <div
          className="absolute inset-y-0 left-0 z-0 border-r border-black/25 bg-[#a0a0a0]"
          style={{ width: `${limitPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 z-0 bg-black/45"
          style={{ width: `${100 - limitPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 z-[1]"
          style={{
            width: `${progressPct}%`,
            backgroundColor: "#0000FF",
          }}
        />
        {dividerSeconds.map((s) => {
          const left = (s / visualTotalSeconds) * 100;
          if (left >= 100) return null;
          return (
            <div
              key={s}
              className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-black/55"
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
