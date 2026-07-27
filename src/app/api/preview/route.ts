import { NextResponse } from 'next/server';
import { buildPreviews, isDemoMode } from '@/lib/pipeline';
import type { BikeProfile, RouteRequest } from '@/lib/types';

export const runtime = 'nodejs';
/** Every response depends on live upstream data, so never cache at the edge. */
export const dynamic = 'force-dynamic';

const PROFILES: BikeProfile[] = ['cycling-regular', 'cycling-road', 'cycling-mountain'];

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const parsed = parse(payload);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await buildPreviews(parsed.value);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not build a preview.';
    console.error('[preview] failed:', error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    demoMode: isDemoMode(),
    providers: {
      routing: process.env.ORS_API_KEY ? 'openrouteservice' : 'osrm-demo',
      mapillary: Boolean(process.env.MAPILLARY_TOKEN),
      streetView: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    },
  });
}

function parse(payload: unknown): { value: RouteRequest } | { error: string } {
  if (typeof payload !== 'object' || payload === null) return { error: 'Expected a JSON object.' };

  const body = payload as Record<string, unknown>;
  const start = typeof body.start === 'string' ? body.start.trim() : '';
  if (!start) return { error: 'A starting point is required.' };

  const rawDestinations = Array.isArray(body.destinations) ? body.destinations : [];
  const destinations = rawDestinations
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (destinations.length === 0) return { error: 'Add at least one destination.' };
  if (destinations.length > 3) return { error: 'Compare at most three destinations at a time.' };

  const profile = PROFILES.includes(body.profile as BikeProfile)
    ? (body.profile as BikeProfile)
    : 'cycling-regular';

  return {
    value: { start, destinations, profile, roundTrip: body.roundTrip === true },
  };
}
