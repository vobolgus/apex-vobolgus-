# Backend API

Base URL (local): `http://localhost:8080`

## Health

- `GET /`
- Response: `Apex Backend is running!`

## Static assets

- `GET /images/m31.jpeg` - Messier image assets (`m1..m110`)

## Catalog

- `GET /api/catalog/bright?max_mag=4.0`
  - layered loading first step (default `max_mag=4.0`)
- `GET /api/catalog/full?max_mag=6.5`
  - full catalog step (default `max_mag=6.5`)

## Orbit simulation (AstraEtudes)

- `GET /api/compute`
  - Query params: `r_x`, `r_y`, `v_x`, `v_y`, `mu`, `dt`, `steps`
- `POST /api/compute`
  - JSON body with same fields

Example:

```bash
curl "http://localhost:8080/api/compute?r_x=7000&r_y=0&v_x=0&v_y=7.546049108166282&mu=398600.44&dt=10&steps=25"
```

Validation:

- `mu > 0`
- `dt > 0`
- `steps in 1..=100000`

## PDF export

- `POST /api/export`
- Content-Type: `application/json`
- Response: PDF bytes (`application/pdf`)

Validation:

- `projection` in `stereo|pinhole`
- `latitude` in `-90..=90`
- `longitude` in `-180..=180`
- optional `magnitude_limit` in `0..=10`

## Sky Quiz

- `GET /game/api/modes`
- `POST /game/api/start`
- `GET /game/api/question?session_id=...`
- `POST /game/api/answer`
- `GET /game/api/hint?session_id=...`
- `POST /game/api/finish`

`/game/api/start` validation:

- `mode` in `constellation|star|messier|draw|trivia`
- `difficulty` in `easy|medium|hard`
- `total_rounds` in `1..=50`
