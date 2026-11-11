# Backend API

Base URL (local): `http://localhost:8080`

The backend serves the star-map generator only. In production it also serves
the frontend's static build from the same origin (see "Static site" below); in
development the Vite dev server proxies `/api/...` here.

CORS: any origin, method and header.

## Health

- `GET /api/health`
- Response: `ok` (`text/plain`)
- `GET /` answers `Apex Backend is running!` when no static site is configured.

## Static site

With `STATIC_DIR` set to the frontend's build (`frontend/build`), every path that
is not an API route is served from it:

- `/_app/immutable/*` (content-hashed names): `Cache-Control: public,
  max-age=31536000, immutable`.
- Everything else, `index.html` included: `Cache-Control: no-cache`, revalidated
  on each visit (`304` when unchanged).
- The build's `.br` and `.gz` twins are sent as they are to a client that takes
  them.
- A path that is no file: `404.html` with status `404`.
- `GET /generator`: `308` to `/`.

`PORT` sets the port to listen on (default 8080).

## Export budget

`POST /api/export` and `POST /api/export/document` are rationed in charts, with
a token bucket per client and one for the whole server (`src/limits.rs`). A
chart in a PDF costs 4 units, an SVG 1.

| Bucket | Burst | Refill |
|---|---|---|
| per client | 1600 units (two 200-chart documents) | 1 unit/s (900 PDF charts an hour) |
| whole server | 8000 units | 2 units/s (1800 PDF charts an hour) |

Past either: `429 Too Many Requests`, plain text, with `Retry-After` in seconds.
The budget is taken before the request is validated. The client is the address
in `X-Real-IP`, else the last hop of `X-Forwarded-For`, else the peer's; the
server's bucket does not depend on it.

Besides the budget, at most 4 single charts and 2 documents are converted at a
time; the rest wait their turn.

## Catalog

Both routes return HIP stars as a JSON array, filtered by `min_mag <= v_mag <= max_mag`.

- `GET /api/catalog/bright?max_mag=4.0&min_mag=...`
  - layered loading first step (default `max_mag=4.0`)
- `GET /api/catalog/full?max_mag=6.5&min_mag=...`
  - full catalog step (default `max_mag=6.5`)

Query params (both optional, numbers): `max_mag`, `min_mag` (no lower bound when omitted).

### Caching

The default slice of each star route (no params, or the default `max_mag` named
outright) and both constellation routes never change while the server runs. They
are serialized and gzipped once at startup and sent as they are:

- `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` and a weak
  `ETag`; a request with a matching `If-None-Match` gets `304` and no body.
- `Content-Encoding: gzip` when `Accept-Encoding` lists gzip (the full catalog is
  about 414 KB plain and 103 KB gzipped, the bright one 24 KB and 7 KB).

Any other slice (`min_mag`, another `max_mag`) is computed per request and sent
without these headers. The frontend's `/api/*` proxies pass `Cache-Control`, `ETag`
and `If-None-Match` through and stream the body; they leave compressing the hop to
the browser to the host (a CDN or a reverse proxy).

Star object:

```json
{ "v_mag": -1.44, "ra": 1.7677944, "dec": -0.29175127 }
```

- `ra`, `dec` in radians
- Position and brightness only. The unit vector in the equatorial frame is
  `(cos dec · cos ra, cos dec · sin ra, sin dec)`, which the client works out; the
  HIP number is not sent. Arrays are sorted from the brightest star down.

### Messier

- `GET /api/catalog/messier` - the 110 Messier objects, by number
  - Response: `[{ "m": 42, "name": "Orion Nebula", "kind": "Nebula", "constellation": "Ori",
    "mag": 4.0, "ra_deg": 83.82, "dec_deg": -5.39 }, ...]`; `name` is empty for an object
    with no common name, `ra_deg`/`dec_deg` are J2000 degrees
  - Cached and compressed like the star catalogs (see Caching)

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
  - Response: `image/svg+xml; charset=utf-8`, with `Content-Encoding: gzip` when
    `Accept-Encoding` lists gzip (about a fifth of the size)
  - any other `format` value returns the PDF
