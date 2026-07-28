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

Needs Node 20.9 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

It runs out of the box in **demo mode**: three bundled sample rides around
Boulder, Colorado with generated illustrations instead of photos. No API keys,
no signup, no network. That's there so you can see the whole product working
before deciding which providers to wire up.

### Going live

```bash
npm run setup                  # writes .env.local from the template
                               # then: RIDEAHEAD_DEMO=0, paste ORS_API_KEY,
                               # real contact in RIDEAHEAD_USER_AGENT
npm run check                  # one real request to every provider
npm run dev
```

`npm run check` hits each external API once and reports what came back. Run it
before the app — if something is misconfigured or a provider's response shape
has drifted, this says which one in a couple of seconds rather than surfacing as
an empty preview later. It exits non-zero when a required provider fails, so it
works in CI as well.

It checks the configuration first, because most first-run failures are there
rather than in the network: demo mode still on, a Mapillary Client ID pasted
where the Client Token goes, an ORS key with `Bearer` still attached, the
placeholder email left in the user agent.

Two things it deliberately distinguishes:

- **A rejected credential is a failure. An empty result is not.** A valid
  Mapillary token over an unsurveyed street returns zero images, which is a
  coverage gap, not a setup problem. Reporting those the same way sends you
  looking for a bug in the wrong place.
- **It asserts the exact property paths `src/lib/providers/` reads**, not just
  that the request succeeded — a check that goes green while the app finds
  nothing is worse than no check. Add `--verbose` to print the response shapes
  when something disagrees.

Each request mirrors the one the app makes: same endpoint, same headers, same
requested fields, and the same corridor query shape for Overpass. Change a
provider module and change the check with it.

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

### Choosing between imagery sources

When both are configured, each frame goes to whichever source can actually show
you the road ahead:

1. **Street View, where it covers your line.** Its heading is a request
   parameter, so the camera points exactly down the direction of travel.
   Mapillary can only offer the best angle that happens to exist.
2. **Mapillary, everywhere else.** If the nearest panorama sits more than 35m
   off the route, that is usually Google's coverage of a parallel road rather
   than the path you are on — real imagery, wrong vantage point.
3. **Street View again as a last resort**, if Mapillary has nothing. A
   slightly-off view beats a blank frame.

Deciding costs nothing. The Street View metadata endpoint is free and the
billable request only fires when an image URL is actually loaded, so a
panorama that gets looked up and rejected is never paid for.

`RIDEAHEAD_IMAGERY_PRIORITY=mapillary` pins it to free imagery.

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
npm test        # 88 tests
npm run build
```

Tested offline: the geo math (distance, bearing, sampling, projection,
elevation), the ranking logic, and the full pipeline end to end through demo
mode. The UI was driven in a headless browser — form, flythrough playback,
route switching, elevation marker.

The provider modules are tested against a stubbed HTTP layer, which pins the
things that are easy to get wrong and impossible to see without a key: that ORS
is asked for elevation and warns when it does not supply it, that the Mapillary
token travels as an `OAuth` header rather than in the query string, that a
rejected credential raises instead of looking like an empty result, and that the
Overpass corridor covers the whole route on a long ride.

**Still not verified against live APIs.** This was built in a sandbox with
outbound network access blocked, so no real provider call — ORS, Nominatim,
Overpass, Mapillary, Commons — has ever actually run. Stubs pin the request the
app sends and what it does with the answer; they cannot tell you the real
response looks like the stub. `npm run check` is what closes that gap, and it
has to be run somewhere with network access to those hosts.

---

## Known limits

- **Elevation only comes from OpenRouteService.** Without a key there's no
  elevation profile, no climbing figure, and no gradient.
- **Imagery coverage is uneven.** Mapillary is excellent in some cities and
  absent in others. A preview of a rural route may come back with very few
  frames. With `GOOGLE_MAPS_API_KEY` set, Street View fills most road gaps —
  but it is metered, and it never drove the paths that make a ride good.
- **Nothing is cached.** Every request re-routes and re-fetches. Identical
  requests should be cached by route hash before this faces real traffic.
- **Highlight scoring is hand-tuned**, not learned. The weights in
  [`score.ts`](src/lib/score.ts) encode "what would make me pick this route",
  which is a guess worth revisiting against real usage.
- **Round trips route out and back the same way.** A genuine loop needs a
  different approach than a there-and-back waypoint list.
- **The place corridor gets coarser on very long rides.** The spine is capped at
  300 vertices because each one is repeated in every clause of the Overpass
  query. Past roughly 50 km the spacing widens to keep covering the whole route,
  so the corridor bulges slightly on tight bends. Covering all of a long ride
  approximately beats covering the first half of it exactly.

## Where this is going

[`PRODUCT-BRIEF.md`](PRODUCT-BRIEF.md) describes what the app is meant to become
— the gap between the current preview and a genuinely photoreal one, the
constraints any answer has to survive, and the questions still open. Start there
if you are picking this up to work on the experience rather than the plumbing.

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

---

## Standalone demo

[`public/standalone-demo.html`](public/standalone-demo.html) is the whole demo
pipeline — geo maths, scoring, flythrough, generated imagery — ported into a
single self-contained HTML file. No build step, no server, no network. Open it
in any browser, including on a phone.

It exists so the concept can be shown to someone without asking them to install
anything. It shares no code with `src/`, so treat it as a demo that has to be
kept in step by hand rather than a second entry point to the app.
