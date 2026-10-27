# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- PDF document in the generator: **+ Add to PDF** in the header places the chart as the preview shows it on the first page with room (a new A4 page if none), and a pages panel floats on the left of the chart: page thumbnails with their charts, a red ⊖ on hover to delete a page (with an Undo toast for 6 s, also `⌘Z`/`Ctrl+Z`), ⊕ to add a page, a tab to collapse it to the page count (collapsed by default on phones), and a click on a page opens the page editor. The export menu gets a "PDF document" row ("N pages · A4") that downloads every page as one PDF. The document is kept in `localStorage`.
- The page editor, opened from a page in the panel: the previous, current and next page side by side over the dimmed app, a strip of mini pages (with ⊕) below and ⊗ to close. Charts move by dragging and resize by their corners, both snapping to fractions of the page's content box and to the edges and centres of the other charts, with guides drawn; a chart let go over a neighbouring page moves there. Each page has its own portrait/landscape toggle, and charts that no longer fit are placed again. From the keyboard a focused chart nudges with the arrows (Shift: 10 mm), steps its size with + and −, moves to the page before or after with Page Up/Page Down and is removed with Delete (with an Undo toast); a selected chart shows the same commands as a small toolbar, for touch and for anyone who cannot drag.
- `POST /api/export/document` (and its SvelteKit proxy, which streams the file back): charts placed on pages in mm come back as one multi-page PDF, each page exactly its requested size (A4 portrait or landscape) and an empty page blank. Pages are built as SVG with every chart nested under its own id prefix, converted with `svg2pdf::to_chunk` and assembled with `pdf-writer`. A document holds up to 100 pages, 50 charts on a page and 200 charts in all (a chart costs about the same to draw whatever its size), and two documents are converted at a time; the editor keeps to the same limits and shows the backend's reason when it refuses a document.
- `view.px` in `RenderConfig`: the length of one preview px in view units. Star and planet radii, line widths and text scale with it, so a chart sized in mm keeps its stars the same size on paper however large it is drawn.
- `style.chart_outline` strokes the sky's edge 1 preview px wide, and `style.background_color: "none"` paints no background, for charts on white paper.
- About dialog after ray.so's: a description and the full shortcut list, opened from the header or with `?`.
- `⌘K`/`Ctrl+K` toggles the export menu (arrow keys move through the formats); `⌘S`/`Ctrl+S` saves a PNG.

### Fixed
- SVG and PDF export from the generator: the request was not a `RenderConfig` and every export failed with 422. The page now sends the preview's camera (`view`), field of view, layers and colours, and the backend draws the same chart, pinned to the preview by a shared golden fixture.

### Changed
- `RenderConfig`: an optional `view` (camera basis and chart size) replaces the observer for orientation, so `latitude`/`longitude` are only required without one; `style.chart_color` fills the sky; `layers.constellation_boundaries` draws the IAU boundaries; `datetime` accepts RFC 3339.
- The backend draws constellation lines as great-circle arcs and traces reference circles in 1° steps, with the preview's line widths and opacities. Line opacity is `stroke-opacity` rather than element `opacity`, which made svg2pdf wrap every line in a transparency group of its own (a PDF about 2.4 times larger and slower to display).
- Bottom dock: a Stereo/Pinhole segmented control and a Layers popover with grouped switches replace the row of labelled toggles.
- The pinhole frame has its own overlay (corner brackets, edge pills, a size readout while dragging, keyboard-resizable edges) instead of Moveable, which is no longer a dependency.
- Header, after ray.so: Export is a tinted split button that names the format it saves ("Export PNG"), and its menu says what each format is for and shows ⌘S. About is a "?" icon on phones, and the header fits a 320 px screen.
- Pinhole opens from a full-sky stereo view at 100° instead of the 120° maximum, so the frame can still be widened; switching straight back restores the view you left.
- Apex is now a single tool: the star-map generator is the only page and is served at `/`; the old `/generator` URL permanently redirects (308) to `/`.
- `SPEC.md` narrowed to the generator; the original full specification is kept as `legacy/SPEC.md`.

### Removed
- The header's Format button, which did nothing.
- Sky Quiz: game API (`/game/api/*`), question factory, SQLite game sessions (`sqlx` database and migrations) and scoring/ranks in `rust-core`.
- AstraEtudes: orbital simulator API (`/api/compute`) and the RK4 mechanics in `rust-core`.
- The 110 Messier photos (`/images/*`). The Messier catalog itself stays in `rust-core` for a future map layer.
- Landing, games and astra-etudes frontend pages.
- All of the above is archived under `legacy/` for reference only; it is not built, compiled or routed.

## [0.1.0] - 2026-05-21

### Added
- Initial Rust + SvelteKit rewrite of the project as "Apex".
- `rust-core` library: catalogs (HIP, Messier), projections (stereographic, pinhole), scoring and orbital mechanics.
- `backend` HTTP API (Axum + SQLx + SQLite): catalog endpoints, PDF/SVG export, orbital simulator, Sky Quiz session API (5 game modes).
- `frontend` SvelteKit web application: landing page, star-map generator with real-time canvas preview, Sky Quiz games, AstraEtudes orbital simulator.
