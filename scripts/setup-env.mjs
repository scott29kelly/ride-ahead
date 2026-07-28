#!/usr/bin/env node
/**
 * Create .env.local from the template, on any platform.
 *
 * Exists because the copy command differs between shells and the file is the
 * one manual step between a clone and a live run. Never overwrites: a .env.local
 * that already exists has real keys in it.
 */

import { copyFileSync, existsSync } from 'node:fs';

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m';

if (existsSync('.env.local')) {
  console.log(`${YELLOW}.env.local already exists${OFF} — leaving it alone.`);
  process.exit(0);
}

copyFileSync('.env.example', '.env.local');

console.log(`${GREEN}Created .env.local${OFF} from .env.example.

Next:
  1. Set ${DIM}RIDEAHEAD_DEMO=0${OFF}
  2. Paste your ${DIM}ORS_API_KEY${OFF} (and ${DIM}MAPILLARY_TOKEN${OFF} for real photographs)
  3. Put a real contact address in ${DIM}RIDEAHEAD_USER_AGENT${OFF}
  4. ${DIM}npm run check${OFF}

.env.local is gitignored. Keep every real key in it and nothing in .env.example.`);
