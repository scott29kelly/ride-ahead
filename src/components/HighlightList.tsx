import type { Highlight } from '@/lib/types';
import { formatDistance } from './format';

const CATEGORY_ICON: Record<string, string> = {
  viewpoint: '◭',
  nature: '⛰',
  water: '≈',
  historic: '⌂',
  landmark: '★',
  park: '❦',
  art: '◈',
  refuel: '☕',
  services: '⚑',
};

/** The "what will I actually see" list, ordered the way you'll ride past them. */
export function HighlightList({ highlights }: { highlights: Highlight[] }) {
  if (highlights.length === 0) {
    return (
      <p className="text-sm text-sand-400/70">
        Nothing notable tagged along this route in OpenStreetMap. That often means the area is
        under-mapped rather than dull.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {highlights.map((highlight) => (
        <li
          key={highlight.poi.id}
          className="flex gap-3 rounded-lg bg-bark-900 p-3 ring-1 ring-bark-700"
        >
          {highlight.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={highlight.image.url}
              alt=""
              className="h-14 w-20 shrink-0 rounded object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-bark-800 text-lg text-sand-400/50">
              {CATEGORY_ICON[highlight.poi.category] ?? '•'}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="truncate font-medium text-sand-200">{highlight.poi.name}</h4>
              <span className="shrink-0 text-xs text-sand-400/70">
                {formatDistance(highlight.poi.distanceAlongRoute)}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-snug text-sand-400/80">{highlight.reason}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
