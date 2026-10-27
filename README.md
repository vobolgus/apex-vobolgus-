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
  The planets toggle applies to the backend export only.
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
  at `/` (`/generator` redirects to it). Canvas 2D renderer in TypeScript; the
  SvelteKit server proxies `/api/*` to the backend.

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
           │ HTTP, proxied by SvelteKit /api/*
    ┌──────▼──────────────────────────────┐
    │         frontend (SvelteKit)        │
    │  generator page at /                │
    │  Canvas 2D preview — realtime (TS)  │
    └─────────────────────────────────────┘
```

Backend endpoints used by the page: `GET /api/catalog/full`,
`GET /api/constellations`, `GET /api/constellation-boundaries`,
`POST /api/export` (PDF by default, SVG with `?format=svg`; the page editor's
chart previews are these SVGs) and `POST /api/export/document` (the PDF
document, one multi-page PDF). The backend also
serves `GET /api/catalog/bright` and a `GET /` health probe. Details are in
[`backend/API.md`](backend/API.md).

## How to develop

Requirements: Rust 1.88+ (edition 2024), Node.js 20.19+ or 22.12+ (Vite 8).

### Backend

From the repository root:

```bash
cargo run -p backend
```

The server listens on `http://localhost:8080`. There is no database and no
configuration to set up.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The SvelteKit server forwards `/api/*` to
`BACKEND_URL` (default `http://localhost:8080`, see `frontend/.env.example`).

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
  assets/constellations/   constellation figures and boundaries (JSON)
  assets/golden/           reference-geometry fixture shared by Rust and TS tests
  API.md                   HTTP API reference
frontend/                  SvelteKit app
  src/routes/+page.svelte  the generator page
  src/routes/generator/    redirect from the old /generator URL to /
  src/routes/api/          server-side proxies to the backend
  src/lib/                 renderer, math, state, components, API clients
  src/lib/document/        the PDF document: layout engine, store, render configs
  e2e/                     Playwright visual regression tests
legacy/                    archived features, reference only (see legacy/README.md)
SPEC.md                    product specification (generator only)
CHANGELOG.md               release notes
Cargo.toml                 Rust workspace (rust-core, backend)
```

## License

Refer to the [LICENSE](LICENSE) file for details.
