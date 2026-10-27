# Backend API

Base URL (local): `http://localhost:8080`

The backend serves the star-map generator only. The SvelteKit app proxies these
routes under the same paths (`/api/...`).

CORS: any origin, method and header.

## Health

- `GET /`
- Response: `Apex Backend is running!` (`text/plain`)

## Catalog

Both routes return HIP stars as a JSON array, filtered by `min_mag <= v_mag <= max_mag`.

- `GET /api/catalog/bright?max_mag=4.0&min_mag=...`
  - layered loading first step (default `max_mag=4.0`)
- `GET /api/catalog/full?max_mag=6.5&min_mag=...`
  - full catalog step (default `max_mag=6.5`)

Query params (both optional, numbers): `max_mag`, `min_mag` (no lower bound when omitted).

Star object:

```json
{ "hip_id": 32349, "v_mag": -1.44, "ra": 1.7677, "dec": -0.2917, "x": -0.187, "y": 0.939, "z": -0.288 }
```

- `ra`, `dec` in radians
- `x`, `y`, `z` - unit vector in the equatorial (ECI) frame

## Constellations

Both routes return a JSON array sorted by `abbr`, no query params:

```json
[{ "abbr": "ORI", "segments": [[{ "x": 0.1, "y": 0.9, "z": 0.1 }, { "x": 0.2, "y": 0.9, "z": 0.0 }]] }]
```

Each segment is a polyline of unit vectors (equatorial frame).

- `GET /api/constellations` - stick figures
  - built from `assets/constellations/constellations_data.json`; HIP ids are resolved
    against stars with `v_mag <= 7.5`
  - segments with fewer than 2 resolved points are dropped, constellations left
    without segments are omitted
- `GET /api/constellation-boundaries` - IAU boundary polygons
  - built from `assets/constellations/constellation_boundaries.json` (RA/Dec degrees
    converted to unit vectors)

## Export

- `POST /api/export` - PDF
  - Response: `application/pdf`, `Content-Disposition: attachment; filename="sky_chart.pdf"`
- `POST /api/export?format=svg` - the same map as SVG
  - Response: `image/svg+xml; charset=utf-8`
  - any other `format` value returns the PDF
- Request: `Content-Type: application/json`, body is `RenderConfig`

`RenderConfig` (`?` = optional, may be omitted or `null`):

| Field | Type | Notes |
| --- | --- | --- |
| `projection` | string | `stereo` (circular sky; 800x800 without a `view`) or `pinhole` |
| `datetime?` | string | RFC 3339 (`2025-06-01T22:00:00Z`), or UTC `YYYY-MM-DD HH:MM:SS` / `YYYY-MM-DD`; anything else falls back to `2024-06-14 06:10:00`. Places the planets, and the sky without a `view` |
| `latitude?` | number | observer latitude, degrees; required without a `view` |
| `longitude?` | number | observer longitude, degrees; required without a `view` |
| `magnitude_limit?` | number | faintest star magnitude, default `6.5` |
| `fov_deg?` | number | with a `view`: across the disc for `stereo` (default `180`), horizontal for `pinhole` (default `60`). Without one, pinhole only, across the frame diagonal, default `60` |
| `aspect_ratio?` | number | pinhole width/height (height is 800 px) without a `view`, default `1.5` |
| `view?` | `ViewConfig` | the generator preview's camera; see below |
| `constellation?` | string | abbreviation (e.g. `ORI`): draws lines/names for this constellation only; pinhole without `center_direction` is centered on it |
| `center_direction?` | `[x, y, z]` | pinhole view direction without a `view` (equatorial frame, normalized by the server), default `[1, 0, 0]` |
| `tilt_angle?` | number | pinhole camera roll without a `view`, degrees, default `0` |
| `layers` | `LayersConfig` | all fields required |
| `style` | `StyleConfig` | all fields required |
| `print_info?` | bool | prints Lat/Lon and Time in the bottom-left corner |
| `footer_text?` | string | centered footer line |

`ViewConfig` draws exactly what the generator preview shows, with its projection
formulas (`rust-core` `ViewProjection`, pinned to the preview by
`assets/golden/view-projection.json`). It replaces the observer, `center_direction`,
`tilt_angle` and the `constellation` centring, and drops the horizon decorations
(compass letters, horizon ring, zenith cross):

| Field | Type | Notes |
| --- | --- | --- |
| `right`, `up`, `forward` | `[x, y, z]` | screen right, screen up and the chart centre in the equatorial frame (normalized by the server). Taken as given, so they also decide which way round the sky reads |
| `width`, `height` | number | chart size in px, at most `20000`: the SVG `viewBox`. Stars use the preview's radii and lines its widths in these px; a stereo disc is as wide as the shorter side |
| `px?` | number | length of one preview px in the units of `width`/`height`, in `(0, 1000]`, default `1`. Star and planet radii, line widths and text sizes are multiplied by it, nothing else changes. A document sends the chart size in mm and `px` = `186 / 1104` (mm per preview px), so stars keep their size on paper however large the chart is |

