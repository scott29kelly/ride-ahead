import type { RoutePreview } from '@/lib/types';
import { formatDistance, formatDuration } from './format';
import { RouteSketch } from './RouteSketch';

interface Props {
  preview: RoutePreview;
  selected: boolean;
  onSelect: () => void;
}

/** One candidate ride, sized to be compared against two others at a glance. */
export function RouteCard({ preview, selected, onSelect }: Props) {
  const hero = preview.highlights.find((highlight) => highlight.image)?.image
    ?? preview.frames.find((frame) => frame.image)?.image;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex w-full flex-col overflow-hidden rounded-xl bg-bark-900 text-left ring-1 transition ${
        selected ? 'ring-2 ring-clay-400' : 'ring-bark-700 hover:ring-bark-600'
      }`}
    >
      <div className="relative h-32 bg-bark-800">
        {hero ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={hero.url} alt="" className="h-full w-full object-cover opacity-80" loading="lazy" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-bark-900 to-transparent" />
        <RouteSketch
          geometry={preview.geometry}
          highlights={preview.highlights}
          className="absolute bottom-2 right-2 h-16 w-24 opacity-90"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-semibold text-sand-200">{preview.destination.name}</h3>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-sand-400">
          <span>{formatDistance(preview.distance)}</span>
          <span>{formatDuration(preview.duration)}</span>
          {preview.elevation && <span>↑ {preview.elevation.ascent} m</span>}
        </div>

        {preview.vibes.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {preview.vibes.map((vibe) => (
              <li
                key={vibe}
                className="rounded-full bg-bark-800 px-2 py-0.5 text-[11px] text-sand-400 ring-1 ring-bark-700"
              >
                {vibe}
              </li>
            ))}
          </ul>
        )}

        <p className="text-sm leading-snug text-sand-400/85">{preview.summary}</p>

        <p className="mt-auto pt-1 text-[11px] text-sand-400/60">
          {preview.highlights.length} highlights ·{' '}
          {preview.frames.filter((frame) => frame.image).length} preview photos
        </p>
      </div>
    </button>
  );
}
