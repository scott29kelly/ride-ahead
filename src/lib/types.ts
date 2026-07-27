/** Core domain types for RideAhead. */

/** [longitude, latitude] — GeoJSON order. Kept consistent everywhere. */
export type LngLat = [number, number];

export interface Place {
  name: string;
  /** Full display string from the geocoder, e.g. "Chautauqua Park, Boulder, CO". */
  label: string;
  coord: LngLat;
}

export type BikeProfile = 'cycling-regular' | 'cycling-road' | 'cycling-mountain';

export interface RouteRequest {
  start: string;
  /** One to three destinations. Each becomes its own candidate route to compare. */
  destinations: string[];
  profile: BikeProfile;
  /** Round trip returns to the start; changes distance and the sampling budget. */
  roundTrip: boolean;
}

/** A point on the route with everything we know about that spot. */
export interface RoutePoint {
  coord: LngLat;
  /** Metres travelled from the start of the route. */
  distance: number;
  /** Metres above sea level, when the router supplies elevation. */
  elevation?: number;
  /** Compass bearing of travel at this point, degrees clockwise from north. */
  bearing: number;
}

export interface RouteGeometry {
  points: RoutePoint[];
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
}

export type PoiCategory =
  | 'viewpoint'
  | 'nature'
  | 'water'
  | 'historic'
  | 'park'
  | 'art'
  | 'landmark'
  | 'refuel'
  | 'services';

export interface Poi {
  id: string;
  name: string;
  category: PoiCategory;
  coord: LngLat;
  /** Metres from the route line at its closest approach. */
  offsetFromRoute: number;
  /** Metres along the route where you'd be closest to it. */
  distanceAlongRoute: number;
  tags: Record<string, string>;
}

export type ImagerySource = 'mapillary' | 'wikimedia' | 'street-view' | 'demo';

export interface Image {
  url: string;
  /** Full-resolution or link-out URL when the provider offers one. */
  fullUrl?: string;
  source: ImagerySource;
  attribution: string;
  /** Where the photo was taken. */
  coord?: LngLat;
  /** Direction the camera faced, degrees clockwise from north. */
  heading?: number;
  capturedAt?: string;
  /** Link back to the provider's page, required by several licences. */
  sourceUrl?: string;
}

/** One frame of the flythrough: a spot on the route plus the best photo of it. */
export interface PreviewFrame {
  distance: number;
  coord: LngLat;
  bearing: number;
  elevation?: number;
  image?: Image;
  /** POIs close enough to this frame to caption it. */
  nearbyPois: Poi[];
}

export interface Highlight {
  poi: Poi;
  score: number;
  /** Human-readable reason this made the cut, shown in the UI. */
  reason: string;
  image?: Image;
}

export interface ElevationStats {
  min: number;
  max: number;
  ascent: number;
  descent: number;
  /** Steepest sustained gradient as a percentage. */
  maxGradient: number;
}

export interface RoutePreview {
  id: string;
  start: Place;
  destination: Place;
  profile: BikeProfile;
  distance: number;
  duration: number;
  geometry: LngLat[];
  elevation?: ElevationStats;
  /** Elevation samples for the profile chart: [distance metres, elevation metres]. */
  elevationSeries?: [number, number][];
  frames: PreviewFrame[];
  highlights: Highlight[];
  /** Short descriptors like "Waterside" or "Big climb", derived from the POI mix. */
  vibes: string[];
  summary: string;
  /** Which providers actually answered, so the UI can be honest about coverage. */
  sources: {
    routing: string;
    pois: string;
    imagery: ImagerySource[];
  };
  warnings: string[];
}

export interface PreviewResponse {
  routes: RoutePreview[];
  demoMode: boolean;
  warnings: string[];
}
