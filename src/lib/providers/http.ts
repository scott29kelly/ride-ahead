/** Shared fetch helpers. Every outbound call goes through here so timeouts and
 *  failure handling are consistent across providers. */

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Nominatim and Overpass both require a real identifying User-Agent. */
export const USER_AGENT =
  process.env.RIDEAHEAD_USER_AGENT ?? 'RideAhead/0.1 (route preview; self-hosted)';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  provider: string;
}

export async function fetchJson<T>(url: string, options: FetchOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, provider, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        provider,
        `HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(provider, `timed out after ${timeoutMs}ms`);
    }
    throw new ProviderError(provider, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a provider call and fold any failure into a warning instead of throwing.
 * Imagery and POI lookups are enrichment: a preview without them is degraded
 * but still worth showing, so nothing here should be able to fail a request.
 */
export async function optional<T>(
  work: () => Promise<T>,
  fallback: T,
  warnings: string[],
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

/**
 * Collapse repeated warnings into one line with a count.
 *
 * Imagery is fetched once per frame, so a single misconfiguration — an expired
 * token, a provider refusing the key — fails identically dozens of times per
 * route. Reported verbatim that buries every other warning under one repeated
 * message, which is exactly the moment the other warnings matter most.
 */
export function dedupeWarnings(warnings: string[]): string[] {
  const counts = new Map<string, number>();
  for (const warning of warnings) counts.set(warning, (counts.get(warning) ?? 0) + 1);

  return [...counts].map(([warning, count]) => (count > 1 ? `${warning} (×${count})` : warning));
}

/** Resolve promises with a cap on how many run at once, to stay inside provider rate limits. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
