import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../types';
import { route } from './routing';

const WAYPOINTS: LngLat[] = [
  [-105.2797, 40.015],
  [-105.2811, 39.9994],
];

/** A minimal ORS GeoJSON response with 3D coordinates. */
function orsResponse(properties: Record<string, unknown>) {
  return {
    features: [
      {
        geometry: {
          coordinates: [
            [-105.2797, 40.015, 1655],
            [-105.2804, 40.007, 1670],
            [-105.2811, 39.9994, 1712],
          ],
        },
        properties,
      },
    ],
  };
}

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ORS_API_KEY;
});

describe('route via OpenRouteService', () => {
  it('asks for geo+json, since the /geojson endpoint content-negotiates', async () => {
    process.env.ORS_API_KEY = 'test-key';
    const fetchSpy = mockFetch(orsResponse({ summary: { distance: 1800, duration: 420 } }));

    await route(WAYPOINTS, 'cycling-regular');

    const [url, init] = fetchSpy.mock.calls[0];
    const headers = init!.headers as Record<string, string>;

    expect(url).toContain('/v2/directions/cycling-regular/geojson');
    expect(headers.Accept).toContain('application/geo+json');
    // The key goes in bare — no Bearer prefix.
    expect(headers.Authorization).toBe('test-key');
  });

  it('requests elevation and carries it onto the route points', async () => {
    process.env.ORS_API_KEY = 'test-key';
    const fetchSpy = mockFetch(orsResponse({ summary: { distance: 1800, duration: 420 } }));

    const result = await route(WAYPOINTS, 'cycling-regular');

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.elevation).toBe(true);
    expect(result.points.map((point) => point.elevation)).toEqual([1655, 1670, 1712]);
    expect(result.warnings).toEqual([]);
  });

  it('reads ascent from properties', async () => {
    process.env.ORS_API_KEY = 'test-key';
    mockFetch(orsResponse({ summary: { distance: 1800, duration: 420 }, ascent: 57, descent: 3 }));

    const result = await route(WAYPOINTS, 'cycling-regular');

    expect(result.ascent).toBe(57);
    expect(result.descent).toBe(3);
  });

  it('reads ascent from summary when ORS puts it there instead', async () => {
    // ORS has moved these between properties and properties.summary across
    // versions; whichever this deployment uses, the climb must survive.
    process.env.ORS_API_KEY = 'test-key';
    mockFetch(orsResponse({ summary: { distance: 1800, duration: 420, ascent: 57, descent: 3 } }));

    const result = await route(WAYPOINTS, 'cycling-regular');

    expect(result.ascent).toBe(57);
    expect(result.descent).toBe(3);
  });

  it('warns when elevation was requested but the geometry came back 2D', async () => {
    process.env.ORS_API_KEY = 'test-key';
    mockFetch({
      features: [
        {
          geometry: {
            coordinates: [
              [-105.2797, 40.015],
              [-105.2811, 39.9994],
            ],
          },
          properties: { summary: { distance: 1800, duration: 420 } },
        },
      ],
    });

    const result = await route(WAYPOINTS, 'cycling-regular');

    expect(result.points.every((point) => point.elevation === undefined)).toBe(true);
    // Silently dropping the climb profile is the failure mode this guards.
    expect(result.warnings.join(' ')).toMatch(/without elevation/i);
  });

  it('falls back to the summed geometry when there is no summary distance', async () => {
    process.env.ORS_API_KEY = 'test-key';
    mockFetch(orsResponse({}));

    const result = await route(WAYPOINTS, 'cycling-regular');

    expect(result.distance).toBeGreaterThan(1_000);
  });

  it('rejects a response with no route', async () => {
    process.env.ORS_API_KEY = 'test-key';
    mockFetch({ features: [] });

    await expect(route(WAYPOINTS, 'cycling-regular')).rejects.toThrow(/no route/i);
  });
});

describe('route without a key', () => {
  it('falls back to OSRM and says the profile is wrong for a bike', async () => {
    mockFetch({
      code: 'Ok',
      routes: [
        {
          distance: 1800,
          duration: 300,
          geometry: {
            coordinates: [
              [-105.2797, 40.015],
              [-105.2811, 39.9994],
            ],
          },
        },
      ],
    });

    const result = await route(WAYPOINTS, 'cycling-regular');

    expect(result.provider).toMatch(/OSRM/);
    expect(result.warnings.join(' ')).toMatch(/car profile/i);
    // Car durations are re-estimated at cycling speed.
    expect(result.duration).toBeCloseTo((1800 / 1000 / 16) * 3600, 0);
  });
});

describe('route input validation', () => {
  it('needs at least a start and a destination', async () => {
    await expect(route([WAYPOINTS[0]], 'cycling-regular')).rejects.toThrow(/at least/i);
  });
});
