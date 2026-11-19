# Observability Explorer

An Angular web app that answers: **when can each observatory observe my target?**
It speaks the IVOA [Object Observability Simple Access Protocol (ObjObsSAP)](https://github.com/ivoa-std/ObjObsSAP).

1. **Target and constraints:** type a name (resolved with CDS Sesame) or coordinates,
   pick a UTC time window, and optionally set `MIN_OBS` (shortest useful window) and `FACILITY`.
2. **Sky view:** Aladin Lite centred on the target. Surveys (HiPS) are grouped by regime
   (Gamma-ray, X-ray, UV, Optical, Infrared, Radio/mm). Each regime has a curated list,
   and "More … surveys from CDS" loads every matching HiPS from the CDS MocServer.
3. **Timelines:** one row per ObjObsSAP service (one per facility when a service returns a
   `facility` column), plus a **Simultaneous** row that intersects the rows you tick.
   Drag to zoom, Ctrl/⌘ + wheel to zoom, Shift + wheel to pan, hover for times, click a window
   to see every column of the row. A shaded band marks a service's `T_MAX_HARD_LIMIT`, and
   the results export to CSV.

Every query is written into the page URL (`?target=M1&ra=…&dec=…&start=…&end=…`), so a link
reopens and re-runs it.

## Run it

```bash
npm install
npm start            # http://localhost:4200, with the /proxy endpoint
npm test             # unit tests (Vitest)
```

Production:

```bash
npm run build
npm run serve:prod   # http://localhost:8080 — static app + /proxy, no extra dependencies
```

or with Docker:

```bash
docker build -t objobssap-explorer .
docker run -p 8080:8080 objobssap-explorer
```

## Why a proxy?

ObjObsSAP services don't send CORS headers (Swift, Gaia, and the reference implementation all
lack them), so a browser can't read their answers directly. The app sends those requests to
`proxy?url=<encoded service URL>` on its own origin. Sesame and the MocServer allow CORS and are
called directly.

The proxy (`server/proxy-core.mjs`, used by both `ng serve` and `server/server.mjs`) only
forwards `GET` requests, and only to:

- the hosts of the services in `services.json` (re-read on each request), and
- the hosts listed in `PROXY_ALLOW_HOSTS` (comma separated).

`PROXY_ALLOW_ANY=1` lets users' own services through to any public host; private and
link-local addresses are always refused. Other settings: `PORT` (8080), `HOST`, `STATIC_DIR`,
`PROXY_TIMEOUT_MS` (60000).

To host the build on a static server instead (nginx, S3…), provide the same
`/proxy?url=` endpoint there, or set `proxyPrefix` to `""` and use only services that allow CORS.

## Configure a deployment (no rebuild needed)

Both files sit next to `index.html` in the build output (`public/` in the source):

**`services.json`**: the default observatories.

```json
{ "services": [ {
  "id": "swift", "name": "Swift", "url": "https://www.swift.psu.edu/vo/objobssap/query",
  "regime": "X-ray / UV", "kind": "space",
  "paramStyle": "objobssap",
  "useProxy": true, "enabled": true, "notes": "shown in the Services panel"
} ] }
```

`paramStyle` is `objobssap` (`POS`, `TIME`, `MIN_OBS`, `FACILITY`, `MAXREC`) or `objvissap`
for services that still use the pre-1.0 draft names (`s_ra`, `s_dec`, `t_min`, `t_max`,
`min_vis`), such as Gaia's GOST.

Users can also add services and switch defaults on or off in the **Services** panel; those
choices stay in their browser (localStorage).

**`config.json`**: `proxyPrefix`, `sesameUrl`, `mocServerUrl`, `defaultHips`, `defaultSpanDays`.

## Known services (November 2026)

| Service | State |
|---|---|
| Swift (`swift.psu.edu`) | compliant, on by default |
| Example Observatory (`vo-labs.dev`) | reference implementation with synthetic windows, on by default |
| Gaia GOST | answers with ObjVisSAP parameters; its ephemeris ends 2025-07-01, so only past dates work |
| XMM-Newton, Chandra, NOT (INTEREST gateway) | listed on the IVOA wiki, not answering; off by default |

No ObjObsSAP service is registered in the IVOA Registry yet. Once services carry the standard
ID `ivo://ivoa.net/std/ObjObsSAP#query-*`, a RegTAP lookup could replace the static list.

## Code map

```
src/app/core/
  votable.ts                 VOTable → windows (columns found by name; t_visibility accepted)
  objobssap.service.ts       query URL building (both parameter styles), VOSI availability
  observability-store.ts     runs all enabled services in parallel, retry per service
  sesame.service.ts          name resolution
  hips-catalog.ts            curated HiPS per regime (IDs checked against the MocServer)
  service-registry.ts        services.json + the user's own services
src/app/components/
  query-form                 target + constraints
  sky-view                   Aladin Lite (loaded on demand: ~640 kB gzipped incl. WebAssembly)
  timeline                   SVG timelines, zoom/brush, simultaneous row, CSV
  service-manager            enable/add services, availability check
server/                      production server and the proxy shared with `ng serve`
```
