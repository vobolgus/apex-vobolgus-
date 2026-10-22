# Apex Frontend (SvelteKit)

New frontend implementation for Apex based on the project specification.

Current scope:

- Single-page SvelteKit app: the star-map generator at `/`
  (the old `/generator` URL permanently redirects to `/`)
- Generator page with:
  - control panel + live preview canvas
  - loads the full catalog (`/api/catalog/full`, stars ≤ 6.5m), constellation
    figures and boundaries
  - PNG export from the canvas; SVG/PDF via the backend API (the UI payload is
    not a full `RenderConfig` yet, see the root README)
- Internal API proxy routes:
  - `GET /api/catalog/bright`
  - `GET /api/catalog/full`
  - `GET /api/constellations`
  - `GET /api/constellation-boundaries`
  - `POST /api/export`

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

The frontend server-side proxies use `BACKEND_URL`.

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
