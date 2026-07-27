'use client';

import { useMemo } from 'react';

interface Props {
  series: [number, number][];
  /** Highlights the frame you're currently looking at. */
  markerDistance?: number;
  height?: number;
}

/**
 * Elevation profile as a filled area chart. Hand-rolled SVG rather than a chart
 * library: the data is a simple series and this keeps the bundle small.
 */
export function ElevationProfile({ series, markerDistance, height = 72 }: Props) {
  const width = 600;

  const { path, area, minEle, maxEle, totalDistance } = useMemo(() => {
    const distances = series.map(([distance]) => distance);
    const elevations = series.map(([, elevation]) => elevation);

    const total = Math.max(...distances, 1);
    const low = Math.min(...elevations);
    const high = Math.max(...elevations);
    // Flat routes would otherwise render as a single line across the middle.
    const span = Math.max(high - low, 20);

    const toPoint = (distance: number, elevation: number) => {
      const x = (distance / total) * width;
      const y = height - ((elevation - low) / span) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };

    const points = series.map(([distance, elevation]) => toPoint(distance, elevation));

    return {
      path: `M${points.join(' L')}`,
      area: `M0,${height} L${points.join(' L')} L${width},${height} Z`,
      minEle: low,
      maxEle: high,
      totalDistance: total,
    };
  }, [series, height]);

  if (series.length < 2) return null;

  const markerX =
    markerDistance === undefined ? null : (markerDistance / totalDistance) * width;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-18 w-full"
        style={{ height }}
        role="img"
        aria-label={`Elevation profile, ${Math.round(minEle)} to ${Math.round(maxEle)} metres`}
      >
        <defs>
          <linearGradient id="elevation-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-clay-400)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-clay-400)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#elevation-fill)" />
        <path d={path} fill="none" stroke="var(--color-clay-400)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {markerX !== null && (
          <line
            x1={markerX}
            y1="0"
            x2={markerX}
            y2={height}
            stroke="var(--color-sand-200)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-sand-400/70">
        <span>{Math.round(minEle)} m</span>
        <span>{Math.round(maxEle)} m</span>
      </figcaption>
    </figure>
  );
}
