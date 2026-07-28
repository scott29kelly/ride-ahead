import {
  buildRoutePoints,
  elevationStats,
  haversine,
  interpolate,
  projectOntoRoute,
  sampleAlongRoute,
} from './geo';
import { DEMO_START, matchDemoRoute, type DemoRoute } from './demo/fixtures';
import { placeholderImage } from './demo/placeholder';
import { geocode } from './providers/geocode';
import { dedupeWarnings, mapWithConcurrency, optional } from './providers/http';
import {
  findCommonsImage,
  findMapillaryImage,
  findStreetViewImage,
  hasMapillary,
  hasStreetView,
} from './providers/imagery';
import { findPois } from './providers/pois';
import { route as routeProvider } from './providers/routing';
import { buildHighlights, deriveVibes, summarise } from './score';
import type {
  Image,
  ImagerySource,
  LngLat,
  Place,
  Poi,
  PreviewFrame,
  PreviewResponse,
  RoutePoint,
  RoutePreview,
  RouteRequest,
} from './types';

/** Frames in a preview. Enough to feel like a flythrough, few enough to stay inside rate limits. */
const TARGET_FRAMES = 24;

/** A frame captions itself with POIs within this distance. */
const FRAME_POI_RADIUS = 250;

/**
 * Demo mode is an explicit switch rather than "no keys configured", so that a
 * misconfigured deploy fails loudly instead of quietly serving Boulder to
 * someone who asked about Bristol.
 */
export function isDemoMode(): boolean {
  return process.env.RIDEAHEAD_DEMO === '1';
}

export async function buildPreviews(request: RouteRequest): Promise<PreviewResponse> {
  const demo = isDemoMode();
  const warnings: string[] = [];

  const destinations = request.destinations.map((value) => value.trim()).filter(Boolean).slice(0, 3);
  if (destinations.length === 0) throw new Error('Add at least one destination.');

  if (demo) {
    return {
      routes: destinations.map((destination, index) =>
        buildDemoPreview(destination, index, request),
      ),
      demoMode: true,
      warnings: ['Demo mode: routes, places and imagery are bundled sample data, not live results.'],
    };
  }

  // Nominatim asks for no more than one request per second, so geocode in series.
  const start = await geocode(request.start);
  const places: Place[] = [];
  for (const destination of destinations) {
    places.push(await geocode(destination, start.coord));
  }

  // Routes are independent, so build them concurrently. A failure on one
  // destination shouldn't lose the other two.
  const settled = await Promise.allSettled(
    places.map((place, index) => buildLivePreview(start, place, index, request)),
  );

  const routes: RoutePreview[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') routes.push(result.value);
    else warnings.push(`${places[index].name}: ${result.reason?.message ?? result.reason}`);
  });

  if (routes.length === 0) {
    throw new Error(warnings.join('; ') || 'Could not build any route.');
  }

  return { routes, demoMode: false, warnings };
}

async function buildLivePreview(
  start: Place,
  destination: Place,
  index: number,
  request: RouteRequest,
): Promise<RoutePreview> {
  const warnings: string[] = [];

  const waypoints: LngLat[] = request.roundTrip
    ? [start.coord, destination.coord, start.coord]
    : [start.coord, destination.coord];

  const routed = await routeProvider(waypoints, request.profile);
  warnings.push(...routed.warnings);

  const poiResult = await optional(
    () => findPois(routed.points),
    { pois: [] as Poi[], provider: 'unavailable' },
    warnings,
  );

  const frames = await buildFrames(routed.points, poiResult.pois, warnings);
  const highlightImages = await fetchHighlightImages(poiResult.pois, warnings);
  const highlights = buildHighlights(poiResult.pois, highlightImages);

  const elevation = elevationStats(routed.points);
  const usedSources = new Set<ImagerySource>();
  frames.forEach((frame) => frame.image && usedSources.add(frame.image.source));
  highlightImages.forEach((image) => image && usedSources.add(image.source));

  if (usedSources.size === 0) {
    warnings.push(
      'No imagery found for this route. Set MAPILLARY_TOKEN for street-level photos, or GOOGLE_MAPS_API_KEY for Street View.',
    );
  }

  return {
    id: `route-${index}`,
    start,
    destination,
    profile: request.profile,
    distance: routed.distance,
    duration: routed.duration,
    geometry: routed.points.map((point) => point.coord),
    elevation,
    elevationSeries: buildElevationSeries(routed.points),
    frames,
    highlights,
    vibes: deriveVibes(poiResult.pois, routed.distance, elevation),
    summary: summarise(destination.name, routed.distance, highlights, elevation),
    sources: {
      routing: routed.provider,
      pois: poiResult.provider,
      imagery: [...usedSources],
    },
    warnings: dedupeWarnings(warnings),
  };
}

