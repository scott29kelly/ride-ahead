# RideAhead — product brief

A briefing document for brainstorming where this app goes next.

Written to be read by a person or by another coding assistant. It describes
what exists today (accurately — everything here has been run), what it is meant
to become, and the real constraints any idea has to survive.

**Status:** working app, all data sources verified live on 28 July 2026.
**Owner:** Scott. New to coding — explain ideas in plain language, and say what
a term means the first time you use it.

---

## 1. The idea

You are about to go for a bike ride. You know roughly where you might go —
maybe three possible destinations — but you don't know which one is the nicer
ride. A map can tell you which is shortest. It can't tell you which one is
pretty.

RideAhead answers that. You type in where you're starting from and up to three
places you might ride to. For each one it shows you a photo preview of the
actual route — what you'd see along the way — plus the interesting things you'd
pass. Then you pick the one you actually want and go.

The comparison is the point. Not "show me a route", but "show me these three
and help me choose".

## 2. Who uses it and when

A cyclist, at home, before setting off. Probably on a phone or laptop, deciding
where to go today. The mental model to aim at is the moment someone opens Google
Maps, turns on the cycling layer, and stares at it trying to imagine what those
roads are actually like — except here you can see them.

This is a *pre-ride* tool. It is not navigation, and it is not for use while
riding.

---

## 3. What works today

All of this is real and has been run against live services, not just written:

- Type any start and up to three destinations. Addresses, landmark names, or
  raw coordinates all work.
- Pick a bike type: **Everyday**, **Road**, or **Mountain**. Tick **Round trip**
  if you want to come back to where you started.
- Each destination becomes its own route, built at the same time.
- For each route you get:
  - Distance, estimated time, total climbing, steepest gradient
  - A **flythrough**: 24 photos taken along the route, in order, each facing
    the direction you'd be travelling
  - An elevation chart, with a marker that moves as the flythrough plays
  - A list of highlights — interesting places you'd pass, ranked
  - A map showing the route line and where those highlights are
- Every route says which services provided its data, and warns you honestly
  when something was missing or degraded.
- A **demo mode** serves three bundled sample rides around Boulder, Colorado
  with drawn illustrations instead of photos. No accounts or keys needed. It is
  there so the whole product can be seen working before anyone signs up for
  anything.

**Verified:** 105 automated tests pass, the app builds cleanly, and every
external service has been confirmed working with real credentials.

### Where the pictures and data come from

Seven outside services. Each one can fail on its own without taking down the
rest of the page — a missing photo degrades the preview, it doesn't break it.

| What it does | Service | Cost |
|---|---|---|
| Turns "300 Veterans Way" into a location | Nominatim (OpenStreetMap) | Free |
| Works out the cycling route | OpenRouteService | Free tier |
| Backup routing if the above is unavailable | OSRM | Free, car-only |
| Finds interesting places along the way | Overpass (OpenStreetMap) | Free |
| Street-level photos | Mapillary | Free |
| Street-level photos | Google Street View | **Metered** |
| Photos of named landmarks | Wikimedia Commons | Free |

### How a photo gets chosen for each point

This matters, because it is the core of what makes the preview feel real.

1. **Street View is used where it covers the line you're actually riding.** Its
   camera angle is something you request — you ask for "facing 137 degrees" and
   get exactly that. So the photo always looks down the road ahead.
2. **Mapillary is used everywhere else.** If the nearest Street View photo is
   more than 35 metres off the route, that's usually Google's coverage of a
   parallel road rather than the bike path you're on. Real photo, wrong place to
   be standing.
3. **Street View again as a last resort** if Mapillary has nothing. A slightly
   off view beats a blank frame.

Checking costs nothing — Google's "is there a photo here?" lookup is free, and
you only pay for photos actually displayed.

---

## 4. Two decisions that should survive any redesign

These were deliberate. Change them only with a reason.

**Photos are ranked by which way the camera points, not just how close it is.**
A photo taken 40 metres away pointing down the road you're riding is a far
better preview than one taken at your exact position pointing at a hedge.

**Interesting places are found in a corridor that follows the route, not a box
drawn around it.** On any route with a bend, a box pulls in piles of scenery
you'd never actually ride past. The corridor follows the shape of the ride.

---

## 5. Where it falls short of the vision

This is the honest gap, and the most useful section for brainstorming.

### The flythrough is a slideshow, not a ride

24 still photos, each shown for 1.4 seconds, with a hard cut between them. On a
2.4 km ride that's one photo roughly every 100 metres, playing as a 34-second
slideshow.

Nothing sells forward motion. There's no fade between photos and no movement
within them. The owner's words: *"as close as possible to a real photoreal
experience that the user can scroll through or even better would be stitched
together and played."* It is not there yet.

The 24-photo limit was set when Mapillary was the only source and coverage was
thin. Street View changes that — on roads it's nearly continuous, and any
camera angle can be requested at any point. Denser sampling is now possible.

### You can't actually compare the three routes

Today you click route A, watch it, click route B, watch it, and compare from
memory. The three summary cards sit in a sidebar but only one preview plays at
a time.

The owner explicitly wants to *"view all three routes right here in the app."*

### The reasons to pick a route are hidden from the experience

Highlights are ranked and shown — but in a list beside the map, which you read
*instead of* watching the flythrough. The moment you'd ride past a viewpoint,
nothing happens on screen except a small line of text.

