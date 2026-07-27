import type { ElevationStats, Highlight, Poi, PoiCategory } from './types';

/**
 * How much each kind of place earns its way into a preview.
 *
 * These weights answer "what would make me pick this route over another one",
 * which is not the same as "what is important". A drinking fountain is genuinely
 * useful mid-ride but nobody chooses a route for it, so it scores low and shows
 * up in the detail list rather than the highlights.
 */
const CATEGORY_WEIGHT: Record<PoiCategory, number> = {
  viewpoint: 100,
  nature: 85,
  water: 80,
  historic: 65,
  landmark: 60,
  park: 45,
  art: 40,
  refuel: 25,
  services: 10,
};

const CATEGORY_REASON: Record<PoiCategory, string> = {
  viewpoint: 'Marked viewpoint',
  nature: 'Natural feature',
  water: 'Water feature',
  historic: 'Historic site',
  landmark: 'Landmark',
  park: 'Green space',
  art: 'Public art',
  refuel: 'Food and drink stop',
  services: 'Useful stop',
};

/** Beyond this, a POI is a detour rather than something you ride past. */
const MAX_USEFUL_OFFSET = 400;

export function scorePoi(poi: Poi, hasImage: boolean): number {
  const base = CATEGORY_WEIGHT[poi.category];

  // Linear falloff to zero at the max offset — something 30m away is on your
  // route, something 350m away needs a deliberate detour.
  const proximity = Math.max(0, 1 - poi.offsetFromRoute / MAX_USEFUL_OFFSET);

  // A highlight you can actually see a photo of is worth more in a preview.
  const imageBonus = hasImage ? 1.25 : 1;

  // Tagged with a Wikipedia article or designation? Someone thought it mattered.
  const notability =
    poi.tags.wikipedia || poi.tags.wikidata || poi.tags.heritage || poi.tags.tourism === 'attraction'
      ? 1.2
      : 1;

  return base * proximity * imageBonus * notability;
}

export function buildHighlights(
  pois: Poi[],
  images: Map<string, Highlight['image']>,
  limit = 8,
): Highlight[] {
  const scored = pois
    .map((poi) => {
      const image = images.get(poi.id);
      return {
        poi,
        image,
        score: scorePoi(poi, Boolean(image)),
        reason: describe(poi),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return spreadAlongRoute(scored, limit);
}

/**
 * Take the best POIs, but avoid returning eight things clustered in the first
 * kilometre. Walks the ranked list and skips anything too close to something
 * already chosen, then backfills if that left us short.
 */
function spreadAlongRoute(scored: Highlight[], limit: number): Highlight[] {
  // Callers render these as an itinerary, so ride order is the contract on
  // every path — including when everything fits and no spreading is needed.
  if (scored.length <= limit) return byDistance(scored);

  const furthest = Math.max(...scored.map((entry) => entry.poi.distanceAlongRoute));
  const minSpacing = furthest / (limit * 1.5);

  const chosen: Highlight[] = [];
  for (const entry of scored) {
    if (chosen.length >= limit) break;
    const tooClose = chosen.some(
      (other) => Math.abs(other.poi.distanceAlongRoute - entry.poi.distanceAlongRoute) < minSpacing,
    );
    if (!tooClose) chosen.push(entry);
  }

  for (const entry of scored) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(entry)) chosen.push(entry);
  }

  return byDistance(chosen);
}

function byDistance(highlights: Highlight[]): Highlight[] {
  return [...highlights].sort((a, b) => a.poi.distanceAlongRoute - b.poi.distanceAlongRoute);
}

function describe(poi: Poi): string {
  const base = CATEGORY_REASON[poi.category];
  const detail = poi.tags.description || poi.tags['description:en'];
  if (detail) return `${base} — ${detail.slice(0, 120)}`;

  if (poi.category === 'nature' && poi.tags.ele) return `${base} — ${Math.round(Number(poi.tags.ele))}m summit`;
  if (poi.offsetFromRoute > 150) return `${base}, ~${poi.offsetFromRoute}m off the route`;
  return base;
}

/**
 * Short descriptors for the route as a whole. These are what let someone
 * compare three options at a glance without reading a POI list.
 */
export function deriveVibes(pois: Poi[], distance: number, elevation?: ElevationStats): string[] {
  const vibes: string[] = [];
  const count = (category: PoiCategory) => pois.filter((poi) => poi.category === category).length;

  if (elevation) {
    const climbPerKm = elevation.ascent / Math.max(1, distance / 1000);
    if (climbPerKm > 20) vibes.push('Big climbing');
    else if (climbPerKm > 10) vibes.push('Rolling');
    else vibes.push('Mostly flat');

    if (elevation.maxGradient > 8) vibes.push(`Steep pitches (${elevation.maxGradient}%)`);
  }

  if (count('viewpoint') >= 2) vibes.push('Scenic');
  if (count('water') >= 2) vibes.push('Waterside');
  if (count('park') >= 2 || count('nature') >= 2) vibes.push('Green');
  if (count('historic') >= 3) vibes.push('Historic');
  if (count('refuel') >= 3) vibes.push('Good café stops');
  if (count('art') >= 2) vibes.push('Public art');

  const km = distance / 1000;
  if (km < 8) vibes.push('Quick spin');
  else if (km > 40) vibes.push('Big day out');

  return vibes.slice(0, 5);
}

/** One-line summary shown on the route card. */
export function summarise(
  destination: string,
  distance: number,
  highlights: Highlight[],
  elevation?: ElevationStats,
): string {
  const km = (distance / 1000).toFixed(1);
  const climb = elevation ? `, ${elevation.ascent}m of climbing` : '';
  const names = highlights.slice(0, 3).map((h) => h.poi.name);

  const passing =
    names.length > 0
      ? ` past ${names.slice(0, -1).join(', ')}${names.length > 1 ? ' and ' : ''}${names.at(-1)}`
      : '';

  return `${km} km to ${destination}${climb}${passing}.`;
}
