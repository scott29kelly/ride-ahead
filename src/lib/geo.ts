import type { LngLat, RoutePoint } from './types';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversine(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLng = toRad(lng2 - lng1);
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);

  const y = Math.sin(dLng) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest angle between two bearings, 0–180. Used to match photos to travel direction. */
export function bearingDelta(a: number, b: number): number {
  const diff = Math.abs(((a - b + 180 + 360) % 360) - 180);
  return diff;
}

/** Point at `fraction` between two coordinates. Linear interpolation is fine at sub-km spans. */
export function interpolate(a: LngLat, b: LngLat, fraction: number): LngLat {
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
}

/**
 * Walk a raw coordinate list and attach cumulative distance and bearing to each vertex.
 * Zero-length segments are dropped so bearings never come from a duplicated point.
 */
export function buildRoutePoints(coords: LngLat[], elevations?: number[]): RoutePoint[] {
  if (coords.length === 0) return [];

  const points: RoutePoint[] = [];
  let cumulative = 0;

  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      const step = haversine(coords[i - 1], coords[i]);
      if (step === 0 && i !== coords.length - 1) continue;
      cumulative += step;
    }
    // Bearing looks forward to the next distinct point, or back from the previous one at the end.
    const next = coords[i + 1];
    const prev = points.at(-1)?.coord;
    const heading = next ? bearing(coords[i], next) : prev ? bearing(prev, coords[i]) : 0;

    points.push({
      coord: coords[i],
      distance: cumulative,
      elevation: elevations?.[i],
      bearing: heading,
    });
  }

  return points;
}

/**
 * Pick evenly spaced points along the route, interpolating between vertices so
 * frames land at exact distances rather than wherever the router happened to
 * place a node. Always includes the start and the finish.
 */
export function sampleAlongRoute(points: RoutePoint[], count: number): RoutePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1 || count <= 1) return [points[0]];

  const total = points.at(-1)!.distance;
  if (total === 0) return [points[0]];

  const targets = Array.from({ length: count }, (_, i) => (total * i) / (count - 1));
  const samples: RoutePoint[] = [];
  let cursor = 0;

  for (const target of targets) {
    while (cursor < points.length - 2 && points[cursor + 1].distance < target) cursor++;

    const a = points[cursor];
    const b = points[cursor + 1] ?? a;
    const span = b.distance - a.distance;
    const fraction = span > 0 ? (target - a.distance) / span : 0;

    samples.push({
      coord: interpolate(a.coord, b.coord, fraction),
      distance: target,
      elevation: lerpMaybe(a.elevation, b.elevation, fraction),
      bearing: a.bearing,
    });
  }

  return samples;
}

function lerpMaybe(a: number | undefined, b: number | undefined, f: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + (b - a) * f;
}

export interface RouteProjection {
  /** Metres from the point to the closest spot on the route. */
  offset: number;
  /** Metres along the route where that closest spot is. */
  distanceAlong: number;
  coord: LngLat;
}

/**
 * Closest approach of an arbitrary point to the route line. Projects onto each
 * segment in a local equirectangular frame, which is accurate at the scale of
 * a single segment and far cheaper than a proper geodesic solve.
 */
export function projectOntoRoute(points: RoutePoint[], target: LngLat): RouteProjection {
  if (points.length === 0) {
    return { offset: Infinity, distanceAlong: 0, coord: target };
  }
  if (points.length === 1) {
    return { offset: haversine(points[0].coord, target), distanceAlong: 0, coord: points[0].coord };
  }

  const latScale = Math.cos(toRad(target[1]));
  let best: RouteProjection = { offset: Infinity, distanceAlong: 0, coord: points[0].coord };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i].coord;
    const b = points[i + 1].coord;

    // Project into a flat metre-ish space so the clamp below behaves.
    const ax = a[0] * latScale;
    const ay = a[1];
    const bx = b[0] * latScale;
    const by = b[1];
    const px = target[0] * latScale;
    const py = target[1];

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));

    const closest = interpolate(a, b, t);
    const offset = haversine(closest, target);

    if (offset < best.offset) {
      const segmentLength = points[i + 1].distance - points[i].distance;
      best = {
        offset,
        distanceAlong: points[i].distance + segmentLength * t,
        coord: closest,
      };
    }
  }

  return best;
}

/** Bounding box as [west, south, east, north], padded by `padMetres`. */
export function boundingBox(coords: LngLat[], padMetres = 0): [number, number, number, number] {
  if (coords.length === 0) return [0, 0, 0, 0];

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const [lng, lat] of coords) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  if (padMetres > 0) {
    const latPad = (padMetres / EARTH_RADIUS_M) * (180 / Math.PI);
    const midLat = (north + south) / 2;
    const lngPad = latPad / Math.max(0.01, Math.cos(toRad(midLat)));
    west -= lngPad;
    east += lngPad;
    south -= latPad;
    north += latPad;
  }

  return [west, south, east, north];
}

/**
 * Thin a coordinate list so consecutive kept points are at least `minGap` apart.
 * Used to keep Overpass corridor queries small on long routes.
 */
export function decimate(points: RoutePoint[], minGap: number): RoutePoint[] {
  if (points.length === 0) return [];

  const kept = [points[0]];
  for (const point of points) {
    if (point.distance - kept.at(-1)!.distance >= minGap) kept.push(point);
  }
  const last = points.at(-1)!;
  if (kept.at(-1) !== last) kept.push(last);

  return kept;
}

/** Shortest run treated as a real slope rather than a GPS wobble. */
const GRADIENT_WINDOW_M = 50;

/** Ascent, descent and steepest sustained gradient from an elevation series. */
export function elevationStats(points: RoutePoint[]) {
  const withElevation = points.filter((p) => p.elevation !== undefined);
  if (withElevation.length < 2) return undefined;

  let ascent = 0;
  let descent = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < withElevation.length; i++) {
    const elevation = withElevation[i].elevation!;
    min = Math.min(min, elevation);
    max = Math.max(max, elevation);

    if (i === 0) continue;
    const delta = elevation - withElevation[i - 1].elevation!;

    // Ignore sub-metre noise, which otherwise inflates ascent badly on GPS traces.
    if (Math.abs(delta) >= 1) {
      if (delta > 0) ascent += delta;
      else descent += -delta;
    }
  }

  return {
    min: Math.round(min),
    max: Math.round(max),
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    maxGradient: steepestGradient(withElevation),
  };
}

/**
 * Steepest sustained climb, as a percentage.
 *
 * Measured over a sliding window of at least GRADIENT_WINDOW_M rather than
 * between adjacent points: routers emit points every 10–25m, so a
 * point-to-point comparison never spans a long enough run to qualify and
 * would report zero on every route.
 */
function steepestGradient(points: RoutePoint[]): number {
  let steepest = 0;
  let tail = 0;

  for (let head = 1; head < points.length; head++) {
    // Advance the tail while the window is still longer than it needs to be,
    // keeping it the shortest window that satisfies the minimum run.
    while (
      tail < head - 1 &&
      points[head].distance - points[tail + 1].distance >= GRADIENT_WINDOW_M
    ) {
      tail++;
    }

    const run = points[head].distance - points[tail].distance;
    if (run < GRADIENT_WINDOW_M) continue;

    const rise = points[head].elevation! - points[tail].elevation!;
    steepest = Math.max(steepest, (rise / run) * 100);
  }

  return Number(steepest.toFixed(1));
}
