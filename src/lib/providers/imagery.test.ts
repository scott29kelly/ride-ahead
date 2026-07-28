import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../types';
import { findFrameImage, findMapillaryImage, findStreetViewImage } from './imagery';

const COORD: LngLat = [-105.2797, 40.015];

function mapillaryImage(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    thumb_1024_url: 'https://example.test/1024.jpg',
    thumb_2048_url: 'https://example.test/2048.jpg',
    computed_geometry: { coordinates: COORD },
    captured_at: 1_700_000_000_000,
    compass_angle: 90,
    ...overrides,
  };
}

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.ok === false ? 'Unauthorized' : 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MAPILLARY_TOKEN;
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.RIDEAHEAD_IMAGERY_PRIORITY;
});

/** Route each host to its own canned response, so ordering is observable. */
function mockByHost(responses: { mapillary?: unknown; streetView?: unknown }) {
  const spy = vi.fn(async (url: string, _init?: RequestInit) => {
    const body = url.includes('mapillary') ? responses.mapillary : responses.streetView;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body ?? {},
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Street View metadata reporting a panorama `offsetDegrees` east of the query. */
function streetViewMetadata(offsetDegrees = 0) {
  return {
    status: 'OK',
    date: '2024-09',
    location: { lat: COORD[1], lng: COORD[0] + offsetDegrees },
  };
}

describe('findMapillaryImage', () => {
  it('sends the token as an OAuth header, not in the query string', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|test|token';
    const fetchSpy = mockFetch({ data: [mapillaryImage()] });

    await findMapillaryImage({ coord: COORD, bearing: 90 });

    const [url, init] = fetchSpy.mock.calls[0];
    // Mapillary documents the "OAuth" scheme; Bearer is rejected. Keeping it
    // out of the URL also keeps it out of anything that logs URLs.
    expect((init!.headers as Record<string, string>).Authorization).toBe('OAuth MLY|test|token');
    expect(url).not.toContain('MLY');
    expect(url).not.toContain('access_token');
  });

  it('requests every field the result is built from', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    const fetchSpy = mockFetch({ data: [mapillaryImage()] });

    await findMapillaryImage({ coord: COORD, bearing: 90 });

    const url = fetchSpy.mock.calls[0][0] as string;
    for (const field of ['thumb_1024_url', 'thumb_2048_url', 'computed_geometry', 'compass_angle', 'captured_at']) {
      expect(decodeURIComponent(url)).toContain(field);
    }
  });

  it('returns null without a token rather than calling out', async () => {
    const fetchSpy = mockFetch({ data: [] });

    expect(await findMapillaryImage({ coord: COORD, bearing: 90 })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('prefers a distant photo facing the way you ride over a near one facing away', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    mockFetch({
      data: [
        // At your exact position, pointing back the way you came.
        mapillaryImage({ id: 'behind', compass_angle: 270, thumb_1024_url: 'https://example.test/behind.jpg' }),
        // ~40m away, pointing down the road ahead.
        mapillaryImage({
          id: 'ahead',
          compass_angle: 90,
          computed_geometry: { coordinates: [COORD[0] + 0.0005, COORD[1]] },
          thumb_1024_url: 'https://example.test/ahead.jpg',
        }),
      ],
    });

    const image = await findMapillaryImage({ coord: COORD, bearing: 90 });

    expect(image?.url).toBe('https://example.test/ahead.jpg');
  });

  it('surfaces a rejected token instead of reporting no imagery', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|wrong';
    mockFetch({ message: 'Invalid OAuth access token' }, { ok: false, status: 401 });

    // "No photos here" and "your token is wrong" must not look the same.
    await expect(findMapillaryImage({ coord: COORD, bearing: 90 })).rejects.toThrow(/401/);
  });

  it('returns null when the area simply has no coverage', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    mockFetch({ data: [] });

    expect(await findMapillaryImage({ coord: COORD, bearing: 90 })).toBeNull();
  });

  it('carries attribution, capture date and a link back to the source', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    mockFetch({ data: [mapillaryImage()] });

    const image = await findMapillaryImage({ coord: COORD, bearing: 90 });

    expect(image?.attribution).toMatch(/Mapillary/);
    expect(image?.sourceUrl).toContain('pKey=1');
    expect(image?.capturedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(image?.fullUrl).toBe('https://example.test/2048.jpg');
  });
});

describe('findStreetViewImage', () => {
  it('returns null for a genuine coverage gap', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    mockFetch({ status: 'ZERO_RESULTS' });

    expect(await findStreetViewImage({ coord: COORD, bearing: 90 })).toBeNull();
  });

  it('raises a rejected key rather than swallowing it on every frame', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'bad-key';
    mockFetch({ status: 'REQUEST_DENIED', error_message: 'API key not valid' });

    await expect(findStreetViewImage({ coord: COORD, bearing: 90 })).rejects.toThrow(/REQUEST_DENIED/);
  });

  it('points the camera along the direction of travel', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    mockFetch({ status: 'OK', date: '2024-06', location: { lat: 40.015, lng: -105.2797 } });

    const image = await findStreetViewImage({ coord: COORD, bearing: 137 });

    expect(image?.url).toContain('heading=137');
    expect(image?.heading).toBe(137);
    expect(image?.capturedAt).toBe('2024-06');
  });

  it('does not call out without a key', async () => {
    const fetchSpy = mockFetch({ status: 'OK' });

    expect(await findStreetViewImage({ coord: COORD, bearing: 90 })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('findFrameImage', () => {
  it('prefers Street View where it covers the line you are riding', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    mockByHost({ streetView: streetViewMetadata(0), mapillary: { data: [mapillaryImage()] } });

    const image = await findFrameImage({ coord: COORD, bearing: 90 });

    // Street View's heading is a request parameter, so it faces exactly the
    // way you ride — Mapillary can only offer the best angle that exists.
    expect(image?.source).toBe('street-view');
  });

  it('falls back to Mapillary when the nearest panorama is off the route', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    // ~85m east: real coverage, but on a parallel road rather than the path.
    mockByHost({ streetView: streetViewMetadata(0.001), mapillary: { data: [mapillaryImage()] } });

    const image = await findFrameImage({ coord: COORD, bearing: 90 });

    expect(image?.source).toBe('mapillary');
  });

  it('still uses distant Street View when Mapillary has nothing', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    mockByHost({ streetView: streetViewMetadata(0.001), mapillary: { data: [] } });

    // A slightly-off view beats a blank frame.
    expect((await findFrameImage({ coord: COORD, bearing: 90 }))?.source).toBe('street-view');
  });

  it('falls back to Mapillary where Street View has no coverage at all', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    mockByHost({ streetView: { status: 'ZERO_RESULTS' }, mapillary: { data: [mapillaryImage()] } });

    expect((await findFrameImage({ coord: COORD, bearing: 90 }))?.source).toBe('mapillary');
  });

  it('honours an explicit preference for free imagery', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    process.env.RIDEAHEAD_IMAGERY_PRIORITY = 'mapillary';
    const fetchSpy = mockByHost({
      streetView: streetViewMetadata(0),
      mapillary: { data: [mapillaryImage()] },
    });

    const image = await findFrameImage({ coord: COORD, bearing: 90 });

    expect(image?.source).toBe('mapillary');
    // Mapillary answered, so Street View is never even probed.
    expect(fetchSpy.mock.calls.every(([url]) => (url as string).includes('mapillary'))).toBe(true);
  });

  it('uses Mapillary alone when there is no Street View key', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|test';
    mockByHost({ mapillary: { data: [mapillaryImage()] } });

    expect((await findFrameImage({ coord: COORD, bearing: 90 }))?.source).toBe('mapillary');
  });
});
