import type { Image, PoiCategory } from '../types';

/**
 * Demo-mode imagery.
 *
 * Generates a synthetic landscape as an SVG data URI so demo mode is visual
 * without shipping binary assets or calling a photo API. These are deliberately
 * stylised rather than photo-like — a fake photo of a real place would be
 * worse than an obvious illustration, so every one is labelled as generated.
 */

const PALETTES: Record<PoiCategory | 'route', [string, string, string]> = {
  viewpoint: ['#f9a03f', '#d45f2c', '#4a3b52'],
  nature: ['#5b8c5a', '#3a6b45', '#2b4034'],
  water: ['#5fb4d8', '#2e7fa8', '#1d4e63'],
  historic: ['#c9a227', '#8a6d1f', '#463a1c'],
  landmark: ['#a97fd0', '#6d4c8f', '#33254a'],
  park: ['#8bc34a', '#4f8a33', '#2f4a22'],
  art: ['#ef6f8e', '#b03a63', '#4d2035'],
  refuel: ['#e8a05c', '#a86a34', '#4a3123'],
  services: ['#9aa6b2', '#5f6b78', '#31383f'],
  route: ['#7fb2e5', '#4a7fb5', '#2c4a63'],
};

/** Deterministic hash so the same spot always renders the same illustration. */
function hash(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

function makeRandom(seed: string) {
  let state = hash(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Ridge line across the frame, used for both hills and the horizon. */
function ridge(random: () => number, baseline: number, amplitude: number, width: number): string {
  const steps = 8;
  const points: string[] = [`0,${baseline}`];

  for (let i = 0; i <= steps; i++) {
    const x = (width * i) / steps;
    const y = baseline - random() * amplitude;
    points.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }

  points.push(`${width},400`, '0,400');
  return points.join(' ');
}

export function placeholderImage(
  seed: string,
  label: string,
  category: PoiCategory | 'route' = 'route',
): Image {
  const random = makeRandom(seed);
  const [sky, mid, near] = PALETTES[category];
  const width = 640;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="400" viewBox="0 0 ${width} 400">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${sky}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${mid}" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="400" fill="url(#sky)"/>
  <circle cx="${(random() * width).toFixed(0)}" cy="${(40 + random() * 60).toFixed(0)}" r="26" fill="#fff" opacity="0.35"/>
  <polygon points="${ridge(random, 250, 90, width)}" fill="${mid}" opacity="0.75"/>
  <polygon points="${ridge(random, 310, 60, width)}" fill="${near}" opacity="0.85"/>
  <rect y="340" width="${width}" height="60" fill="${near}"/>
  <path d="M0,400 L${(width * 0.42).toFixed(0)},336 L${(width * 0.58).toFixed(0)},336 L${width},400 Z" fill="#2a2a2e" opacity="0.55"/>
  <!-- Caption sits top-left and the watermark bottom-right, because the viewer
       overlays its own distance readout along the bottom-left edge and an
       attribution chip in the top-right corner. -->
  <text x="20" y="34" font-family="system-ui, sans-serif" font-size="17" fill="#fff" opacity="0.92">${escapeXml(
    label,
  )}</text>
  <text x="${width - 16}" y="${390}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" fill="#fff" opacity="0.55">DEMO — generated illustration</text>
</svg>`;

  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    source: 'demo',
    attribution: 'Generated placeholder (demo mode — not a real photo)',
  };
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}
