#!/usr/bin/env node
/**
 * Provider smoke test.
 *
 * Hits every external API the app depends on with one small real request and
 * reports what came back. The app was written against these providers' docs
 * but built somewhere with no outbound network, so this is the fastest way to
 * find out which one actually disagrees with the code.
 *
 *   node scripts/check-providers.mjs            # pass/fail per provider
 *   node scripts/check-providers.mjs --verbose  # + the response shapes
 *
 * PARITY: every request below deliberately mirrors the one src/lib/providers/
 * makes — same endpoint, same headers, same fields — and asserts the exact
 * property paths that code reads. A check that passes while the app fails is
 * worse than no check, so when you change a provider module, change this too.
 *
 * Reads .env.local if present. Exits non-zero if a required provider fails,
 * so it works in CI too.
 */

import { readFileSync, existsSync } from 'node:fs';

/* Minimal .env.local reader — avoids a dependency for one file. */
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  }
}

const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const UA = process.env.RIDEAHEAD_USER_AGENT ?? 'RideAhead/0.1 (provider check)';

/* Boulder Public Library -> Chautauqua Park, the same ride as demo mode. */
const START = [-105.2797, 40.015];
const END = [-105.2811, 39.9994];

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

const results = [];
const notes = [];

/**
 * Thrown when a provider answered fine but the account or key is the problem.
 * Worth separating: "your token is wrong" and "there are no photos of this
 * street" both surface as no imagery, and only one of them is fixable.
 */
class ConfigError extends Error {
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}

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
    if (error.fix) console.log(`  ${DIM}↳ ${error.fix}${OFF}`);
    results.push({ name, status: 'fail', required, error });
  }
}

/** Report something true but not pass/fail, e.g. a shape we want to know about. */
function note(text) {
  notes.push(text);
}

