# Apex Frontend (SvelteKit)

New frontend implementation for Apex based on the project specification.

Current scope:

- Single-page SvelteKit app: the star-map generator at `/`
  (the old `/generator` URL permanently redirects to `/`)
- Generator page with:
  - control panel + live preview canvas
  - loads the bright stars first (`/api/catalog/bright`, ≤ 4.0m), then the full
    catalog (`/api/catalog/full`, ≤ 6.5m), constellation figures and boundaries;
    a notice with Try again when any of them does not load
  - the view kept in the URL fragment (`src/lib/state/view-url.ts`)
  - PNG export from the canvas; SVG/PDF via the backend API, from the
    preview's own camera
  - the PDF document: Add to PDF, the pages panel, the page editor and the
    "PDF document" export (`src/lib/document/`, `src/lib/components/document/`)
- A static build (`adapter-static`): `npm run build` writes `build/`, which the
  backend serves in production next to its `/api/*` routes. There is no Node
  server and no server-side route; the page calls `/api/*` on its own origin.

## Requirements

- Node.js 20.19+ or 22.12+
- Running backend service (`backend`, default `http://localhost:8080`)

## Run

```sh
cd frontend
npm install
npm run dev
```

## Configure backend URL

In development (`npm run dev`, `npm run preview`) Vite forwards `/api/*` to
`BACKEND_URL`; a production build does not read it.

Create `.env` in `frontend/` (or export env var globally):

```sh
BACKEND_URL=http://localhost:8080
```

If not set, default is `http://localhost:8080`.

## Validate

```sh
npm run check
npm run build
```
