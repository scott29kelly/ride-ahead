import { bearingDelta, boundingBox, haversine } from '../geo';
import type { Image, LngLat } from '../types';
import { fetchJson } from './http';

/**
 * Photo lookup for a spot on the route.
 *
 * The important part is `heading`: a preview should show what you'd see
 * looking *forward*, so candidates are scored on how well the camera
 * direction matches the direction of travel, not just on proximity.
 */

export interface ImageryQuery {
  coord: LngLat;
  /** Direction of travel; imagery facing this way is strongly preferred. */
  bearing: number;
  /** How far from the point to accept a photo, in metres. */
  radius?: number;
}

export function hasMapillary(): boolean {
  return Boolean(process.env.MAPILLARY_TOKEN);
}

export function hasStreetView(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

interface MapillaryImage {
  id: string;
  thumb_1024_url?: string;
  thumb_2048_url?: string;
  computed_geometry?: { coordinates: [number, number] };
  geometry?: { coordinates: [number, number] };
  captured_at?: number;
  compass_angle?: number;
}

/**
 * Street-level imagery from Mapillary. Better than Street View for cycling:
 * it covers bike paths, canal towpaths and trails that a survey car never drove.
 */
export async function findMapillaryImage(query: ImageryQuery): Promise<Image | null> {
  const token = process.env.MAPILLARY_TOKEN;
  if (!token) return null;

  const radius = query.radius ?? 60;
  const [west, south, east, north] = boundingBox([query.coord], radius);

  const params = new URLSearchParams({
    access_token: token,
    bbox: `${west},${south},${east},${north}`,
    fields: 'id,thumb_1024_url,computed_geometry,geometry,captured_at,compass_angle',
    limit: '25',
  });

  const body = await fetchJson<{ data?: MapillaryImage[] }>(
    `https://graph.mapillary.com/images?${params}`,
    { provider: 'mapillary', timeoutMs: 12_000 },
  );

  const candidates = body.data ?? [];
  if (candidates.length === 0) return null;

  const best = pickBestFacing(candidates, query);
  if (!best?.thumb_1024_url) return null;

  const coords = best.computed_geometry?.coordinates ?? best.geometry?.coordinates;

  return {
    url: best.thumb_1024_url,
    source: 'mapillary',
    attribution: 'Mapillary (CC BY-SA)',
    coord: coords ? [coords[0], coords[1]] : undefined,
    heading: best.compass_angle,
    capturedAt: best.captured_at ? new Date(best.captured_at).toISOString() : undefined,
    sourceUrl: `https://www.mapillary.com/app/?pKey=${best.id}&focus=photo`,
  };
}

/**
 * Rank candidates on facing first, distance second. A photo taken 40m away
 * pointing down the road you're riding is a far better preview than one taken
 * at your exact position pointing at a hedge.
 */
function pickBestFacing(candidates: MapillaryImage[], query: ImageryQuery): MapillaryImage | null {
  let best: MapillaryImage | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (!candidate.thumb_1024_url) continue;

    const coords = candidate.computed_geometry?.coordinates ?? candidate.geometry?.coordinates;
    const distance = coords ? haversine(query.coord, [coords[0], coords[1]]) : 100;

    // 0 when facing straight ahead, 1 when facing backwards.
    const facing =
      candidate.compass_angle === undefined
        ? 0.5
        : bearingDelta(candidate.compass_angle, query.bearing) / 180;

    const score = -facing * 100 - distance * 0.5 + recencyBonus(candidate.captured_at);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/** Mild preference for newer imagery — up to +20 for something from this year. */
function recencyBonus(capturedAt?: number): number {
  if (!capturedAt) return 0;
  const years = (Date.now() - capturedAt) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, 20 - years * 2.5);
}

interface CommonsResponse {
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        imageinfo?: {
          thumburl?: string;
          url?: string;
          descriptionurl?: string;
          extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
        }[];
      }
    >;
  };
}

/**
 * Wikimedia Commons geosearch. Weaker for "what the road looks like", strong
 * for named landmarks — so this is what captions a highlight rather than a frame.
 */
export async function findCommonsImage(coord: LngLat, radius = 300): Promise<Image | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'geosearch',
    ggscoord: `${coord[1]}|${coord[0]}`,
    ggsradius: String(Math.min(10_000, Math.max(10, radius))),
    ggslimit: '8',
    ggsnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1024',
  });

  const body = await fetchJson<CommonsResponse>(`https://commons.wikimedia.org/w/api.php?${params}`, {
    provider: 'wikimedia',
    timeoutMs: 12_000,
  });

  const pages = Object.values(body.query?.pages ?? {});
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const url = info?.thumburl ?? info?.url;
    if (!url || !/\.(jpe?g|png|webp)$/i.test(url.split('?')[0])) continue;

    const artist = stripHtml(info?.extmetadata?.Artist?.value ?? '');
    const licence = info?.extmetadata?.LicenseShortName?.value ?? 'see source';

    return {
      url,
      fullUrl: info?.url,
      source: 'wikimedia',
      attribution: `${artist || 'Wikimedia Commons'} (${licence})`,
      coord,
      sourceUrl: info?.descriptionurl,
    };
  }

  return null;
}

/**
 * Google Street View. Highest quality where it exists, but it is metered, so
 * the free metadata endpoint gates every billable image request.
 */
export async function findStreetViewImage(query: ImageryQuery): Promise<Image | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const [lng, lat] = query.coord;
  const radius = query.radius ?? 60;

  const metadata = await fetchJson<{ status: string; date?: string; location?: { lat: number; lng: number } }>(
    `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=${radius}&source=outdoor&key=${key}`,
    { provider: 'street-view', timeoutMs: 10_000 },
  );

  if (metadata.status !== 'OK') return null;

  const params = new URLSearchParams({
    size: '1024x576',
    location: `${lat},${lng}`,
    heading: String(Math.round(query.bearing)),
    pitch: '0',
    fov: '90',
    radius: String(radius),
    source: 'outdoor',
    key,
  });

  return {
    url: `https://maps.googleapis.com/maps/api/streetview?${params}`,
    source: 'street-view',
    attribution: 'Google Street View',
    coord: metadata.location ? [metadata.location.lng, metadata.location.lat] : query.coord,
    heading: query.bearing,
    capturedAt: metadata.date,
  };
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