`LayersConfig` (all `bool`; `constellation_boundaries` may be omitted, default `false`):

- `ecliptic`, `equator`, `galactic_equator`, `equatorial_grid` - reference lines
- `constellations`, `constellation_names` - stick figures and names (`constellation_names`
  also labels planets)
- `constellation_boundaries` - IAU boundaries, in `constellation_line_color`
- `planets` - Sun, Moon and planets brighter than `magnitude_limit * magnitude_scale`
- `zenith` - zenith cross (stereo only)
- `horizontal_grid`, `poles` - accepted, currently not drawn by the backend renderer

`StyleConfig`:

- `star_color`, `constellation_line_color`, `grid_color`, `background_color`,
  `font_family` - strings; `background_color` fills the whole image, `"none"` paints no
  background at all (whatever the chart is drawn on, e.g. paper, shows through)
- `chart_color?` - string, fill of the sky itself (the stereo disc or the pinhole frame);
  omitted, the background shows through
- `chart_outline?` - string, a colour: strokes the sky's edge (the stereo disc or the
  pinhole frame) 1 preview px wide (times `view.px`), just inside it. A white sky on white
  paper needs it
- `magnitude_scale` - number, star/planet size multiplier

Example:

```bash
curl -X POST "http://localhost:8080/api/export?format=svg" \
  -H "Content-Type: application/json" \
  -d '{
    "projection": "stereo",
    "datetime": "2026-05-20 22:00:00",
    "latitude": 55.75,
    "longitude": 37.62,
    "magnitude_limit": 6.0,
    "layers": {
      "ecliptic": true, "equator": false, "galactic_equator": false, "planets": true,
      "horizontal_grid": false, "equatorial_grid": false, "constellations": true,
      "constellation_names": true, "zenith": false, "poles": false
    },
    "style": {
      "star_color": "#FFFFFF", "constellation_line_color": "#808080",
      "grid_color": "#404040", "background_color": "#05050A",
      "font_family": "sans-serif", "magnitude_scale": 1.0
    }
  }'
```

Validation (`400`, plain-text message):

- `projection` in `stereo|pinhole`
- `latitude` and `longitude` present when there is no `view`
- `latitude` in `-90..=90`, `longitude` in `-180..=180` when given
- optional `magnitude_limit` in `0..=10`
- `view`: non-zero `right`, `up` and `forward`, `width` and `height` in `(0, 20000]`, `px`
  in `(0, 1000]` when given, and `fov_deg` below `360` for `stereo` and below `180` for
  `pinhole`

Other errors:

- `422` - body does not match `RenderConfig` (missing required field, wrong type)
- `400` - malformed JSON; `415` - missing `Content-Type: application/json`
- `500` - SVG parsing or PDF conversion failed (plain-text message)

## Document export

- `POST /api/export/document` - several charts placed on pages, as one multi-page PDF
  - Request: `Content-Type: application/json`, body up to 2 MB:

    ```json
    {
      "pages": [
        { "width_mm": 210, "height_mm": 297,
          "items": [{ "x_mm": 12, "y_mm": 12, "width_mm": 90, "height_mm": 90, "config": { "...": "RenderConfig with a view" } }] },
        { "width_mm": 297, "height_mm": 210, "items": [] }
      ]
    }
    ```

  - Response: `application/pdf`, `Content-Disposition: attachment; filename="skycharts.pdf"`,
    one PDF page per entry of `pages`, in order, each exactly `width_mm × height_mm`
    (1 mm = 72/25.4 pt; A4 is 595.28 × 841.89 pt). A page without items is a blank page
- Geometry is in mm from the page's top-left corner, y down. Each chart is drawn into its
  box with its `view.width × view.height` as the viewBox, aspect kept (centred if the box's
  aspect differs). The generator sends `view.width/height` = the box in mm and `view.px`,
  so star radii and line widths are fixed in mm whatever the chart's size; for paper it
  uses `background_color: "none"`, a white `chart_color` and a `chart_outline`
- How it is built: each page is an SVG in mm with every chart nested as an inner `<svg>`
  under its own id prefix (so their clip paths cannot collide), converted with
  `svg2pdf::to_chunk`; `pdf-writer` assembles the chunks into one page tree

Validation (`400`, plain-text message naming the page and item, 1-based, e.g.
`page 2, item 1: config needs a view`):

- `1..=100` pages, `0..=50` items per page, at most `200` charts in the whole document (a
  chart costs about the same to draw whatever its size, so this caps the work and the file)
- page and item `width_mm`/`height_mm` positive, finite and at most `2000`
- every item inside its page, with 1 mm of tolerance on each side
- every item `config` has a `view` and passes the `/api/export` checks above

Other errors as for `/api/export` (`422` for a body that does not match, `500` for a
failed conversion; `413` above 2 MB). At most two documents are converted at once; a
third request waits for one of them to finish.
