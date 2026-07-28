import { describe, expect, it } from 'vitest';
import { dedupeWarnings, mapWithConcurrency, optional } from './http';

describe('dedupeWarnings', () => {
  it('collapses repeats into one line with a count', () => {
    const warnings = Array.from({ length: 24 }, () => '[mapillary] HTTP 401: token rejected');

    expect(dedupeWarnings(warnings)).toEqual(['[mapillary] HTTP 401: token rejected (×24)']);
  });

  it('leaves a one-off warning untouched', () => {
    expect(dedupeWarnings(['[overpass] timed out'])).toEqual(['[overpass] timed out']);
  });

  it('keeps distinct warnings, in the order they first appeared', () => {
    expect(
      dedupeWarnings(['routed without elevation', '[mapillary] 401', '[mapillary] 401', '[overpass] timed out']),
    ).toEqual(['routed without elevation', '[mapillary] 401 (×2)', '[overpass] timed out']);
  });

  it('does not hide a rare warning behind a common one', () => {
    // The whole point: one repeated failure must not bury the others.
    const warnings = [...Array.from({ length: 40 }, () => 'imagery failed'), 'no route elevation'];

    expect(dedupeWarnings(warnings)).toHaveLength(2);
    expect(dedupeWarnings(warnings)).toContain('no route elevation');
  });
});

describe('optional', () => {
  it('returns the value when the work succeeds', async () => {
    const warnings: string[] = [];

    expect(await optional(async () => 'photo', null, warnings)).toBe('photo');
    expect(warnings).toEqual([]);
  });

  it('folds a failure into a warning and returns the fallback', async () => {
    const warnings: string[] = [];

    const result = await optional(
      async () => {
        throw new Error('[mapillary] HTTP 401');
      },
      null,
      warnings,
    );

    expect(result).toBeNull();
    expect(warnings).toEqual(['[mapillary] HTTP 401']);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const delays = [30, 0, 20, 10];

    const results = await mapWithConcurrency(delays, 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
