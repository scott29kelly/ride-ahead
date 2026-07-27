import { describe, expect, it } from 'vitest';
import { buildHighlights, deriveVibes, scorePoi, summarise } from './score';
import type { Poi, PoiCategory } from './types';

function poi(overrides: Partial<Poi> & { id: string }): Poi {
  return {
    name: 'Somewhere',
    category: 'park',
    coord: [0, 0],
    offsetFromRoute: 50,
    distanceAlongRoute: 1000,
    tags: {},
    ...overrides,
  };
}

describe('scorePoi', () => {
  it('ranks a viewpoint above a drinking fountain', () => {
    const viewpoint = poi({ id: 'a', category: 'viewpoint' });
    const fountain = poi({ id: 'b', category: 'services' });
    expect(scorePoi(viewpoint, false)).toBeGreaterThan(scorePoi(fountain, false));
  });

  it('penalises things far off the route', () => {
    const near = poi({ id: 'a', category: 'viewpoint', offsetFromRoute: 20 });
    const far = poi({ id: 'b', category: 'viewpoint', offsetFromRoute: 350 });
    expect(scorePoi(near, false)).toBeGreaterThan(scorePoi(far, false));
  });

  it('drops anything past the detour threshold to zero', () => {
    expect(scorePoi(poi({ id: 'a', category: 'viewpoint', offsetFromRoute: 500 }), true)).toBe(0);
  });

  it('rewards having a photo and a wikipedia entry', () => {
    const plain = poi({ id: 'a', category: 'historic' });
    const notable = poi({ id: 'b', category: 'historic', tags: { wikipedia: 'en:Thing' } });

    expect(scorePoi(plain, true)).toBeGreaterThan(scorePoi(plain, false));
    expect(scorePoi(notable, false)).toBeGreaterThan(scorePoi(plain, false));
  });
});

describe('buildHighlights', () => {
  it('respects the limit and returns them in ride order', () => {
    const pois = Array.from({ length: 20 }, (_, i) =>
      poi({
        id: `poi-${i}`,
        category: 'viewpoint',
        distanceAlongRoute: i * 500,
      }),
    );

    const highlights = buildHighlights(pois, new Map(), 6);

    expect(highlights).toHaveLength(6);
    const distances = highlights.map((h) => h.poi.distanceAlongRoute);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('spreads highlights along the route instead of clustering them', () => {
    // Ten strong candidates bunched at the start, three weaker ones spread out.
    const clustered = Array.from({ length: 10 }, (_, i) =>
      poi({ id: `near-${i}`, category: 'viewpoint', distanceAlongRoute: i * 20 }),
    );
    const spread = [3000, 6000, 9000].map((distance, i) =>
      poi({ id: `far-${i}`, category: 'park', distanceAlongRoute: distance }),
    );

    const highlights = buildHighlights([...clustered, ...spread], new Map(), 5);
    const late = highlights.filter((h) => h.poi.distanceAlongRoute > 1000);

    expect(late.length).toBeGreaterThan(0);
  });

  it('excludes zero-scoring pois', () => {
    const tooFar = poi({ id: 'far', category: 'viewpoint', offsetFromRoute: 900 });
    expect(buildHighlights([tooFar], new Map())).toHaveLength(0);
  });

  it('handles an empty list', () => {
    expect(buildHighlights([], new Map())).toEqual([]);
  });
});

describe('deriveVibes', () => {
  const many = (category: PoiCategory, count: number) =>
    Array.from({ length: count }, (_, i) => poi({ id: `${category}-${i}`, category }));

  it('calls out sustained climbing', () => {
    const vibes = deriveVibes([], 10_000, {
      min: 100,
      max: 500,
      ascent: 400,
      descent: 20,
      maxGradient: 9,
    });

    expect(vibes).toContain('Big climbing');
    expect(vibes.some((vibe) => vibe.startsWith('Steep pitches'))).toBe(true);
  });

  it('describes a flat route as flat', () => {
    const vibes = deriveVibes([], 20_000, { min: 100, max: 110, ascent: 30, descent: 30, maxGradient: 1 });
    expect(vibes).toContain('Mostly flat');
  });

  it('picks up on the mix of places', () => {
    expect(deriveVibes(many('water', 3), 10_000)).toContain('Waterside');
    expect(deriveVibes(many('viewpoint', 2), 10_000)).toContain('Scenic');
    expect(deriveVibes(many('historic', 3), 10_000)).toContain('Historic');
  });

  it('tags rides by length', () => {
    expect(deriveVibes([], 5_000)).toContain('Quick spin');
    expect(deriveVibes([], 60_000)).toContain('Big day out');
  });

  it('never returns more than five', () => {
    const busy = [...many('water', 3), ...many('viewpoint', 3), ...many('historic', 3), ...many('refuel', 3)];
    expect(deriveVibes(busy, 60_000, { min: 0, max: 900, ascent: 900, descent: 20, maxGradient: 12 }).length)
      .toBeLessThanOrEqual(5);
  });
});

describe('summarise', () => {
  it('names the first few highlights', () => {
    const highlights = buildHighlights(
      [
        poi({ id: 'a', name: 'Blue Lake', category: 'water', distanceAlongRoute: 500 }),
        poi({ id: 'b', name: 'Old Mill', category: 'historic', distanceAlongRoute: 2000 }),
      ],
      new Map(),
    );

    const text = summarise('The Peak', 12_300, highlights);
    expect(text).toContain('12.3 km to The Peak');
    expect(text).toContain('Blue Lake');
    expect(text).toContain('Old Mill');
  });

  it('reads correctly with no highlights at all', () => {
    expect(summarise('Nowhere', 5_000, [])).toBe('5.0 km to Nowhere.');
  });
});
