import type { Highlight, LngLat } from '@/lib/types';

interface Props {
  geometry: LngLat[];
  highlights?: Highlight[];
  /** Marks where along the route the current preview frame sits. */
  marker?: LngLat;
  className?: string;
}

/**
 * A dependency-free sketch of the route shape.
 *
 * Deliberately not a map: on a comparison card the thing you're reading is
 * "is this a straight out-and-back or a loop through the hills", and a shape
 * answers that instantly without waiting on tiles.
 */
export function RouteSketch({ geometry, highlights = [], marker, className = '' }: Props) {
  if (geometry.length < 2) return null;

  const width = 200;
  const height = 120;
  const padding = 10;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (const [lng, lat] of geometry) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  // Correct for longitude degrees being shorter than latitude degrees away from
  // the equator, so the sketch keeps the route's real proportions.
  const latScale = Math.cos(((north + south) / 2) * (Math.PI / 180));
  const spanX = Math.max((east - west) * latScale, 1e-6);
  const spanY = Math.max(north - south, 1e-6);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);

  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  const project = ([lng, lat]: LngLat): [number, number] => [
    offsetX + (lng - west) * latScale * scale,
    // Flip: SVG y grows downward, latitude grows upward.
    offsetY + (north - lat) * scale,
  ];

  const path = geometry
    .map((coord, index) => {
      const [x, y] = project(coord);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const [startX, startY] = project(geometry[0]);
  const [endX, endY] = project(geometry.at(-1)!);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Route shape"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-sky-ride)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {highlights.map((highlight) => {
        const [x, y] = project(highlight.poi.coord);
        return <circle key={highlight.poi.id} cx={x} cy={y} r="2.5" fill="var(--color-clay-400)" />;
      })}
      <circle cx={startX} cy={startY} r="4" fill="var(--color-moss-400)" />
      <circle cx={endX} cy={endY} r="4" fill="var(--color-clay-500)" />
      {marker &&
        (() => {
          const [x, y] = project(marker);
          return <circle cx={x} cy={y} r="4" fill="var(--color-sand-200)" stroke="var(--color-bark-950)" strokeWidth="1.5" />;
        })()}
    </svg>
  );
}
