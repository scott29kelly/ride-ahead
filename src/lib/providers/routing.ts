import { buildRoutePoints } from '../geo';
import type { BikeProfile, LngLat, RouteGeometry } from '../types';
import { fetchJson, ProviderError } from './http';

export interface RoutingResult extends RouteGeometry {
  /** Which backend answered, surfaced in the UI so quality is never implied. */
  provider: string;
  warnings: string[];
}

/**
 * Route between waypoints on a bike.
 *
 * OpenRouteService is the real path: it has genuine cycling profiles and
 * returns elevation. Without a key we fall back to the public OSRM demo
 * server, which only exposes a car profile — usable for a rough shape, but
 * it will happily route down roads no one wants to cycle, so we say so.
 */
export async function route(waypoints: LngLat[], profile: BikeProfile): Promise<RoutingResult> {
  if (waypoints.length < 2) {
    throw new ProviderError('routing', 'need at least a start and a destination');
  }

  const key = process.env.ORS_API_KEY;
  if (key) return routeWithOrs(waypoints, profile, key);
  return routeWithOsrm(waypoints);
}

interface OrsResponse {
  features: {
    geometry: { coordinates: [number, number, number?][] };
    properties: {
      summary?: { distance?: number; duration?: number };
      ascent?: number;
      descent?: number;
    };
  }[];
}

async function routeWithOrs(
  waypoints: LngLat[],
  profile: BikeProfile,
  key: string,
): Promise<RoutingResult> {
  const body = await fetchJson<OrsResponse>(
    `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
    {
      provider: 'openrouteservice',
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: waypoints,
        elevation: true,
        instructions: false,
      }),
      timeoutMs: 25_000,
    },
  );

  const feature = body.features?.[0];
  if (!feature) throw new ProviderError('openrouteservice', 'no route found between those points');

  const coords: LngLat[] = feature.geometry.coordinates.map(([lng, lat]) => [lng, lat]);
  const elevations = feature.geometry.coordinates.map(([, , elevation]) => elevation ?? NaN);
  const hasElevation = elevations.some((value) => Number.isFinite(value));

  const points = buildRoutePoints(coords, hasElevation ? elevations : undefined);

  return {
    points,
    distance: feature.properties.summary?.distance ?? points.at(-1)?.distance ?? 0,
    duration: feature.properties.summary?.duration ?? 0,
    ascent: feature.properties.ascent,
    descent: feature.properties.descent,
    provider: `OpenRouteService (${profile})`,
    warnings: [],
  };
}

interface OsrmResponse {
  code: string;
  routes: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }[];
}

async function routeWithOsrm(waypoints: LngLat[]): Promise<RoutingResult> {
  const path = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const body = await fetchJson<OsrmResponse>(
    `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`,
    { provider: 'osrm', timeoutMs: 20_000 },
  );

  const found = body.routes?.[0];
  if (!found) throw new ProviderError('osrm', `no route found (${body.code})`);

  const points = buildRoutePoints(found.geometry.coordinates);

  return {
    points,
    distance: found.distance,
    // Car durations are meaningless on a bike; re-estimate at a steady 16 km/h.
    duration: (found.distance / 1000 / 16) * 3600,
    provider: 'OSRM demo (road profile)',
    warnings: [
      'Routed with a car profile — no ORS_API_KEY set. The shape is right but it may use roads you would not choose on a bike, and there is no elevation data.',
    ],
  };
}
