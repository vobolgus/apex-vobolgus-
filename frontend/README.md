# Apex Frontend (SvelteKit)

New frontend implementation for Apex based on the project specification.

Current scope:

- New SvelteKit app shell (`/`, `/generator`, `/games`, `/astra-etudes`)
- Generator page with:
  - control panel + live preview canvas
  - layered catalog loading (`bright` first, `full` in background)
  - PDF export via backend API
- Internal API proxy routes:
  - `GET /api/catalog/bright`
  - `GET /api/catalog/full`
  - `POST /api/export`

## Requirements

- Node.js 20+
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
