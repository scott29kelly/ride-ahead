import { describe, expect, it } from 'vitest';
import {
  bearing,
  bearingDelta,
  boundingBox,
  buildRoutePoints,
  decimate,
  elevationStats,
  haversine,
  projectOntoRoute,
  sampleAlongRoute,
} from './geo';
import type { LngLat } from './types';

describe('haversine', () => {
  it('measures a known distance', () => {
    // One degree of latitude is ~111.2 km anywhere on the globe.
    expect(haversine([0, 0], [0, 1])).toBeCloseTo(111_195, -2);
  });

  it('is zero for the same point and symmetric', () => {
    const a: LngLat = [-105.28, 40.01];
    const b: LngLat = [-105.25, 40.03];
    expect(haversine(a, a)).toBe(0);
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 6);
  });
});

describe('bearing', () => {
  it('points north, east, south and west', () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0, 1);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90, 1);
    expect(bearing([0, 1], [0, 0])).toBeCloseTo(180, 1);
    expect(bearing([1, 0], [0, 0])).toBeCloseTo(270, 1);
  });
});

describe('bearingDelta', () => {
  it('takes the short way round the compass', () => {
    expect(bearingDelta(350, 10)).toBeCloseTo(20);
    expect(bearingDelta(10, 350)).toBeCloseTo(20);
    expect(bearingDelta(0, 180)).toBeCloseTo(180);
    expect(bearingDelta(90, 90)).toBe(0);
  });
});

describe('buildRoutePoints', () => {
  it('accumulates distance along the line', () => {
    const points = buildRoutePoints([
      [0, 0],
      [0, 0.01],
      [0, 0.02],
    ]);

    expect(points).toHaveLength(3);
    expect(points[0].distance).toBe(0);
    expect(points[2].distance).toBeCloseTo(points[1].distance * 2, 0);
  });

  it('attaches elevation and drops interior duplicate points', () => {
    const points = buildRoutePoints(
      [
        [0, 0],
        [0, 0],
        [0, 0.01],
      ],
      [100, 100, 150],
    );

    expect(points).toHaveLength(2);
    expect(points[0].elevation).toBe(100);
    expect(points[1].elevation).toBe(150);
  });

  it('handles an empty input', () => {
    expect(buildRoutePoints([])).toEqual([]);
  });
});

describe('sampleAlongRoute', () => {
  const points = buildRoutePoints([
    [0, 0],
    [0, 0.05],
    [0, 0.1],
  ]);

  it('returns exactly the requested number of evenly spaced samples', () => {
    const samples = sampleAlongRoute(points, 5);
    expect(samples).toHaveLength(5);

    const gaps = samples.slice(1).map((sample, i) => sample.distance - samples[i].distance);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 3);
  });

  it('always includes the start and the finish', () => {
    const samples = sampleAlongRoute(points, 7);
    expect(samples[0].distance).toBe(0);
    expect(samples.at(-1)!.distance).toBeCloseTo(points.at(-1)!.distance, 3);
  });

  it('interpolates elevation between vertices', () => {
    const withElevation = buildRoutePoints(
      [
        [0, 0],
        [0, 0.1],
      ],
      [100, 200],
    );
    const samples = sampleAlongRoute(withElevation, 3);
    expect(samples[1].elevation).toBeCloseTo(150, 0);
  });

  it('survives degenerate routes', () => {
    expect(sampleAlongRoute([], 5)).toEqual([]);
    expect(sampleAlongRoute(buildRoutePoints([[0, 0]]), 5)).toHaveLength(1);
  });
});

