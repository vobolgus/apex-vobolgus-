# Apex — star-map generator

Apex is a web tool for making star maps for observing sessions, olympiads and
astronomy lessons. The whole product is one page: a large real-time sky preview
with a compact control bar, in the spirit of ray.so.

The project used to also include Sky Quiz games, the AstraEtudes simulators and
a planned Flutter app. Those parts are archived in [`legacy/`](legacy/README.md)
and are no longer built.

## What the page does

- Real-time Canvas 2D preview of the Hipparcos catalog down to magnitude 6.5
  (about 8,900 stars), computed entirely in the browser.
- Stereographic and pinhole projections with an animated morph between them
  (projection switch in the bottom dock or `Shift+P`). In pinhole mode the frame
  resizes by its corners and edges, or from the keyboard.
- Free orientation: drag to rotate, pinch (or ctrl+wheel) to zoom, `W A S D` or
  arrow keys to pan, `Q`/`E` to roll, `Shift+I`/`Shift+O` to zoom, `Shift+N` to
  turn north up.
- Reference lines: constellation figures, constellation boundaries, celestial
  equator, ecliptic, galactic equator.
- Export: PNG straight from the canvas; SVG and PDF rendered by the backend
  (`POST /api/export`) from the preview's own camera, so they show the same chart.
  The planets toggle applies to the backend export only. A slow export says it is
  being prepared and a failed one says so, in a toast.
- The view lives in the address bar, so a reload keeps it and the link shares it:
  `#p=pinhole&ra=83.82&dec=-1.2&pa=0&fov=40&ar=1.5&size=1.3&layers=lines,bounds`
  is the projection, the centre (degrees), the position angle of the chart's top
  (north through east), the field of view, the pinhole frame's aspect ratio and
  size, and the layers that are on (`frontend/src/lib/state/view-url.ts`).
- Stars load in two stages: the few hundred brighter than 4.0 are drawn first, the
  full catalog replaces them. Catalog responses are gzipped once by the backend
  and cached for a day by the browser (see `backend/API.md`). If the backend cannot
  be reached, a notice over the chart says what did not load and offers to try again.
- PDF document: **+ Add to PDF** places the chart as the preview shows it on the
  first A4 page with room (a new page if none). A pages panel on the left lists the
  pages (delete with Undo, add, collapse), and a click on a page opens the page
  editor: the page and its neighbours side by side, charts that move, resize and
  snap to the page's grid and to each other, move between pages, and a strip of
  every page. Stars keep their size in mm however large a chart is. The export
  menu's "PDF document" row downloads every page as one PDF
  (`POST /api/export/document`); a document holds up to 100 pages and 200 charts.
  It is kept in `localStorage`.
- About dialog (header button or `?`) with every shortcut; `⌘K`/`Ctrl+K` opens
  the export menu, `⌘S`/`Ctrl+S` saves a PNG and `⌘Z`/`Ctrl+Z` undoes a deletion.

## Stack

- **rust-core** (`rust-core/`): shared Rust library. Hipparcos (HIP) star
  catalog and Messier catalog (positions of the 110 objects, not drawn on the
  map yet), celestial coordinates and time (Julian date, sidereal time),
  stereographic and pinhole projections, low-precision ephemeris of the Sun,
  Moon and planets (Meeus).
- **backend** (`backend/`): Axum HTTP server. Star catalog, constellation
  figures and boundaries, SVG map rendering and PDF export via `svg2pdf`.
  Stateless: no database, catalogs are loaded into memory at startup.
- **frontend** (`frontend/`): SvelteKit app with a single page, the generator
  at `/` (`/generator` redirects to it). Canvas 2D renderer in TypeScript. It
  builds to static files (`adapter-static`), which the backend serves next to
  `/api/*`: in production there is one service and no Node server.

## Architecture

```text
┌─────────────────────────────────────────┐
│             rust-core (lib)             │
│   HIP · Messier · coords · time         │
│   projections · planets                 │
└──────────┬──────────────────────────────┘
           │
    ┌──────▼───────────────────┐
    │ backend (Axum, :8080)    │
    │ catalog · constellations │
    │ SVG / PDF export         │
    └──────┬───────────────────┘
           │ serves the static build, and /api/* on the same origin
    ┌──────▼──────────────────────────────┐
    │     frontend (SvelteKit, static)    │
    │  generator page at /                │
    │  Canvas 2D preview — realtime (TS)  │
    └─────────────────────────────────────┘
```