function shape(label, value) {
  if (!VERBOSE) return;
  console.log(`  ${DIM}${label}: ${JSON.stringify(value)?.slice(0, 400)}${OFF}`);
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...options.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function json(url, options = {}) {
  const response = await request(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  return response.json();
}

/* ------------------------------------------------------------------ */
/*  Pre-flight: the mistakes that cost an evening before a single      */
/*  request goes out.                                                  */
/* ------------------------------------------------------------------ */

console.log(`\n${BOLD}Configuration${OFF}\n`);

const configProblems = [];

if (!existsSync('.env.local')) {
  configProblems.push([
    'No .env.local',
    'cp .env.example .env.local   (PowerShell: copy .env.example .env.local)',
  ]);
}

if (process.env.RIDEAHEAD_DEMO !== '0') {
  configProblems.push([
    `RIDEAHEAD_DEMO is ${process.env.RIDEAHEAD_DEMO ?? 'unset'} — the app still serves bundled sample rides`,
    'Set RIDEAHEAD_DEMO=0 in .env.local to go live. The checks below run either way.',
  ]);
}

if (/you@example\.com/.test(UA)) {
  configProblems.push([
    'RIDEAHEAD_USER_AGENT still has the placeholder email',
    'Nominatim and Overpass both ask for real contact details, and block traffic that does not identify itself.',
  ]);
}

const orsKey = process.env.ORS_API_KEY;
if (orsKey && /^Bearer\s/i.test(orsKey)) {
  configProblems.push(['ORS_API_KEY starts with "Bearer "', 'Paste the raw key — ORS wants it bare in the Authorization header.']);
}
if (orsKey && /\s/.test(orsKey.trim())) {
  configProblems.push(['ORS_API_KEY contains whitespace', 'Likely a wrapped copy-paste. It should be one unbroken token.']);
}

const mapillaryToken = process.env.MAPILLARY_TOKEN;
if (mapillaryToken && !mapillaryToken.startsWith('MLY|')) {
  configProblems.push([
    'MAPILLARY_TOKEN does not start with "MLY|"',
    'That is probably the Client ID or Client Secret. You want the "Client Token" on the same page.',
  ]);
}

if (configProblems.length === 0) {
  console.log(`${GREEN}✓${OFF} nothing obviously wrong`);
} else {
  for (const [problem, fix] of configProblems) {
    console.log(`${YELLOW}!${OFF} ${problem}`);
    console.log(`  ${DIM}↳ ${fix}${OFF}`);
  }
}

console.log(`\n${BOLD}Providers${OFF}\n`);

/* ------------------------------------------------------------------ */

await check('Nominatim', {
  required: true,
  run: async () => {
    const body = await json(
      'https://nominatim.openstreetmap.org/search?q=Chautauqua+Park+Boulder&format=jsonv2&limit=1&addressdetails=0',
    );
    const hit = body[0];
    if (!hit?.lat) throw new Error('no results — response shape may have changed');
    // geocode.ts reads lat, lon, display_name and name.
    if (!hit.display_name) throw new Error('result has no display_name — geocode.ts uses it as the label');
    shape('first result keys', Object.keys(hit));
    if (!hit.name) note('Nominatim: no `name` on the result; geocode.ts falls back to the raw query, which is fine.');
    return `geocoded to ${Number(hit.lat).toFixed(4)}, ${Number(hit.lon).toFixed(4)}`;
  },
});

await check('OpenRouteService', {
  required: true,
  skipIf: !orsKey,
  skipReason: 'no ORS_API_KEY — routing will fall back to OSRM (car profile)',
  run: async () => {
    const response = await request('https://api.openrouteservice.org/v2/directions/cycling-regular/geojson', {
      method: 'POST',
      headers: {
        Authorization: orsKey,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({ coordinates: [START, END], elevation: true, instructions: false }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new ConfigError(
        `HTTP ${response.status} — key rejected`,
        'A brand new ORS key takes a few minutes to activate. If it is older than that, re-copy it from account.heigit.org/manage/key.',
      );
    }
    if (response.status === 429) {
      throw new ConfigError('HTTP 429 — rate limited', 'The free tier allows 40 requests/minute. Wait a minute and retry.');
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }

    const body = await response.json();
    const feature = body.features?.[0];
    if (!feature) throw new Error('200 OK but no features[0] — response shape has changed');

    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) throw new Error('no geometry.coordinates in the route');

    const properties = feature.properties ?? {};
    shape('properties keys', Object.keys(properties));
    shape('summary', properties.summary);
    shape('first coordinate', coords[0]);

    const hasElevation = coords[0]?.length === 3;
    if (!hasElevation) {
      throw new ConfigError(
        'routed, but the geometry is 2D — no elevation',
        'elevation:true was sent and ignored. Without it there is no climb profile, gradient or ascent anywhere in the app.',
      );
    }

    const km = (properties.summary?.distance ?? 0) / 1000;
    if (!properties.summary?.distance) {
      note('OpenRouteService: no properties.summary.distance; routing.ts falls back to the summed geometry length.');
    }

    // routing.ts reads properties.ascent first, then properties.summary.ascent.
    // Tell us which one this deployment actually populates.
    const where =
      properties.ascent !== undefined
        ? 'properties.ascent'
        : properties.summary?.ascent !== undefined
          ? 'properties.summary.ascent'
          : null;

    if (where) {
      note(`OpenRouteService: ascent/descent arrive at ${where}.`);
    } else {
      note('OpenRouteService: no ascent/descent field anywhere; the app recomputes climb from the elevation series instead.');
    }

    return `${km.toFixed(2)} km, ${coords.length} points, ${GREEN}elevation present${OFF}`;
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
    // Mirrors buildCorridorQuery() in src/lib/providers/pois.ts: a multi-point
    // corridor spine, clauses grouped by OSM key, `out tags center qt`. A
    // two-point toy query would not exercise what the app actually sends.
    const spine = [
      [40.0150, -105.2797],
      [40.0110, -105.2800],
      [40.0070, -105.2805],
      [40.0030, -105.2808],
      [39.9994, -105.2811],
    ]
      .map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`)
      .join(',');
    const around = `(around:180,${spine})`;

    const query =
      `[out:json][timeout:50];\n(\n` +
      `  nwr${around}["tourism"~"^(viewpoint|artwork|attraction|museum|picnic_site)$"];\n` +
      `  nwr${around}["natural"~"^(peak|cave_entrance|arch|cliff|glacier|waterfall|spring|beach|hot_spring)$"];\n` +
      `  nwr${around}["historic"];\n` +
      `  nwr${around}["leisure"~"^(park|nature_reserve|garden)$"];\n` +
      `  nwr${around}["amenity"~"^(cafe|restaurant|pub|ice_cream|drinking_water|toilets|bicycle_repair_station)$"];\n` +
      `);\nout tags center qt;`;

    const body = await json('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString(),
    });

    const elements = body.elements ?? [];
    const named = elements.filter((element) => element.tags?.name);
    // pois.ts needs a position on every element: lat/lon for nodes, center for
    // ways and relations. `out center` is what supplies the latter.
    const positioned = elements.filter(
      (element) => (element.lat ?? element.center?.lat) !== undefined,
    );
    shape('first element', elements[0]);

    if (elements.length > 0 && positioned.length === 0) {
      throw new Error('elements returned but none had lat/lon or center — `out center` is not being honoured');
    }
    if (elements.length === 0) {
      throw new Error('corridor query returned nothing — the query syntax may have been rejected');
    }

    return `${elements.length} elements, ${named.length} named, ${positioned.length} positioned`;
  },
});

await check('Mapillary', {
  skipIf: !mapillaryToken,
  skipReason: 'no MAPILLARY_TOKEN — the flythrough will have no street-level photos',
  run: async () => {
    const params = new URLSearchParams({
      bbox: '-105.2830,40.0140,-105.2790,40.0160',
      fields: 'id,thumb_1024_url,thumb_2048_url,computed_geometry,geometry,captured_at,compass_angle',
      limit: '25',
    });

    // Header auth, "OAuth" scheme — the form imagery.ts uses and the form
    // Mapillary documents. Bearer is silently rejected.
    const response = await request(`https://graph.mapillary.com/images?${params}`, {
      headers: { Authorization: `OAuth ${mapillaryToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => '');
      throw new ConfigError(
        `HTTP ${response.status} — token rejected`,
        'Check you copied the Client Token (starts with MLY|) and that the app has the READ scope. ' +
          `Response: ${body.slice(0, 160)}`,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }

    const body = await response.json();
    const images = body.data ?? [];
    shape('first image', images[0]);

    // The token is good from here on: an empty result is a coverage gap, not a
    // configuration failure, so it must not be reported as one.
    if (images.length === 0) {
      note(
        'Mapillary: token accepted, but no imagery in the Boulder test bbox. That is a coverage gap, not a ' +
          'setup problem — try a route somewhere you know has been surveyed.',
      );
      return `${GREEN}token accepted${OFF}${DIM}, no imagery in the test bbox${OFF}`;
    }

    const withThumb = images.filter((image) => image.thumb_1024_url).length;
    const withAngle = images.filter((image) => image.compass_angle !== undefined).length;
    const withGeometry = images.filter(
      (image) => image.computed_geometry?.coordinates ?? image.geometry?.coordinates,
    ).length;

    if (withThumb === 0) {
      throw new Error('images returned but none had thumb_1024_url — imagery.ts skips every one of them');
    }
    if (withAngle === 0) {
      // Not fatal, but it is the whole ranking signal.
      note(
        'Mapillary: no compass_angle on any image, so the direction-of-travel ranking degrades to ' +
          'nearest-photo-wins. Check the field is still spelled that way.',
      );
    }

    return `${images.length} images, ${withThumb} with thumbnails, ${withAngle} with compass angle, ${withGeometry} located`;
  },
});

await check('Wikimedia Commons', {
  run: async () => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      generator: 'geosearch', ggscoord: '39.9994|-105.2811', ggsradius: '1000',
      ggslimit: '8', ggsnamespace: '6',
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1024',
    });
    const body = await json(`https://commons.wikimedia.org/w/api.php?${params}`);

    const pages = body.query?.pages ?? [];
    if (!Array.isArray(pages)) {
      note('Wikimedia: `pages` came back keyed by pageid rather than as an array, despite formatversion=2.');
    }
    const list = Array.isArray(pages) ? pages : Object.values(pages);
    shape('first page', list[0]);

    if (list.length === 0) throw new Error('no nearby images — geosearch may have changed');

    // imagery.ts needs thumburl (from iiurlwidth) to render anything at all.
    const withUrl = list.filter((page) => page.imageinfo?.[0]?.thumburl).length;
    if (withUrl === 0) {
      throw new Error('nearby files found, but none had imageinfo[0].thumburl — iiurlwidth is being ignored');
    }

    const withLicence = list.filter(
      (page) => page.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value,
    ).length;
    if (withLicence === 0) {
      note('Wikimedia: no LicenseShortName in extmetadata; attribution will fall back to "see source".');
    }

    return `${list.length} nearby files, ${withUrl} with thumbnails`;
  },
});

await check('Street View', {
  skipIf: !process.env.GOOGLE_MAPS_API_KEY,
  skipReason: 'no GOOGLE_MAPS_API_KEY — optional, and billed per image',
  run: async () => {
    const body = await json(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=40.0150,-105.2797&radius=60&source=outdoor&key=${process.env.GOOGLE_MAPS_API_KEY}`,
    );
    shape('metadata', body);

    if (body.status === 'REQUEST_DENIED') {
      throw new ConfigError(
        'REQUEST_DENIED',
        `Enable the Street View Static API on the project and check any key restrictions. ${body.error_message ?? ''}`.trim(),
      );
    }
    if (body.status === 'OVER_QUERY_LIMIT') {
      throw new ConfigError('OVER_QUERY_LIMIT', 'Billing is not enabled, or the quota is exhausted.');
    }
    if (body.status === 'ZERO_RESULTS' || body.status === 'NOT_FOUND') {
      note('Street View: no coverage at the Boulder test point. Key looks usable; this is a coverage gap.');
      return `${GREEN}key accepted${OFF}${DIM}, no coverage at the test point${OFF}`;
    }
    if (body.status !== 'OK') throw new Error(`metadata status ${body.status}`);

    return `coverage found${body.date ? `, imagery from ${body.date}` : ''}`;
  },
});

/* ---- Summary ---- */

const failed = results.filter((r) => r.status === 'fail');
const requiredFailed = failed.filter((r) => r.required);
const skipped = results.filter((r) => r.status === 'skip');

if (notes.length > 0) {
  console.log(`\n${BOLD}Notes${OFF}\n`);
  for (const text of notes) console.log(`  ${DIM}·${OFF} ${text}`);
}

console.log('');

if (failed.length === 0) {
  console.log(`${GREEN}Everything reachable.${OFF} ${skipped.length ? `${skipped.length} skipped for missing keys.` : ''}`);
} else {
  console.log(`${RED}${failed.length} provider${failed.length > 1 ? 's' : ''} failed.${OFF}`);
  for (const result of failed) {
    console.log(`  ${DIM}${result.name}: ${result.error.message}${OFF}`);
  }
  if (!VERBOSE) {
    console.log(`\n${DIM}Re-run with --verbose to print the response shapes.${OFF}`);
  }
}

if (!orsKey) {
  console.log(
    `\n${YELLOW}No ORS_API_KEY.${OFF} That is the one key worth getting — it is what gives you\n` +
    `real cycling routes and elevation. Free, no card: https://openrouteservice.org/dev/#/signup`,
  );
}

console.log('');
process.exit(requiredFailed.length > 0 ? 1 : 0);
