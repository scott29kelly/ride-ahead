import { describe, expect, it } from 'vitest';
import { buildRoutePoints } from '../geo';
import type { LngLat, RoutePoint } from '../types';
import { buildCorridorQuery, categorise } from './pois';

/** A straight line east from Boulder, one vertex every ~25m. */
function straightRoute(lengthMetres: number): RoutePoint[] {
  const metresPerDegreeLng = 85_000; // close enough at 40°N
  const coords: LngLat[] = [];
  for (let travelled = 0; travelled <= lengthMetres; travelled += 25) {
    coords.push([-105.28 + travelled / metresPerDegreeLng, 40.015]);
  }
  return buildRoutePoints(coords);
}

/** Pull the corridor spine back out of the generated query. */
function spineLength(query: string): number {
  const match = query.match(/\(around:\d+,([^)]*)\)/);
  if (!match) throw new Error('no around clause in query');
  return match[1].split(',').length / 2;
}

describe('buildCorridorQuery', () => {
  it('queries a corridor along the route, not a bounding box', () => {
    const query = buildCorridorQuery(straightRoute(2_000), 180);

    expect(query).toContain('around:180');
    // More than two points means it follows the line rather than its extent.
    expect(spineLength(query)).toBeGreaterThan(2);
    expect(query).not.toContain('bbox');
  });

  it('groups rules sharing an OSM key into one clause', () => {
    const query = buildCorridorQuery(straightRoute(1_000), 180);
    const clauses = query.match(/nwr\(around:/g) ?? [];

    // One clause per distinct key (tourism, natural, waterway, historic,
    // man_made, leisure, boundary, amenity), not one per rule. Each clause
    // repeats the whole coordinate list, so the count drives the query size.
    expect(clauses.length).toBe(8);
  });

  it('keeps every key from the rule table', () => {
    const query = buildCorridorQuery(straightRoute(1_000), 180);

    for (const key of ['tourism', 'natural', 'waterway', 'historic', 'man_made', 'leisure', 'boundary', 'amenity']) {
      expect(query).toContain(`["${key}"`);
    }
  });

  it('merges the values of rules that share a key', () => {
    const query = buildCorridorQuery(straightRoute(1_000), 180);
    const tourism = query.match(/\["tourism"~"\^\(([^)]*)\)/)?.[1].split('|') ?? [];

    // viewpoint, artwork, attraction/museum and picnic_site are four separate
    // rules mapping to four different categories, all keyed on tourism.
    expect(tourism).toEqual(
      expect.arrayContaining(['viewpoint', 'artwork', 'attraction', 'museum', 'picnic_site']),
    );
  });

  it('matches a bare key without a value regex', () => {
    const query = buildCorridorQuery(straightRoute(1_000), 180);

    // `historic` is a wildcard rule: any value counts.
    expect(query).toContain('["historic"];');
  });

  it('spaces the spine closely enough that the circles overlap', () => {
    const length = 3_000;
    const radius = 180;
    const points = spineLength(buildCorridorQuery(straightRoute(length), radius));
    const gap = length / (points - 1);

    // A gap of 2×radius would leave the midpoint uncovered.
    expect(gap).toBeLessThan(radius * 2);
  });

  it('covers the whole route on a long ride instead of truncating it', () => {
    // 120 km at the ideal 162m spacing would need ~740 vertices, well past the
    // cap. The spine must stretch to the finish rather than stopping partway
    // and silently leaving the back half of the ride with no places.
    const length = 120_000;
    const query = buildCorridorQuery(straightRoute(length), 180);

    const coords = query.match(/\(around:\d+,([^)]*)\)/)![1].split(',');
    const lastLng = Number(coords.at(-1));
    const endLng = -105.28 + length / 85_000;

    expect(lastLng).toBeCloseTo(endLng, 2);
  });

  it('keeps the query small enough for Overpass on a long ride', () => {
    const query = buildCorridorQuery(straightRoute(120_000), 180);

    expect(spineLength(query)).toBeLessThanOrEqual(302);
    expect(query.length).toBeLessThan(80_000);
  });

  it('gives the client a longer deadline than the server', () => {
    const query = buildCorridorQuery(straightRoute(1_000), 180);
    const serverTimeout = Number(query.match(/\[timeout:(\d+)\]/)![1]);

    // findPois waits serverTimeout + 30s. If these were equal the client would
    // abort exactly as Overpass finished, and every slow query would look like
    // a network failure.
    expect(serverTimeout).toBeLessThan(80);
  });

  it('asks for tags and centres so ways and relations have a position', () => {
    const query = buildCorridorQuery(straightRoute(1_000), 180);

    // Without `center`, every way and relation comes back with no coordinates
    // and gets dropped when the results are projected onto the route.
    expect(query).toContain('out tags center qt;');
  });
});

describe('categorise', () => {
  it('prefers the most specific rule', () => {
    // A viewpoint inside a park should read as a viewpoint.
    expect(categorise({ tourism: 'viewpoint', leisure: 'park' })).toBe('viewpoint');
  });

  it('returns null for tags nothing matches', () => {
    expect(categorise({ highway: 'residential' })).toBeNull();
  });

  it('treats any historic value as historic', () => {
    expect(categorise({ historic: 'memorial' })).toBe('historic');
    expect(categorise({ historic: 'anything_at_all' })).toBe('historic');
  });
});
