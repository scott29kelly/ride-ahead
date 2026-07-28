import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { geocode, parseCoordinate } from './geocode';

// Nominatim's 1/sec pacing is real, but waiting it out here would add seconds
// per test for no coverage. The interval itself is exercised by its own test.
beforeAll(() => {
  process.env.NOMINATIM_MIN_INTERVAL_MS = '0';
});

function nominatimHit(overrides: Record<string, unknown> = {}) {
  return {
    lat: '40.2093',
    lon: '-75.0899',
    display_name: 'Veterans Way, Warminster, Bucks County, Pennsylvania, 18974, United States',
    name: 'Veterans Way',
    ...overrides,
  };
}

/** Queue one response per call, in order. */
function mockFetchSequence(bodies: unknown[]) {
  let call = 0;
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => bodies[Math.min(call++, bodies.length - 1)],
    text: async () => '',
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseCoordinate', () => {
  it('accepts a pasted lat,lng pair', () => {
    expect(parseCoordinate('40.015, -105.279')).toEqual([-105.279, 40.015]);
  });

  it('rejects out-of-range values', () => {
    expect(parseCoordinate('200, -105.279')).toBeNull();
    expect(parseCoordinate('40.015, -400')).toBeNull();
  });

  it('rejects free text', () => {
    expect(parseCoordinate('Chautauqua Park')).toBeNull();
  });
});

describe('geocode', () => {
  it('never calls out for a pasted coordinate pair', async () => {
    const fetchSpy = mockFetchSequence([[]]);

    const place = await geocode('40.015, -105.279');

    expect(place.coord).toEqual([-105.279, 40.015]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves a normal query in one request', async () => {
    const fetchSpy = mockFetchSequence([[nominatimHit()]]);

    const place = await geocode('Chautauqua Park Boulder');

    expect(place.coord).toEqual([-75.0899, 40.2093]);
    expect(place.label).toMatch(/Warminster/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries without the house number when a US street address misses', async () => {
    // OSM's coverage of individual house numbers is uneven, so "300 Veterans
    // Way" can miss where "Veterans Way" resolves fine.
    const fetchSpy = mockFetchSequence([[], [nominatimHit()]]);

    const place = await geocode('300 Veterans Way, Warminster, PA 18974');

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const retried = new URL(fetchSpy.mock.calls[1][0] as string).searchParams.get('q');
    expect(retried).toBe('Veterans Way, Warminster, PA 18974');
    expect(place.coord).toEqual([-75.0899, 40.2093]);
  });

  it('paces requests to stay inside Nominatim usage policy', async () => {
    process.env.NOMINATIM_MIN_INTERVAL_MS = '60';
    mockFetchSequence([[nominatimHit()]]);

    const started = Date.now();
    await geocode('first place');
    await geocode('second place');
    const elapsed = Date.now() - started;

    // Getting an IP blocked by Nominatim is slow to undo, so the gap between
    // consecutive lookups is not optional.
    expect(elapsed).toBeGreaterThanOrEqual(55);
    process.env.NOMINATIM_MIN_INTERVAL_MS = '0';
  });

  it('does not retry when there is no house number to strip', async () => {
    const fetchSpy = mockFetchSequence([[]]);

    await expect(geocode('Nowhere At All')).rejects.toThrow(/no match/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('suggests what to try instead when everything misses', async () => {
    mockFetchSequence([[], []]);

    // A dead end should say what would work, not just that it failed.
    await expect(geocode('300 Imaginary Road, Nowhere')).rejects.toThrow(/coordinates/i);
  });

  it('rejects an empty query without calling out', async () => {
    const fetchSpy = mockFetchSequence([[]]);

    await expect(geocode('   ')).rejects.toThrow(/empty/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('biases results toward the start point when one is given', async () => {
    const fetchSpy = mockFetchSequence([[nominatimHit()]]);

    await geocode('the park', [-105.28, 40.015]);

    expect(fetchSpy.mock.calls[0][0]).toContain('viewbox=');
  });
});
