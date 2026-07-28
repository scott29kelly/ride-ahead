import type { LngLat, Place } from '../types';
import { fetchJson, ProviderError } from './http';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
}

/**
 * Nominatim's usage policy is an absolute maximum of one request per second,
 * and they block addresses that ignore it. Every lookup goes through one queue
 * so that holds however many callers there are.
 */
const DEFAULT_MIN_INTERVAL_MS = 1_100;

/** Self-hosted Nominatim instances have no such limit; let them say so. */
function minIntervalMs(): number {
  const configured = Number(process.env.NOMINATIM_MIN_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_MIN_INTERVAL_MS;
}

let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  // Space the *next* call regardless of whether this one succeeded — a failure
  // still cost a request as far as Nominatim is concerned.
  const spacer = () => new Promise((resolve) => setTimeout(resolve, minIntervalMs()));
  queue = result.then(spacer, spacer);
  return result;
}

/**
 * Free-text place lookup via Nominatim (OpenStreetMap).
 *
 * Requests are serialised and paced internally, so callers can geocode in a
 * plain loop without having to know about the rate limit.
 */
export async function geocode(query: string, near?: LngLat): Promise<Place> {
  const trimmed = query.trim();
  if (!trimmed) throw new ProviderError('nominatim', 'empty search query');

  // A coordinate pair typed directly should skip the geocoder entirely.
  const literal = parseCoordinate(trimmed);
  if (literal) {
    return { name: trimmed, label: `${literal[1].toFixed(5)}, ${literal[0].toFixed(5)}`, coord: literal };
  }

  const first = await search(trimmed, near);
  if (first) return toPlace(first, trimmed);

  // Nominatim's house numbers come from OSM, which covers individual US
  // addresses unevenly — "300 Veterans Way" may not exist even where the
  // street does. Retrying without the number lands you on the right road
  // instead of failing outright, which for a route preview is close enough.
  const withoutHouseNumber = trimmed.replace(/^\s*\d+[a-z]?\s+/i, '');
  if (withoutHouseNumber !== trimmed && withoutHouseNumber.length > 2) {
    const second = await search(withoutHouseNumber, near);
    if (second) return toPlace(second, withoutHouseNumber);
  }

  throw new ProviderError(
    'nominatim',
    `no match for "${trimmed}". OpenStreetMap's address coverage is patchy for ` +
      `individual house numbers — try a nearby landmark, a street and town, or paste "lat, lng" coordinates.`,
  );
}

async function search(query: string, near?: LngLat): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '0',
  });

  // Bias results toward the start point so "the park" resolves locally.
  if (near) {
    const [lng, lat] = near;
    const pad = 0.5;
    params.set('viewbox', `${lng - pad},${lat + pad},${lng + pad},${lat - pad}`);
  }

  const results = await throttled(() =>
    fetchJson<NominatimResult[]>(`https://nominatim.openstreetmap.org/search?${params}`, {
      provider: 'nominatim',
    }),
  );

  return results[0] ?? null;
}

function toPlace(hit: NominatimResult, fallbackName: string): Place {
  return {
    name: hit.name || fallbackName,
    label: hit.display_name,
    coord: [Number(hit.lon), Number(hit.lat)],
  };
}

/** Accepts "40.015, -105.279" in lat,lng order — how people paste coordinates. */
export function parseCoordinate(input: string): LngLat | null {
  const match = input.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return [lng, lat];
}
