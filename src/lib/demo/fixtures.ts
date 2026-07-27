import type { LngLat, Poi, PoiCategory } from '../types';

/**
 * Offline demo data: three real rides out of central Boulder, Colorado.
 *
 * Geometry here is a hand-built approximation, not a router's output — it
 * exists so the app is fully explorable without any API keys. Anything that
 * comes from this file is flagged as demo data in the UI.
 */

export interface DemoRoute {
  key: string;
  destination: { name: string; label: string; coord: LngLat };
  /** Sparse waypoints; densified into a route line at request time. */
  waypoints: LngLat[];
  /** Elevation in metres at each waypoint, interpolated between them. */
  elevations: number[];
  pois: DemoPoi[];
}

interface DemoPoi {
  name: string;
  category: PoiCategory;
  coord: LngLat;
  tags?: Record<string, string>;
}

export const DEMO_START = {
  name: 'Boulder Public Library',
  label: 'Boulder Public Library, 1001 Arapahoe Ave, Boulder, CO',
  coord: [-105.2797, 40.0150] as LngLat,
};

export const DEMO_ROUTES: DemoRoute[] = [
  {
    key: 'chautauqua',
    destination: {
      name: 'Chautauqua Park',
      label: 'Chautauqua Park, Baseline Rd, Boulder, CO',
      coord: [-105.2811, 39.9994],
    },
    waypoints: [
      [-105.2797, 40.015],
      [-105.2825, 40.0146],
      [-105.2848, 40.0138],
      [-105.2851, 40.0112],
      [-105.2854, 40.0078],
      [-105.2857, 40.0042],
      [-105.2853, 40.0012],
      [-105.2836, 39.9997],
      [-105.2811, 39.9994],
    ],
    elevations: [1633, 1636, 1641, 1648, 1657, 1668, 1682, 1694, 1712],
    pois: [
      { name: 'Boulder Creek Path', category: 'water', coord: [-105.2828, 40.0147] },
      { name: 'Eben G. Fine Park', category: 'park', coord: [-105.2864, 40.0143] },
      {
        name: 'Chautauqua Auditorium',
        category: 'historic',
        coord: [-105.2818, 39.9997],
        tags: { historic: 'building', wikipedia: 'en:Colorado Chautauqua' },
      },
      {
        name: 'Flatirons Vista',
        category: 'viewpoint',
        coord: [-105.2822, 39.9989],
        tags: { tourism: 'viewpoint' },
      },
      { name: 'Chautauqua Dining Hall', category: 'refuel', coord: [-105.2815, 39.9996] },
      { name: 'Gregory Canyon Trailhead', category: 'nature', coord: [-105.2848, 39.999] },
      { name: 'Baseline Water Fountain', category: 'services', coord: [-105.284, 39.9998] },
    ],
  },
  {
    key: 'creek-path',
    destination: {
      name: 'Boulder Canyon Trailhead',
      label: 'Boulder Canyon Trailhead, Canyon Blvd, Boulder, CO',
      coord: [-105.2985, 40.0147],
    },
    waypoints: [
      [-105.2797, 40.015],
      [-105.2822, 40.0148],
      [-105.2851, 40.0145],
      [-105.288, 40.0144],
      [-105.2912, 40.0146],
      [-105.2947, 40.0148],
      [-105.2985, 40.0147],
    ],
    elevations: [1633, 1635, 1638, 1641, 1645, 1650, 1656],
    pois: [
      { name: 'Boulder Creek', category: 'water', coord: [-105.2835, 40.0146] },
      { name: 'Central Park Bandshell', category: 'historic', coord: [-105.2806, 40.0152] },
      { name: 'Boulder Creek Kayak Park', category: 'water', coord: [-105.2872, 40.0145] },
      { name: 'Eben G. Fine Park', category: 'park', coord: [-105.2946, 40.0148] },
      { name: 'Elephant Buttresses', category: 'viewpoint', coord: [-105.2979, 40.0143] },
      { name: 'Creekside Cafe', category: 'refuel', coord: [-105.2812, 40.0149] },
      { name: 'Settlers Park', category: 'park', coord: [-105.2962, 40.0151] },
      { name: 'Boulder Falls Overlook', category: 'water', coord: [-105.2991, 40.0145] },
    ],
  },
  {
    key: 'ncar',
    destination: {
      name: 'NCAR Mesa Lab',
      label: 'NCAR Mesa Laboratory, 1850 Table Mesa Dr, Boulder, CO',
      coord: [-105.2733, 39.9783],
    },
    waypoints: [
      [-105.2797, 40.015],
      [-105.2789, 40.0102],
      [-105.2782, 40.0048],
      [-105.2776, 39.9992],
      [-105.277, 39.9932],
      [-105.2758, 39.9875],
      [-105.2744, 39.9825],
      [-105.2733, 39.9783],
    ],
    elevations: [1633, 1644, 1659, 1678, 1712, 1758, 1812, 1855],
    pois: [
      { name: 'Table Mesa Overlook', category: 'viewpoint', coord: [-105.2762, 39.9861] },
      {
        name: 'NCAR Mesa Laboratory',
        category: 'landmark',
        coord: [-105.2735, 39.9784],
        tags: { tourism: 'attraction', wikipedia: 'en:Mesa Laboratory' },
      },
      { name: 'Bear Canyon Creek', category: 'water', coord: [-105.2771, 39.9925] },
      { name: 'NCAR Trailhead', category: 'nature', coord: [-105.2742, 39.9789] },
      { name: 'Mesa Trail Junction', category: 'nature', coord: [-105.2755, 39.9841] },
      { name: 'Martin Park', category: 'park', coord: [-105.2784, 40.0035] },
      { name: 'Table Mesa Shopping Centre', category: 'refuel', coord: [-105.2751, 39.9868] },
    ],
  },
];

/** Match a typed destination to a demo route, so the demo responds to input. */
export function matchDemoRoute(query: string): DemoRoute {
  const needle = query.trim().toLowerCase();

  const hit = DEMO_ROUTES.find(
    (candidate) =>
      candidate.key.includes(needle) ||
      candidate.destination.name.toLowerCase().includes(needle) ||
      needle.includes(candidate.key.split('-')[0]),
  );

  if (hit) return hit;

  // Deterministic fallback so an unknown destination still returns something
  // stable rather than a different route on every keystroke.
  let sum = 0;
  for (let i = 0; i < needle.length; i++) sum += needle.charCodeAt(i);
  return DEMO_ROUTES[sum % DEMO_ROUTES.length];
}

export function demoPoisToPois(route: DemoRoute): Omit<Poi, 'offsetFromRoute' | 'distanceAlongRoute'>[] {
  return route.pois.map((poi, index) => ({
    id: `demo/${route.key}/${index}`,
    name: poi.name,
    category: poi.category,
    coord: poi.coord,
    tags: poi.tags ?? {},
  }));
}
