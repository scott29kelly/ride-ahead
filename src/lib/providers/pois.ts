import { decimate, projectOntoRoute } from '../geo';
import type { Poi, PoiCategory, RoutePoint } from '../types';
import { fetchJson, ProviderError } from './http';

/**
 * OSM tag filters, most specific first. The first rule that matches a node
 * decides its category, so ordering matters: a `tourism=viewpoint` inside a
 * park should read as a viewpoint, not a park.
 */
const RULES: { category: PoiCategory; key: string; values: string[] }[] = [
  { category: 'viewpoint', key: 'tourism', values: ['viewpoint'] },
  { category: 'nature', key: 'natural', values: ['peak', 'cave_entrance', 'arch', 'cliff', 'glacier'] },
  { category: 'water', key: 'natural', values: ['waterfall', 'spring', 'beach', 'hot_spring'] },
  { category: 'water', key: 'waterway', values: ['waterfall'] },
  { category: 'historic', key: 'historic', values: ['*'] },
  { category: 'art', key: 'tourism', values: ['artwork'] },
  { category: 'landmark', key: 'tourism', values: ['attraction', 'museum'] },
  { category: 'landmark', key: 'man_made', values: ['lighthouse', 'tower', 'windmill', 'bridge'] },
  { category: 'park', key: 'leisure', values: ['park', 'nature_reserve', 'garden'] },
  { category: 'park', key: 'boundary', values: ['national_park', 'protected_area'] },
  { category: 'refuel', key: 'amenity', values: ['cafe', 'restaurant', 'pub', 'ice_cream'] },
  { category: 'services', key: 'amenity', values: ['drinking_water', 'toilets', 'bicycle_repair_station'] },
  { category: 'services', key: 'tourism', values: ['picnic_site'] },
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Find interesting things within `radius` metres of the route.
 *
 * Queries a corridor around the route line rather than its bounding box —
 * on a route with any bend, a bbox pulls in a huge amount of scenery you
 * will never actually ride past.
 */
/**
 * Vertices allowed in the corridor spine. The coordinate list is repeated once
 * per clause, so this bounds the query body as well as Overpass's work.
 */
const MAX_SPINE_POINTS = 300;

/** Seconds given to Overpass server-side. The client waits longer than this. */
const OVERPASS_TIMEOUT_S = 50;

export function buildCorridorQuery(points: RoutePoint[], radius: number): string {
  const total = points.at(-1)?.distance ?? 0;

  // Space the spine so circles of `radius` still overlap, leaving no gaps
  // between them. On a route long enough that this would need more than
  // MAX_SPINE_POINTS vertices, widen the spacing to cover the whole route
  // rather than truncating it — a silently POI-less second half is worse
  // than a slightly coarser corridor.
  const idealGap = Math.max(120, radius * 0.9);
  const gap = Math.max(idealGap, total / MAX_SPINE_POINTS);
  const spine = decimate(points, gap);

  // 4dp is ~11m, well inside a corridor measured in hundreds of metres, and
  // meaningfully shorter than 5dp once repeated across every clause.
  const coordList = spine.map((p) => `${p.coord[1].toFixed(4)},${p.coord[0].toFixed(4)}`).join(',');
  const around = `(around:${radius},${coordList})`;

  // Rules sharing an OSM key collapse into one clause. Each clause repeats the
  // whole coordinate list, so going from one clause per rule to one per key is
  // the difference between a query Overpass runs and one it times out on.
  const byKey = new Map<string, string[]>();
  for (const { key, values } of RULES) {
    const existing = byKey.get(key) ?? [];
    byKey.set(key, existing.includes('*') ? existing : [...existing, ...values]);
  }

  const clauses = [...byKey].map(([key, values]) =>
    values.includes('*')
      ? `nwr${around}["${key}"];`
      : `nwr${around}["${key}"~"^(${values.join('|')})$"];`,
  );

  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];\n(\n  ${clauses.join('\n  ')}\n);\nout tags center qt;`;
}

export async function findPois(
  points: RoutePoint[],
  radius = 180,
): Promise<{ pois: Poi[]; provider: string }> {
  if (points.length === 0) return { pois: [], provider: 'none' };

  const body = await queryOverpass(buildCorridorQuery(points, radius));
  const projected = collect(body.elements ?? [], points, radius);

  return { pois: projected, provider: 'OpenStreetMap via Overpass' };
}

async function queryOverpass(query: string): Promise<{ elements?: OverpassElement[] }> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return await fetchJson<{ elements?: OverpassElement[] }>(endpoint, {
        provider: 'overpass',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
        // Comfortably longer than the server-side [timeout:] above, which is
        // wall-clock from when Overpass starts work — the client also has to
        // absorb time spent queued before that.
        timeoutMs: (OVERPASS_TIMEOUT_S + 30) * 1000,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderError('overpass', 'all endpoints failed');
}

function collect(elements: OverpassElement[], points: RoutePoint[], radius: number): Poi[] {
  const found: Poi[] = [];

  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    const tags = element.tags;
    if (lat === undefined || lon === undefined || !tags) continue;

    const category = categorise(tags);
    if (!category) continue;

    // Unnamed cafes and benches are noise; unnamed viewpoints and peaks are not.
    const name = tags.name ?? fallbackName(category, tags);
    if (!name) continue;

    const projection = projectOntoRoute(points, [lon, lat]);
    // Overpass rounds its corridor generously; enforce the radius ourselves.
    if (projection.offset > radius * 1.5) continue;

    found.push({
      id: `${element.type}/${element.id}`,
      name,
      category,
      coord: [lon, lat],
      offsetFromRoute: Math.round(projection.offset),
      distanceAlongRoute: Math.round(projection.distanceAlong),
      tags,
    });
  }

  return dedupe(found).sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute);
}

export function categorise(tags: Record<string, string>): PoiCategory | null {
  for (const rule of RULES) {
    const value = tags[rule.key];
    if (!value) continue;
    if (rule.values[0] === '*' || rule.values.includes(value)) return rule.category;
  }
  return null;
}

function fallbackName(category: PoiCategory, tags: Record<string, string>): string | null {
  switch (category) {
    case 'viewpoint':
      return 'Viewpoint';
    case 'water':
      return tags.waterway === 'waterfall' || tags.natural === 'waterfall' ? 'Waterfall' : null;
    case 'services':
      if (tags.amenity === 'drinking_water') return 'Water fountain';
      if (tags.amenity === 'bicycle_repair_station') return 'Bike repair stand';
      return null;
    default:
      return null;
  }
}

/**
 * OSM frequently holds the same feature as both a node and an enclosing way.
 * Treat same-name entries within 120m of each other as one place.
 */
function dedupe(pois: Poi[]): Poi[] {
  const kept: Poi[] = [];

  for (const poi of pois) {
    const duplicate = kept.find(
      (other) =>
        other.name === poi.name && Math.abs(other.distanceAlongRoute - poi.distanceAlongRoute) < 120,
    );
    if (duplicate) {
      // Prefer whichever sits closest to the route.
      if (poi.offsetFromRoute < duplicate.offsetFromRoute) {
        kept[kept.indexOf(duplicate)] = poi;
      }
      continue;
    }
    kept.push(poi);
  }

  return kept;
}
