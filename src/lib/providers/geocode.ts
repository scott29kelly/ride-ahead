import type { LngLat, Place } from '../types';
import { fetchJson, ProviderError } from './http';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
}

/**
 * Free-text place lookup via Nominatim (OpenStreetMap).
 *
 * Nominatim's usage policy caps this at 1 request/second, so callers should
 * geocode sequentially rather than fanning out.
 */
export async function geocode(query: string, near?: LngLat): Promise<Place> {
  const trimmed = query.trim();
  if (!trimmed) throw new ProviderError('nominatim', 'empty search query');

  // A coordinate pair typed directly should skip the geocoder entirely.
  const literal = parseCoordinate(trimmed);
  if (literal) {
    return { name: trimmed, label: `${literal[1].toFixed(5)}, ${literal[0].toFixed(5)}`, coord: literal };
  }

  const params = new URLSearchParams({
    q: trimmed,
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

  const results = await fetchJson<NominatimResult[]>(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { provider: 'nominatim' },
  );

  const hit = results[0];
  if (!hit) throw new ProviderError('nominatim', `no match for "${trimmed}"`);

  return {
    name: hit.name || trimmed,
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