/** One image per sampled point, chosen to face the direction of travel. */
async function buildFrames(
  points: RoutePoint[],
  pois: Poi[],
  warnings: string[],
): Promise<PreviewFrame[]> {
  const samples = sampleAlongRoute(points, TARGET_FRAMES);
  const canFetch = hasMapillary() || hasStreetView();

  const images = canFetch
    ? await mapWithConcurrency(samples, 4, (sample) =>
        optional(
          async () =>
            (await findMapillaryImage({ coord: sample.coord, bearing: sample.bearing })) ??
            (await findStreetViewImage({ coord: sample.coord, bearing: sample.bearing })),
          null,
          warnings,
        ),
      )
    : samples.map(() => null);

  return samples.map((sample, index) => ({
    distance: Math.round(sample.distance),
    coord: sample.coord,
    bearing: Math.round(sample.bearing),
    elevation: sample.elevation === undefined ? undefined : Math.round(sample.elevation),
    image: images[index] ?? undefined,
    nearbyPois: pois.filter(
      (poi) => Math.abs(poi.distanceAlongRoute - sample.distance) < FRAME_POI_RADIUS,
    ),
  }));
}

/**
 * Photos for the candidates most likely to become highlights. Only the top
 * slice by category weight is worth spending requests on, since the rest
 * won't make the cut regardless of whether an image exists.
 */
async function fetchHighlightImages(pois: Poi[], warnings: string[]): Promise<Map<string, Image>> {
  const images = new Map<string, Image>();
  const worthChecking = pois
    .filter((poi) => poi.category !== 'services')
    .sort((a, b) => a.offsetFromRoute - b.offsetFromRoute)
    .slice(0, 16);

  const results = await mapWithConcurrency(worthChecking, 3, (poi) =>
    optional(
      async () =>
        (await findCommonsImage(poi.coord, 250)) ??
        (await findMapillaryImage({ coord: poi.coord, bearing: 0, radius: 80 })),
      null,
      warnings,
    ),
  );

  worthChecking.forEach((poi, index) => {
    const image = results[index];
    if (image) images.set(poi.id, image);
  });

  return images;
}

function buildElevationSeries(points: RoutePoint[]): [number, number][] | undefined {
  const sampled = sampleAlongRoute(points, 120).filter((point) => point.elevation !== undefined);
  if (sampled.length < 2) return undefined;
  return sampled.map((point) => [Math.round(point.distance), Math.round(point.elevation!)]);
}

/* -------------------------------------------------------------------------- */
/*                                 Demo mode                                  */
/* -------------------------------------------------------------------------- */

function buildDemoPreview(query: string, index: number, request: RouteRequest): RoutePreview {
  const demoRoute = matchDemoRoute(query);
  const points = densify(demoRoute);

  const pois: Poi[] = demoRoute.pois.map((poi, poiIndex) => {
    const projection = projectOntoRoute(points, poi.coord);
    return {
      id: `demo/${demoRoute.key}/${poiIndex}`,
      name: poi.name,
      category: poi.category,
      coord: poi.coord,
      offsetFromRoute: Math.round(projection.offset),
      distanceAlongRoute: Math.round(projection.distanceAlong),
      tags: poi.tags ?? {},
    };
  });

  const highlightImages = new Map<string, Image>(
    pois.map((poi) => [poi.id, placeholderImage(poi.id, poi.name, poi.category)]),
  );

  const samples = sampleAlongRoute(points, TARGET_FRAMES);
  const frames: PreviewFrame[] = samples.map((sample) => {
    const nearbyPois = pois.filter(
      (poi) => Math.abs(poi.distanceAlongRoute - sample.distance) < FRAME_POI_RADIUS,
    );
    const label = nearbyPois[0]?.name ?? `${(sample.distance / 1000).toFixed(1)} km in`;

    return {
      distance: Math.round(sample.distance),
      coord: sample.coord,
      bearing: Math.round(sample.bearing),
      elevation: sample.elevation === undefined ? undefined : Math.round(sample.elevation),
      image: placeholderImage(
        `${demoRoute.key}-${Math.round(sample.distance)}`,
        label,
        nearbyPois[0]?.category ?? 'route',
      ),
      nearbyPois,
    };
  });

  const distance = points.at(-1)!.distance;
  const elevation = elevationStats(points);
  const highlights = buildHighlights(pois, highlightImages);

  return {
    id: `route-${index}`,
    start: DEMO_START,
    destination: demoRoute.destination,
    profile: request.profile,
    distance,
    duration: (distance / 1000 / 15) * 3600,
    geometry: points.map((point) => point.coord),
    elevation,
    elevationSeries: buildElevationSeries(points),
    frames,
    highlights,
    vibes: deriveVibes(pois, distance, elevation),
    summary: summarise(demoRoute.destination.name, distance, highlights, elevation),
    sources: { routing: 'Bundled demo data', pois: 'Bundled demo data', imagery: ['demo'] },
    warnings: [],
  };
}

/** Expand sparse demo waypoints into a route line with a point roughly every 25m. */
function densify(demoRoute: DemoRoute): RoutePoint[] {
  const coords: LngLat[] = [];
  const elevations: number[] = [];

  for (let i = 0; i < demoRoute.waypoints.length - 1; i++) {
    const from = demoRoute.waypoints[i];
    const to = demoRoute.waypoints[i + 1];
    const steps = Math.max(2, Math.round(haversine(from, to) / 25));

    for (let step = 0; step < steps; step++) {
      const fraction = step / steps;
      coords.push(interpolate(from, to, fraction));
      elevations.push(
        demoRoute.elevations[i] +
          (demoRoute.elevations[i + 1] - demoRoute.elevations[i]) * fraction,
      );
    }
  }

  coords.push(demoRoute.waypoints.at(-1)!);
  elevations.push(demoRoute.elevations.at(-1)!);

  return buildRoutePoints(coords, elevations);
}