- Request: `Content-Type: application/json`, body is `RenderConfig`
- `429` past the export budget (see "Export budget" above)

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
| `marks?` | `{ ra_deg, dec_deg, radius_deg }[]` | places ringed on the chart, in the app's accent, clipped by the sky's edge: every point `radius_deg` from the centre. At most 16; `dec_deg` in `-90..=90`, `radius_deg` in `(0, 90]` |
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

- `POST /api/export/document` - charts and text placed on pages, as one multi-page PDF
  - Request: `Content-Type: application/json`, body up to 2 MB:

    ```json
    {
      "pages": [
        { "width_mm": 210, "height_mm": 297,
          "items": [{ "x_mm": 12, "y_mm": 12, "width_mm": 90, "height_mm": 90, "config": { "...": "RenderConfig with a view" } }],
          "texts": [{ "font": "serif", "bold": false, "italic": false, "size_mm": 4.23, "anchor": "start",
                      "rotation_deg": 0, "cx_mm": 105, "cy_mm": 110,
                      "lines": [{ "x_mm": 12, "y_mm": 110, "text": "Latitude 56° N" }] }] },
        { "width_mm": 297, "height_mm": 210, "items": [] }
      ]
    }
    ```

  - Response: `application/pdf`, `Content-Disposition: attachment; filename="skycharts.pdf"`,
    one PDF page per entry of `pages`, in order, each exactly `width_mm × height_mm`
    (1 mm = 72/25.4 pt; A4 is 595.28 × 841.89 pt). A page without items or texts is a
    blank page
- Geometry is in mm from the page's top-left corner, y down. Each chart is drawn into its
  box with its `view.width × view.height` as the viewBox, aspect kept (centred if the box's
  aspect differs). The generator sends `view.width/height` = the box in mm and `view.px`,
  so star radii and line widths are fixed in mm whatever the chart's size; for paper it
  uses `background_color: "none"`, a white `chart_color` and a `chart_outline`
- A text (`texts`, optional) comes already broken into lines: the page editor wraps it,
  and each line is set where it says, over the charts, in black. `font` is `serif` (PT
  Serif) or `sans` (PT Sans), with `bold` and `italic` (both default `false`); `size_mm`
  is the font size; a line's `x_mm`/`y_mm` is the start of its baseline, or its middle or
  end with `anchor` `middle` or `end` (default `start`). A text turned `rotation_deg`
  degrees clockwise (default `0`) gives its lines as they are before the turn, which is
  made about (`cx_mm`, `cy_mm`). The fonts are the files in
  `frontend/static/fonts`, which this server carries in its binary and the page loads
  from `/fonts/`: the same files on both sides, so a line fits as it did in the editor.
  They are embedded in the PDF as subsets, so the text can be selected and searched.
  A line may carry an `anchor` and a `bold` of its own, which then stand for the text's
  (a table's cell: `{ "x_mm": 198, "y_mm": 140, "text": "4.0", "anchor": "end" }`), and a
  text may carry `rules`, straight black lines drawn with it and turned with it:
  `"rules": [{ "x1_mm": 12, "y1_mm": 134, "x2_mm": 198, "y2_mm": 134, "width_mm": 0.3 }]`
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
- `0..=50` texts per page, each of at most `400` lines of at most `400` characters and
  at most `100` rules (finite ends, `width_mm` in `(0, 5]`);
  `size_mm` in `1..=100`; every line's `x_mm`/`y_mm` on its page, with 1 mm of tolerance
  once the text is turned (e.g. `page 1, text 2: line 3 must start inside its page`);
  `rotation_deg`, `cx_mm` and `cy_mm` finite. A control character in a
  line is drawn as a space

Other errors as for `/api/export` (`422` for a body that does not match, `500` for a
failed conversion; `413` above 2 MB). At most two documents are converted at once; a
third request waits for one of them to finish.
