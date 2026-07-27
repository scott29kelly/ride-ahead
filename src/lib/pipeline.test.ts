import { beforeAll, describe, expect, it } from 'vitest';
import { buildPreviews } from './pipeline';
import type { PreviewResponse } from './types';

/**
 * End-to-end exercise of the pipeline through demo mode. This covers route
 * assembly, sampling, POI projection, scoring and frame construction without
 * touching the network, so it runs anywhere.
 */
describe('buildPreviews (demo mode)', () => {
  let result: PreviewResponse;

  beforeAll(async () => {
    process.env.RIDEAHEAD_DEMO = '1';
    result = await buildPreviews({
      start: 'Boulder Public Library',
      destinations: ['Chautauqua Park', 'Boulder Canyon', 'NCAR'],
      profile: 'cycling-regular',
      roundTrip: false,
    });
  });

  it('returns one preview per destination', () => {
    expect(result.demoMode).toBe(true);
    expect(result.routes).toHaveLength(3);
    expect(new Set(result.routes.map((route) => route.id)).size).toBe(3);
  });

  it('builds plausible route geometry and distances', () => {
    for (const route of result.routes) {
      expect(route.geometry.length).toBeGreaterThan(20);
      expect(route.distance).toBeGreaterThan(500);
      expect(route.duration).toBeGreaterThan(0);

      for (const [lng, lat] of route.geometry) {
        expect(Math.abs(lng)).toBeLessThanOrEqual(180);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      }
    }
  });

  it('produces frames in increasing distance order, each with an image', () => {
    for (const route of result.routes) {
      expect(route.frames.length).toBeGreaterThan(1);

      let previous = -1;
      for (const frame of route.frames) {
        expect(frame.distance).toBeGreaterThanOrEqual(previous);
        expect(frame.image?.source).toBe('demo');
        expect(frame.bearing).toBeGreaterThanOrEqual(0);
        expect(frame.bearing).toBeLessThanOrEqual(360);
        previous = frame.distance;
      }
    }
  });

  it('places highlights on the route and orders them by distance', () => {
    for (const route of result.routes) {
      expect(route.highlights.length).toBeGreaterThan(0);

      const distances = route.highlights.map((highlight) => highlight.poi.distanceAlongRoute);
      expect([...distances].sort((a, b) => a - b)).toEqual(distances);

      for (const highlight of route.highlights) {
        expect(highlight.poi.distanceAlongRoute).toBeLessThanOrEqual(Math.ceil(route.distance));
        expect(highlight.poi.offsetFromRoute).toBeLessThan(400);
      }
    }
  });

  it('derives elevation stats and a matching profile series', () => {
    for (const route of result.routes) {
      expect(route.elevation).toBeDefined();
      expect(route.elevation!.max).toBeGreaterThanOrEqual(route.elevation!.min);
      expect(route.elevationSeries!.length).toBeGreaterThan(2);
    }
  });

  it('identifies the climb to NCAR and the flat creek path', () => {
    const ncar = result.routes.find((route) => route.destination.name.includes('NCAR'))!;
    const creek = result.routes.find((route) => route.destination.name.includes('Canyon'))!;

    expect(ncar.elevation!.ascent).toBeGreaterThan(creek.elevation!.ascent);
    expect(ncar.vibes).toContain('Big climbing');
    expect(creek.vibes).toContain('Mostly flat');
  });

  it('writes a summary naming the destination', () => {
    for (const route of result.routes) {
      expect(route.summary).toContain(route.destination.name);
      expect(route.summary).toMatch(/^\d+(\.\d+)? km/);
    }
  });

  it('rejects a request with no destinations', async () => {
    await expect(
      buildPreviews({ start: 'Boulder', destinations: ['   '], profile: 'cycling-regular', roundTrip: false }),
    ).rejects.toThrow(/destination/i);
  });

  it('caps comparison at three destinations', async () => {
    const capped = await buildPreviews({
      start: 'Boulder',
      destinations: ['a', 'b', 'c', 'd', 'e'],
      profile: 'cycling-regular',
      roundTrip: false,
    });
    expect(capped.routes).toHaveLength(3);
  });
});
