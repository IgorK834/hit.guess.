"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pause, Play } from "lucide-react";

import { AUDIO_SEGMENT_CAPS } from "@/hooks/use-game";

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

export type AudioPlayerProps = {
  previewUrl: string | null | undefined;
  currentAttempt: number;
  attemptEpoch: number;
  disabled?: boolean;
  expandTimelineTo30s?: boolean;
  onPlayingChange?: (playing: boolean) => void;
};

export function AudioPlayer({
  previewUrl,
  currentAttempt,
  attemptEpoch,
  disabled,
  expandTimelineTo30s = false,
  onPlayingChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);

  const segmentLimit = useMemo(
    () => segmentLimitForAttempt(currentAttempt),
    [currentAttempt],
  );

  const visualTotalSeconds = expandTimelineTo30s
    ? TIMELINE_WIN_SECONDS
    : TIMELINE_GAME_SECONDS;

  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [mediaReady, setMediaReady] = useState(false);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const setPlaying = useCallback(
    (next: boolean) => {
      playingRef.current = next;
      setIsPlaying(next);
      onPlayingChange?.(next);
    },
    [onPlayingChange],
  );

  const pumpPlayback = useCallback(() => {
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
    rafRef.current = requestAnimationFrame(pumpPlayback);
  }, [segmentLimit, setPlaying, stopRaf]);

  useEffect(() => {
    if (!previewUrl) return undefined;

    let cancelled = false;

    const attach = (el: HTMLAudioElement) => {
      const onWaiting = () => setIsBuffering(true);
      const onCanPlay = () => {
        setIsBuffering(false);
        setMediaReady(true);
      };
      const onPlaying = () => setIsBuffering(false);
      const onLoadStart = () => {
        setMediaReady(false);
        setIsBuffering(true);
      };

      el.addEventListener("waiting", onWaiting);
      el.addEventListener("canplay", onCanPlay);
      el.addEventListener("canplaythrough", onCanPlay);
      el.addEventListener("playing", onPlaying);
      el.addEventListener("loadstart", onLoadStart);

      if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        setMediaReady(true);
        setIsBuffering(false);
      }

      return () => {
        el.removeEventListener("waiting", onWaiting);
        el.removeEventListener("canplay", onCanPlay);
        el.removeEventListener("canplaythrough", onCanPlay);
        el.removeEventListener("playing", onPlaying);
        el.removeEventListener("loadstart", onLoadStart);
      };
    };

    const el = audioRef.current;
    if (el) {
      return attach(el);
    }

    let detach: (() => void) | undefined;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const next = audioRef.current;
      if (next) detach = attach(next);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      detach?.();
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!previewUrl) {
      setMediaReady(false);
      setIsBuffering(false);
      setDisplayTime(0);
      stopRaf();
      setPlaying(false);
    }
  }, [previewUrl, stopRaf, setPlaying]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setDisplayTime(0);
    setPlaying(false);
    stopRaf();
  }, [attemptEpoch, previewUrl, segmentLimit, setPlaying, stopRaf]);

  useEffect(() => () => stopRaf(), [stopRaf]);

  const toggle = useCallback(() => {
    if (disabled || !previewUrl || !mediaReady || isBuffering) return;
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
    mediaReady,
    isBuffering,
    isPlaying,
    segmentLimit,
    pumpPlayback,
    setPlaying,
    stopRaf,
  ]);

  const playDisabled =
    Boolean(disabled) || !previewUrl || !mediaReady || isBuffering;

  const timeLabelColor = isPlaying ? "#0000FF" : "rgba(0,0,0,0.55)";

  return (
    <div className="w-full">
      {previewUrl ? (
        <audio
          key={previewUrl}
          ref={audioRef}
          src={previewUrl}
          preload="auto"
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
        {/* Unlocked (allowed) window */}
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