describe('projectOntoRoute', () => {
  // A 1 km leg east, then 1 km north.
  const points = buildRoutePoints([
    [0, 0],
    [0.01, 0],
    [0.01, 0.01],
  ]);

  it('finds the perpendicular offset to the line', () => {
    const projection = projectOntoRoute(points, [0.005, 0.001]);
    expect(projection.offset).toBeCloseTo(111, -1);
    expect(projection.distanceAlong).toBeCloseTo(556, -2);
  });

  it('clamps to the ends rather than projecting past them', () => {
    const before = projectOntoRoute(points, [-0.01, 0]);
    expect(before.distanceAlong).toBe(0);
  });

  it('returns zero offset for a point exactly on the route', () => {
    expect(projectOntoRoute(points, [0.005, 0]).offset).toBeCloseTo(0, 1);
  });
});

describe('boundingBox', () => {
  it('bounds the coordinates and grows with padding', () => {
    const tight = boundingBox([
      [-1, -1],
      [1, 1],
    ]);
    expect(tight).toEqual([-1, -1, 1, 1]);

    const padded = boundingBox(
      [
        [-1, -1],
        [1, 1],
      ],
      1000,
    );
    expect(padded[0]).toBeLessThan(-1);
    expect(padded[2]).toBeGreaterThan(1);
  });
});

describe('decimate', () => {
  it('thins points to at least the requested spacing', () => {
    const points = buildRoutePoints(
      Array.from({ length: 50 }, (_, i) => [0, i * 0.0001] as LngLat),
    );
    const thinned = decimate(points, 100);

    expect(thinned.length).toBeLessThan(points.length);
    for (let i = 1; i < thinned.length - 1; i++) {
      expect(thinned[i].distance - thinned[i - 1].distance).toBeGreaterThanOrEqual(100);
    }
    // The finish is always kept, even if it breaks the spacing rule.
    expect(thinned.at(-1)!.distance).toBe(points.at(-1)!.distance);
  });
});

describe('elevationStats', () => {
  it('separates ascent from descent', () => {
    const points = buildRoutePoints(
      [
        [0, 0],
        [0, 0.01],
        [0, 0.02],
        [0, 0.03],
      ],
      [100, 150, 120, 200],
    );

    const stats = elevationStats(points)!;
    expect(stats.ascent).toBe(130);
    expect(stats.descent).toBe(30);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(200);
  });

  it('ignores sub-metre noise that would inflate ascent', () => {
    const noisy = buildRoutePoints(
      Array.from({ length: 20 }, (_, i) => [0, i * 0.001] as LngLat),
      Array.from({ length: 20 }, (_, i) => 100 + (i % 2) * 0.4),
    );
    expect(elevationStats(noisy)!.ascent).toBe(0);
  });

  it('measures gradient across a window, not between adjacent points', () => {
    // Points every ~11m — closer together than the 50m gradient window, which
    // is what a real router emits. A steady 10% climb must still read as 10%.
    const dense = buildRoutePoints(
      Array.from({ length: 40 }, (_, i) => [0, i * 0.0001] as LngLat),
      Array.from({ length: 40 }, (_, i) => 100 + i * 1.112),
    );

    expect(elevationStats(dense)!.maxGradient).toBeCloseTo(10, 0);
  });

  it('reports the steepest section rather than the average', () => {
    const points = buildRoutePoints(
      [
        [0, 0],
        [0, 0.002],
        [0, 0.004],
        [0, 0.006],
      ],
      // Flat, then a sharp 20% ramp over the same distance, then flat.
      [100, 100, 144.5, 144.5],
    );

    const stats = elevationStats(points)!;
    expect(stats.maxGradient).toBeGreaterThan(15);
  });

  it('never reports a negative steepest gradient on a pure descent', () => {
    const downhill = buildRoutePoints(
      [
        [0, 0],
        [0, 0.005],
        [0, 0.01],
      ],
      [500, 400, 300],
    );

    expect(elevationStats(downhill)!.maxGradient).toBe(0);
    expect(elevationStats(downhill)!.descent).toBe(200);
  });

  it('returns undefined without elevation data', () => {
    expect(
      elevationStats(
        buildRoutePoints([
          [0, 0],
          [0, 0.01],
        ]),
      ),
    ).toBeUndefined();
  });
});