Backend endpoints used by the page: `GET /api/catalog/bright`,
`GET /api/catalog/full`,
`GET /api/constellations`, `GET /api/constellation-boundaries`,
`POST /api/export` (PDF by default, SVG with `?format=svg`; the page editor's
chart previews are these SVGs) and `POST /api/export/document` (the PDF
document, one multi-page PDF). The backend also
serves a `GET /api/health` probe. Details are in
[`backend/API.md`](backend/API.md).

## How to develop

Requirements: Rust 1.88+ (edition 2024), Node.js 20.19+ or 22.12+ (Vite 8).

### Backend

From the repository root:

```bash
cargo run -p backend
```

The server listens on `http://localhost:8080` (`PORT` overrides the port). There
is no database and no configuration to set up.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server forwards `/api/*` to
`BACKEND_URL` (default `http://localhost:8080`, see `frontend/.env.example`),
standing in for the single origin of production.

### The production build, locally

```bash
(cd frontend && npm run build)          # static files in frontend/build
STATIC_DIR=frontend/build cargo run --release -p backend
```

Open http://localhost:8080: the backend serves the page and the API. The same
thing as a container is `docker build -t skycharts . && docker run --rm -p 8080:8080 skycharts`.

## Deploying

The [`Dockerfile`](Dockerfile) builds one image: the backend binary with the
frontend's static build inside it. Railway builds it as it is and sets `PORT`.

- **One small service.** It idles at about 6 MB of memory, starts in about 0.3 s
  (so it suits Railway's serverless sleep) and settles at 11-23 MB after large
  exports; a 100-chart document peaks near 95 MB.
- **Exports are rationed** per client and for the whole server
  (`backend/src/limits.rs`): past the budget a request gets a `429`. This bounds
  what a loop of exports can cost; set a usage hard limit in the host's billing
  settings as well, as the last line.
- **Environment:** `PORT` (default 8080), `STATIC_DIR` (the static build; unset,
  the backend is the API only). The image also tunes glibc's allocator to return
  memory, see the comments in the `Dockerfile`.
- **Health check:** `GET /api/health`.

### Tests

- **Rust**: `cargo test --workspace`. CI also runs `cargo fmt --check --all`
  and `cargo clippy --workspace --all-targets -- -D warnings`.
- **Frontend** (in `frontend/`): `npm run check`, `npm run lint`,
  `npm run test:unit`.
- **E2E** (Playwright visual regression, in `frontend/`): the config does not
  start any servers. Run the backend on `:8080` and a dev server on `:5174`,
  then the tests:

  ```bash
  npm run dev -- --port 5174   # in a separate terminal
  npx playwright install chromium   # first time only
  npm run test:e2e
  ```

## Project structure

```text
rust-core/                 astronomy core library
  src/catalog/             HIP and Messier catalogs (*_data.bin)
  src/coords.rs, time.rs   coordinate conversions, Julian date, sidereal time
  src/projections/         stereographic and pinhole
  src/planets.rs           Sun, Moon and planet positions
backend/                   Axum server
  src/handlers/            catalog.rs, export.rs, document.rs (the PDF document)
  src/svg_generator/       SVG map renderer behind /api/export and the document
  src/cached.rs            catalog responses, serialized and gzipped once
  src/limits.rs            the export budget (per client and for the server)
  src/static_site.rs       serving the frontend's static build
  assets/constellations/   constellation figures and boundaries (JSON)
  assets/golden/           reference-geometry fixture shared by Rust and TS tests
  API.md                   HTTP API reference
frontend/                  SvelteKit app, built to static files
  src/routes/+page.svelte  the generator page
  vite.config.ts           the dev proxy of /api to the backend
  src/lib/                 renderer, math, state, components, API clients
  src/lib/document/        the PDF document: layout engine, store, render configs
  e2e/                     Playwright visual regression tests
legacy/                    archived features, reference only (see legacy/README.md)
SPEC.md                    product specification (generator only)
CHANGELOG.md               release notes
Cargo.toml                 Rust workspace (rust-core, backend)
Dockerfile                 the deployment image: backend + the static build
```

## License

Refer to the [LICENSE](LICENSE) file for details.
