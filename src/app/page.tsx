'use client';

import { useCallback, useEffect, useState } from 'react';
import { ElevationProfile } from '@/components/ElevationProfile';
import { HighlightList } from '@/components/HighlightList';
import { PreviewStrip } from '@/components/PreviewStrip';
import { RouteCard } from '@/components/RouteCard';
import { RouteForm, type FormValues } from '@/components/RouteForm';
import { RouteMap } from '@/components/RouteMap';
import { formatDistance, formatDuration } from '@/components/format';
import type { LngLat, PreviewFrame, PreviewResponse } from '@/lib/types';

export default function Home() {
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  // Ask the server what it's configured with, so the banner reflects reality.
  useEffect(() => {
    fetch('/api/preview')
      .then((response) => response.json())
      .then((config) => setDemoMode(Boolean(config.demoMode)))
      .catch(() => undefined);
  }, []);

  const submit = useCallback(async (values: FormValues) => {
    setLoading(true);
    setError(null);
    setFrame(null);

    try {
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await response.json();

      if (!response.ok) throw new Error(body.error ?? 'Something went wrong.');

      setResult(body as PreviewResponse);
      setSelectedId(body.routes?.[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const selected = result?.routes.find((route) => route.id === selectedId) ?? null;
  const markerCoord: LngLat | undefined = frame?.coord;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-sand-200 sm:text-4xl">
          Ride<span className="text-clay-400">Ahead</span>
        </h1>
        <p className="mt-2 max-w-xl text-sand-400">
          Pick a few places you might ride to. Get a photo preview of each route and what you&apos;d
          pass on the way, then choose the one you actually want.
        </p>
      </header>

      {demoMode && (
        <p className="mb-6 rounded-lg bg-bark-900 px-4 py-3 text-sm text-sand-400 ring-1 ring-bark-700">
          <strong className="text-clay-400">Demo mode.</strong> Serving three bundled sample rides
          around Boulder, Colorado with generated illustrations instead of photos. Add an{' '}
          <code className="text-sand-200">ORS_API_KEY</code> and set{' '}
          <code className="text-sand-200">RIDEAHEAD_DEMO=0</code> to preview real routes anywhere.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          {/* The config fetch resolves after first paint, so remount the form
              on the answer — its defaults are initial state and would
              otherwise never pick up the demo prefill. */}
          <RouteForm
            key={demoMode ? 'demo' : 'live'}
            onSubmit={submit}
            loading={loading}
            initial={
              demoMode
                ? { start: 'Boulder Public Library', destinations: ['Chautauqua Park', 'Boulder Canyon', 'NCAR'] }
                : undefined
            }
          />

          {error && (
            <p className="rounded-lg bg-red-950/50 px-4 py-3 text-sm text-red-300 ring-1 ring-red-900">
              {error}
            </p>
          )}

          {result && result.routes.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-sand-400">
                {result.routes.length === 1 ? 'Your route' : 'Compare'}
              </h2>
              {result.routes.map((preview) => (
                <RouteCard
                  key={preview.id}
                  preview={preview}
                  selected={preview.id === selectedId}
                  onSelect={() => {
                    setSelectedId(preview.id);
                    setFrame(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <section className="min-w-0">
          {!selected && !loading && (
            <div className="flex h-64 items-center justify-center rounded-xl bg-bark-900 px-6 text-center text-sand-400/70 ring-1 ring-bark-700">
              Enter a start and at least one destination to see what the ride looks like.
            </div>
          )}

          {loading && (
            <div className="flex h-64 items-center justify-center rounded-xl bg-bark-900 text-sand-400 ring-1 ring-bark-700">
              Routing, finding places, and pulling photos…
            </div>
          )}

          {selected && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-sand-200">{selected.destination.name}</h2>
                <p className="mt-1 text-sm text-sand-400">{selected.destination.label}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-sand-400">
                  <span>
                    <strong className="text-sand-200">{formatDistance(selected.distance)}</strong> ride
                  </span>
                  <span>
                    ~<strong className="text-sand-200">{formatDuration(selected.duration)}</strong>
                  </span>
                  {selected.elevation && (
                    <>
                      <span>
                        ↑ <strong className="text-sand-200">{selected.elevation.ascent} m</strong> climbing
                      </span>
                      <span>
                        steepest <strong className="text-sand-200">{selected.elevation.maxGradient}%</strong>
                      </span>
                    </>
                  )}
                </div>
              </div>

              <PreviewStrip frames={selected.frames} onFrameChange={setFrame} />

              {selected.elevationSeries && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-sand-400">
                    Elevation
                  </h3>
                  <ElevationProfile
                    series={selected.elevationSeries}
                    markerDistance={frame?.distance}
                  />
                </div>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-sand-400">
                    What you&apos;ll pass
                  </h3>
                  <HighlightList highlights={selected.highlights} />
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-sand-400">
                    The route
                  </h3>
                  <div className="h-80 overflow-hidden rounded-xl ring-1 ring-bark-700">
                    <RouteMap
                      geometry={selected.geometry}
                      highlights={selected.highlights}
                      marker={markerCoord}
                    />
                  </div>
                </div>
              </div>

              <footer className="space-y-1 border-t border-bark-800 pt-4 text-xs text-sand-400/60">
                <p>
                  Routing: {selected.sources.routing} · Places: {selected.sources.pois} · Imagery:{' '}
                  {selected.sources.imagery.join(', ') || 'none found'}
                </p>
                {selected.warnings.map((warning) => (
                  <p key={warning} className="text-amber-500/70">
                    {warning}
                  </p>
                ))}
              </footer>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
