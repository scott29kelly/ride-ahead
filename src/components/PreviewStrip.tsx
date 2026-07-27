'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewFrame } from '@/lib/types';
import { compass, formatDistance } from './format';

interface Props {
  frames: PreviewFrame[];
  onFrameChange?: (frame: PreviewFrame) => void;
}

const PLAYBACK_MS = 1400;

/**
 * The flythrough: a large view of one point on the route, with a scrubbable
 * filmstrip underneath. Playing it steps forward along the route, which is the
 * closest thing to "riding it before you ride it".
 */
export function PreviewStrip({ frames, onFrameChange }: Props) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  const withImages = frames.filter((frame) => frame.image);
  const current = frames[index];

  const go = useCallback(
    (next: number) => {
      if (frames.length === 0) return;
      const clamped = (next + frames.length) % frames.length;
      setIndex(clamped);
      onFrameChange?.(frames[clamped]);
    },
    [frames, onFrameChange],
  );

  useEffect(() => {
    if (!playing || frames.length === 0) return;

    const timer = setInterval(() => {
      setIndex((previous) => {
        // Stop at the end rather than looping — you've arrived.
        if (previous >= frames.length - 1) {
          setPlaying(false);
          return previous;
        }
        const next = previous + 1;
        onFrameChange?.(frames[next]);
        return next;
      });
    }, PLAYBACK_MS);

    return () => clearInterval(timer);
  }, [playing, frames, onFrameChange]);

  // Keep the active thumbnail in view as playback advances.
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.children[index] as HTMLElement | undefined;
    if (strip && active) {
      strip.scrollTo({
        left: active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [index]);

  if (frames.length === 0 || !current) {
    return <p className="text-sm text-sand-400/70">No preview frames for this route.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-bark-800 ring-1 ring-bark-700">
        {current.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={current.image.url}
            alt={`View at ${formatDistance(current.distance)} along the route`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-sand-400/60">
            No street-level photo covers this stretch.
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bark-950/95 via-bark-950/50 to-transparent p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg font-semibold text-sand-200">
              {formatDistance(current.distance)} in
            </span>
            <span className="text-xs text-sand-400">
              heading {compass(current.bearing)}
              {current.elevation !== undefined && ` · ${current.elevation} m`}
            </span>
          </div>
          {current.nearbyPois.length > 0 && (
            <p className="mt-1 text-sm text-clay-400">
              {current.nearbyPois.map((poi) => poi.name).join(' · ')}
            </p>
          )}
        </div>

        {current.image && (
          <a
            href={current.image.sourceUrl ?? current.image.fullUrl ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            className="absolute right-2 top-2 rounded bg-bark-950/70 px-2 py-1 text-[10px] text-sand-400 hover:text-sand-200"
          >
            {current.image.attribution}
          </a>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => go(index - 1)}
          className="rounded-lg bg-bark-800 px-3 py-1.5 text-sm text-sand-200 ring-1 ring-bark-700 hover:bg-bark-700"
          aria-label="Previous point on the route"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          className="rounded-lg bg-clay-500 px-4 py-1.5 text-sm font-medium text-bark-950 hover:bg-clay-400"
        >
          {playing ? 'Pause' : 'Play flythrough'}
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          className="rounded-lg bg-bark-800 px-3 py-1.5 text-sm text-sand-200 ring-1 ring-bark-700 hover:bg-bark-700"
          aria-label="Next point on the route"
        >
          →
        </button>
        <span className="ml-auto text-xs text-sand-400/70">
          {index + 1} / {frames.length}
          {withImages.length < frames.length && ` · ${withImages.length} with photos`}
        </span>
      </div>

      <div ref={stripRef} className="filmstrip flex gap-2 overflow-x-auto pb-2">
        {frames.map((frame, frameIndex) => (
          <button
            key={frame.distance}
            type="button"
            onClick={() => go(frameIndex)}
            aria-current={frameIndex === index}
            aria-label={`Jump to ${formatDistance(frame.distance)}`}
            className={`relative h-14 w-24 shrink-0 overflow-hidden rounded-md ring-2 transition ${
              frameIndex === index ? 'ring-clay-400' : 'ring-transparent hover:ring-bark-600'
            }`}
          >
            {frame.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={frame.image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="h-full w-full bg-bark-800" />
            )}
            <span className="absolute inset-x-0 bottom-0 bg-bark-950/75 text-[10px] text-sand-400">
              {(frame.distance / 1000).toFixed(1)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
