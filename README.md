# RideAhead

**See the ride before you ride it.**

Enter where you're starting and up to three places you might ride to. RideAhead
routes each option, finds what's worth seeing along the way, pulls street-level
photography for points along the route, and gives you a scrubbable flythrough of
each ride — so you can pick the one you actually want before clipping in.

Built for bikes first. The same pipeline works for walking and hiking by
changing the routing profile.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

It runs out of the box in **demo mode**: three bundled sample rides around
Boulder, Colorado with generated illustrations instead of photos. No API keys,
no signup, no network. That's there so you can see the whole product working
before deciding which providers to wire up.

To go live, copy `.env.example` to `.env.local`, add an OpenRouteService key,
and set `RIDEAHEAD_DEMO=0`.

---

## How it works

The pipeline lives in [`src/lib/pipeline.ts`](src/lib/pipeline.ts):

1. **Geocode** the start and each destination (Nominatim).
2. **Route** each destination on a real cycling profile, with elevation
   (OpenRouteService).
3. **Sample** ~24 evenly spaced points along each route, interpolating between
   the router's vertices so frames land at exact distances.
4. **Find places** in a *corridor* around the route line — not its bounding box
   — via a single Overpass query, then project each one onto the route to get
   how far along it is and how far off it sits.
5. **Fetch imagery** for each sample point, preferring photos that *face the
   direction of travel*.
6. **Score and spread** the candidates into a highlight list.
7. **Summarise** the route into distance, climbing, and a few plain-language
   vibes like `Waterside` or `Big climbing`.

### Two decisions worth calling out

**Photos are chosen by facing, not just proximity.** A preview should show what
you'd see looking forward. A photo taken 40 m away pointing down the road you're
riding is a better preview than one taken at your exact position pointing at a
hedge, so candidates are ranked on the angle between the camera and your
direction of travel first, distance second
([`imagery.ts`](src/lib/providers/imagery.ts)).

**Places are found along a corridor, not a bounding box.** On any route with a
bend, a bounding-box query returns a huge amount of scenery you'll never ride
past. Overpass is queried with `around:` on a decimated route spine instead, so
what comes back is genuinely near the line
([`pois.ts`](src/lib/providers/pois.ts)).

---

## Providers

| Role | Provider | Key needed | Notes |
| --- | --- | --- | --- |
| Routing | [OpenRouteService](https://openrouteservice.org/dev/#/signup) | Free key | Real cycling profiles + elevation. **The one key worth getting.** |
| Routing fallback | OSRM demo server | None | Car profile only — shape is right, road choice isn't. Warns in the UI. |
| Geocoding | Nominatim | None | Max 1 req/sec; the app geocodes serially to respect this. |
| Places | Overpass / OpenStreetMap | None | Free, no signup. |
| Street imagery | [Mapillary](https://www.mapillary.com/dashboard/developers) | Free token | Covers bike paths and trails Street View never drove. |
| Landmark photos | Wikimedia Commons | None | Good for named landmarks, weak for roadside views. |
| Street imagery | Google Street View | Paid key | Best quality where it exists. Metadata endpoint gates every billable call. |
| Map tiles | OpenStreetMap raster | None | Set `NEXT_PUBLIC_MAPTILER_KEY` before any real traffic — the OSM tile policy rules out heavy use. |

Every provider is optional except routing. Imagery and place lookups fail into
warnings rather than errors, so a dead API degrades the preview instead of
breaking it.

---

## What's verified, and what isn't

```bash
npm test        # 46 tests
npm run build
```

Tested offline: the geo math (distance, bearing, sampling, projection,
elevation), the ranking logic, and the full pipeline end to end through demo
mode. The UI was driven in a headless browser — form, flythrough playback,
route switching, elevation marker.

**Not yet verified against live APIs.** This was built in a sandbox with
outbound network access blocked, so every real provider call — ORS, Nominatim,
Overpass, Mapillary, Commons — is written to spec but has never actually run.
Expect to shake out schema mismatches on first real use. That's the first thing
to do with a key in hand.

---

## Known limits

- **Elevation only comes from OpenRouteService.** Without a key there's no
  elevation profile, no climbing figure, and no gradient.
- **Imagery coverage is uneven.** Mapillary is excellent in some cities and
  absent in others. A preview of a rural route may come back with very few
  frames.
- **Nothing is cached.** Every request re-routes and re-fetches. Identical
  requests should be cached by route hash before this faces real traffic.
- **Highlight scoring is hand-tuned**, not learned. The weights in
  [`score.ts`](src/lib/score.ts) encode "what would make me pick this route",
  which is a guess worth revisiting against real usage.
- **Round trips route out and back the same way.** A genuine loop needs a
  different approach than a there-and-back waypoint list.

## Natural next steps

- GPX export, so a chosen route goes straight to a bike computer.
- Cache previews by route hash — the same ride shouldn't re-fetch every photo.
- Surface trail surface and traffic from OSM way tags (`surface`, `highway`),
  which matters more to most riders than scenery.
- Let people drag a waypoint to reshape a route and re-preview it.
- Daylight and weather at the estimated time you'd reach each point.

---

## Project layout

```
src/
  app/
    page.tsx              UI shell and state
    api/preview/route.ts  POST endpoint: validates, delegates to the pipeline
  lib/
    pipeline.ts           Orchestration — live and demo paths
    geo.ts                Distance, bearing, sampling, projection, elevation
    score.ts              Highlight ranking and route summaries
    providers/            One module per external API, each independently failable
    demo/                 Bundled fixtures + generated placeholder imagery
  components/             Form, cards, flythrough, elevation chart, maps
```

## Licence and attribution

The code here is yours to license as you like. The data isn't: OpenStreetMap and
Overpass results are ODbL, Mapillary imagery is CC BY-SA, and Commons photos
carry per-file licences. The app surfaces attribution on every image it shows —
keep it there.
