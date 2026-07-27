#!/usr/bin/env node
/**
 * Provider smoke test.
 *
 * Hits every external API the app depends on with one small real request and
 * reports what came back. The app was written against these providers' docs
 * but built somewhere with no outbound network, so this is the fastest way to
 * find out which one actually disagrees with the code.
 *
 *   node scripts/check-providers.mjs
 *
 * Reads .env.local if present. Exits non-zero if a configured provider fails,
 * so it works in CI too.
 */

import { readFileSync, existsSync } from 'node:fs';

/* Minimal .env.local reader — avoids a dependency for one file. */
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  }
}

const UA = process.env.RIDEAHEAD_USER_AGENT ?? 'RideAhead/0.1 (provider check)';

/* Boulder Public Library -> Chautauqua Park, the same ride as demo mode. */
const START = [-105.2797, 40.015];
const END = [-105.2811, 39.9994];

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m';

const results = [];

async function check(name, { required = false, skipIf = false, skipReason = '', run }) {
  if (skipIf) {
    console.log(`${YELLOW}○${OFF} ${name.padEnd(22)} ${DIM}skipped — ${skipReason}${OFF}`);
    results.push({ name, status: 'skip', required });
    return;
  }

  const started = Date.now();
  try {
    const detail = await run();
    const ms = Date.now() - started;
    console.log(`${GREEN}✓${OFF} ${name.padEnd(22)} ${detail} ${DIM}(${ms}ms)${OFF}`);
    results.push({ name, status: 'ok', required });
  } catch (error) {
    const ms = Date.now() - started;
    console.log(`${RED}✗${OFF} ${name.padEnd(22)} ${error.message} ${DIM}(${ms}ms)${OFF}`);
    results.push({ name, status: 'fail', required, error });
  }
}

async function json(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...options.headers },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 160)}` : ''}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n${DIM}Checking every provider RideAhead talks to…${OFF}\n`);

await check('Nominatim', {
  required: true,
  run: async () => {
    const body = await json(
      'https://nominatim.openstreetmap.org/search?q=Chautauqua+Park+Boulder&format=jsonv2&limit=1',
    );
    if (!body[0]?.lat) throw new Error('no results — response shape may have changed');
    return `geocoded to ${Number(body[0].lat).toFixed(4)}, ${Number(body[0].lon).toFixed(4)}`;
  },
});

await check('OpenRouteService', {
  required: true,
  skipIf: !process.env.ORS_API_KEY,
  skipReason: 'no ORS_API_KEY — routing will fall back to OSRM (car profile)',
  run: async () => {
    const body = await json('https://api.openrouteservice.org/v2/directions/cycling-regular/geojson', {
      method: 'POST',
      headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [START, END], elevation: true, instructions: false }),
    });

    const feature = body.features?.[0];
    if (!feature) throw new Error('no route returned');

    const coords = feature.geometry.coordinates;
    const hasElevation = coords[0]?.length === 3;
    const km = (feature.properties.summary?.distance ?? 0) / 1000;

    if (!hasElevation) throw new Error('routed, but no elevation in the geometry');
    return `${km.toFixed(2)} km, ${coords.length} points, elevation present`;
  },
});

await check('OSRM fallback', {
  run: async () => {
    const path = `${START[0]},${START[1]};${END[0]},${END[1]}`;
    const body = await json(
      `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`,
    );
    if (!body.routes?.[0]) throw new Error(`no route (${body.code})`);
    return `${(body.routes[0].distance / 1000).toFixed(2)} km ${DIM}(car profile)${OFF}`;
  },
});

await check('Overpass', {
  required: true,
  run: async () => {
    const query = `[out:json][timeout:40];(nwr(around:200,40.0150,-105.2797,39.9994,-105.2811)["tourism"~"^(viewpoint|artwork|attraction)$"];nwr(around:200,40.0150,-105.2797,39.9994,-105.2811)["leisure"="park"];);out center tags qt;`;
    const body = await json('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString(),
    });

    const named = (body.elements ?? []).filter((element) => element.tags?.name);
    return `${body.elements?.length ?? 0} elements, ${named.length} named`;
  },
});

await check('Mapillary', {
  skipIf: !process.env.MAPILLARY_TOKEN,
  skipReason: 'no MAPILLARY_TOKEN — the flythrough will have no street-level photos',
  run: async () => {
    const params = new URLSearchParams({
      access_token: process.env.MAPILLARY_TOKEN,
      bbox: '-105.2830,40.0140,-105.2790,40.0160',
      fields: 'id,thumb_1024_url,computed_geometry,captured_at,compass_angle',
      limit: '5',
    });
    const body = await json(`https://graph.mapillary.com/images?${params}`);

    const images = body.data ?? [];
    if (images.length === 0) throw new Error('authenticated, but no imagery in the test bbox');

    const withThumb = images.filter((image) => image.thumb_1024_url).length;
    const withAngle = images.filter((image) => image.compass_angle !== undefined).length;
    if (withThumb === 0) throw new Error('images returned but none had thumb_1024_url');

    return `${images.length} images, ${withThumb} with thumbnails, ${withAngle} with compass angle`;
  },
});

await check('Wikimedia Commons', {
  run: async () => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      generator: 'geosearch', ggscoord: '39.9994|-105.2811', ggsradius: '1000',
      ggslimit: '5', ggsnamespace: '6',
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1024',
    });
    const body = await json(`https://commons.wikimedia.org/w/api.php?${params}`);

    const pages = body.query?.pages ?? [];
    const withUrl = pages.filter((page) => page.imageinfo?.[0]?.thumburl).length;
    if (pages.length === 0) throw new Error('no nearby images — geosearch may have changed');

    return `${pages.length} nearby files, ${withUrl} with thumbnails`;
  },
});

await check('Street View', {
  skipIf: !process.env.GOOGLE_MAPS_API_KEY,
  skipReason: 'no GOOGLE_MAPS_API_KEY — optional, and billed per image',
  run: async () => {
    const body = await json(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=40.0150,-105.2797&radius=60&source=outdoor&key=${process.env.GOOGLE_MAPS_API_KEY}`,
    );
    if (body.status !== 'OK') throw new Error(`metadata status ${body.status}`);
    return `coverage found${body.date ? `, imagery from ${body.date}` : ''}`;
  },
});

/* ---- Summary ---- */

const failed = results.filter((r) => r.status === 'fail');
const requiredFailed = failed.filter((r) => r.required);
const skipped = results.filter((r) => r.status === 'skip');

console.log('');

if (failed.length === 0) {
  console.log(`${GREEN}Everything reachable.${OFF} ${skipped.length ? `${skipped.length} skipped for missing keys.` : ''}`);
} else {
  console.log(`${RED}${failed.length} provider${failed.length > 1 ? 's' : ''} failed.${OFF}`);
  for (const result of failed) {
    console.log(`  ${DIM}${result.name}: ${result.error.message}${OFF}`);
  }
}

if (!process.env.ORS_API_KEY) {
  console.log(
    `\n${YELLOW}No ORS_API_KEY.${OFF} That is the one key worth getting — it is what gives you\n` +
    `real cycling routes and elevation. Free, no card: https://openrouteservice.org/dev/#/signup`,
  );
}

console.log('');
process.exit(requiredFailed.length > 0 ? 1 : 0);