The owner wants the app to *"highlight certain features that that route has
that would be reasons to select it."* The information exists. It just isn't
surfaced where it would actually influence the choice.

### Smaller known gaps

- **Nothing is remembered.** Every search re-fetches everything from scratch,
  including all the photos. Searching the same ride twice costs twice.
- **Round trips just retrace the way out.** A real loop needs a different
  approach entirely.
- **Elevation only comes from OpenRouteService.** No key, no climb data.
- **The ranking weights are guesses.** A viewpoint scores 100, a park 45, a
  drinking fountain 10. Reasonable guesses, never tested against what anyone
  actually picks.
- **Three destinations means three simultaneous requests** to the free
  "what's nearby" service, which prefers about two at a time. The third can get
  stuck waiting. Asking one after another would fix it.
- **`public/standalone-demo.html` is a stale hand-written copy** of the app in a
  single file. It no longer matches the real code. Delete it or accept it's out
  of date.

---

## 6. What the owner has said he wants

Quoted directly, because the phrasing matters:

> I want to be able to view all three routes right here in the app and most
> likely the bike rider user would do so prior to a bike ride like they would
> with pulling up a map looking for local bike routes in the Google Maps bike
> ride overlay or something like that. This app will enable the user to get as
> close as possible to a real photoreal experience that the user can scroll
> through or even better would be stitched together and played for the user and
> highlight certain features that that route has that would be reasons to
> select it. etc. etc.

The "etc. etc." is the invitation. This brief exists to help fill it in.

Explicitly **not** the priority: exporting a file to take to a bike computer.
That was suggested and rejected — the experience inside the app is the product.

---

## 7. Constraints any idea has to survive

Ignore these and the idea won't work in practice.

**Google Street View costs money per photo displayed.** Roughly $7 per 1,000,
with a monthly free allowance in the region of 10,000. At today's 24 photos per
route and 3 routes, one search is about 72 photos. Tripling the photo count
triples the bill. Checking whether a photo exists is free; only displaying it
costs.

**The free services have speed limits.** The address lookup allows one request
per second. The "what's nearby" service allows roughly two at a time. Ignore
these and they block you, which is slow and annoying to undo.

**Photo coverage is uneven and always will be.** Mapillary is superb in some
places and absent in others. Street View has roads but never drove the bike
paths, towpaths and rail trails that make a ride good. Any design has to look
acceptable when half the frames have no photo.

**Nothing is cached yet.** Any feature that multiplies requests multiplies cost
and wait time until that changes.

**It has to work on a phone.** Cyclists check this before leaving the house.

---

## 8. Questions worth brainstorming

Not a to-do list — genuinely open.

**About the experience**
- What actually makes someone pick route A over route B? Scenery, climbing,
  traffic, surface, familiarity? The app currently guesses it's scenery.
- Do you need to see the whole ride, or just the parts that differ between the
  options?
- Should scrolling scrub through the ride, or should it play on its own? Both?
- How do you make still photos feel like movement — fading, zooming, panning,
  something else?
- What should happen when there's no photo for a stretch? Skip it, show the map,
  show something drawn?

**About comparison**
- Three side by side, one big with two small, or stacked and scrolled?
- Should they play in sync, so you see all three at the same point in the ride?
- What's the single number or phrase that sums up a route's character?

**About the highlights**
- Should the flythrough slow down or stop when you reach something good?
- Is "marked viewpoint" a good enough reason, or does it need a photo and a
  sentence?
- Should highlights be the *spine* of the preview rather than a side list —
  i.e. show the four best bits rather than the whole ride?

**About scope**
- Is anything missing that a cyclist would obviously want? Traffic levels,
  surface type, bike lanes, weather, time of day, sunset?
- Should routes be saveable or shareable?
- Is three destinations the right number?

---

## 9. How to run it

```bash
git clone https://github.com/scott29kelly/ride-ahead.git
cd ride-ahead
npm install
npm run setup      # creates .env.local from the template
npm run check      # tests every outside service, explains anything broken
npm run dev        # http://localhost:3000
```

Without any accounts set up it runs in demo mode with bundled sample rides, so
the whole product can be explored immediately.

`npm run check` is the diagnostic tool. It checks the settings before the
network, tells the difference between "your key is wrong" and "there are simply
no photos here", and prints exactly what to do about each failure.

### Where things live

```
src/lib/pipeline.ts        the whole flow, start to finish
src/lib/providers/         one file per outside service
src/lib/geo.ts             distance, direction, sampling maths
src/lib/score.ts           how highlights are ranked
src/components/            the screen — the flythrough is PreviewStrip.tsx
src/app/page.tsx           how the screen fits together
```

**Built with:** Next.js 16, React 19, TypeScript, Tailwind CSS v4. Needs Node
20.9 or newer.

---

## 10. A note on how to help

Scott is new to coding. Ideas are welcome at any level of ambition, but:

- Say what things do, not what they're called.
- Explain any technical term the first time it appears.
- When suggesting something, say roughly what it costs — in money, in speed,
  and in how much would need rebuilding.
- Be honest about what you're unsure of. This project has already been bitten
  once by code written confidently against documentation that turned out to be
  wrong, which is exactly why `npm run check` exists.
