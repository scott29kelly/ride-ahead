'use client';

import { useEffect, useRef, useState } from 'react';
import type { Highlight, LngLat } from '@/lib/types';

interface Props {
  geometry: LngLat[];
  highlights?: Highlight[];
  marker?: LngLat;
}

/**
 * Slippy map of the route.
 *
 * MapLibre is imported lazily: it is the heaviest dependency in the app and
 * nothing above the fold needs it. If tiles can't load — offline, or a blocked
 * network — the route line still renders over an empty background rather than
 * the component failing.
 */
export function RouteMap({ geometry, highlights = [], marker }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current || geometry.length < 2) return;
    let cancelled = false;

    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (cancelled || !container.current) return;

        const map = new maplibre.Map({
          container: container.current,
          style: buildStyle(),
          bounds: bounds(geometry),
          fitBoundsOptions: { padding: 40 },
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

        map.on('load', () => {
          map.addSource('route', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geometry } },
          });
          // Casing under the line keeps it legible over busy map tiles.
          map.addLayer({
            id: 'route-casing',
            type: 'line',
            source: 'route',
            paint: { 'line-color': '#12100e', 'line-width': 7, 'line-opacity': 0.6 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            paint: { 'line-color': '#5fa8d3', 'line-width': 4 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });

          for (const highlight of highlights) {
            new maplibre.Marker({ color: '#e0873f' })
              .setLngLat(highlight.poi.coord)
              .setPopup(new maplibre.Popup({ offset: 18 }).setText(highlight.poi.name))
              .addTo(map);
          }
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [geometry, highlights]);

  // Follow the flythrough position without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !marker || !map.isStyleLoaded()) return;

    const data: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: marker },
    };

    const source = map.getSource('position') as import('maplibre-gl').GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }

    map.addSource('position', { type: 'geojson', data });
    map.addLayer({
      id: 'position',
      type: 'circle',
      source: 'position',
      paint: {
        'circle-radius': 7,
        'circle-color': '#e8e0d4',
        'circle-stroke-color': '#12100e',
        'circle-stroke-width': 2,
      },
    });
  }, [marker]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl bg-bark-800 p-4 text-center text-sm text-sand-400/70">
        Map tiles unavailable offline.
      </div>
    );
  }

  return <div ref={container} className="h-full w-full rounded-xl bg-bark-800" />;
}

/**
 * OpenStreetMap raster tiles: no API key, but the tile usage policy rules out
 * heavy traffic. Set NEXT_PUBLIC_MAPTILER_KEY before putting this in front of
 * real users.
 */
function buildStyle(): import('maplibre-gl').StyleSpecification | string {
  const maptiler = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (maptiler) return `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${maptiler}`;

  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#24211d' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.3, 'raster-brightness-max': 0.9 } },
    ],
  };
}

function bounds(geometry: LngLat[]): [number, number, number, number] {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (const [lng, lat] of geometry) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  return [west, south, east, north];
}
