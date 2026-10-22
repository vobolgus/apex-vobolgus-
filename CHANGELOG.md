# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Apex is now a single tool: the star-map generator is the only page and is served at `/`; the old `/generator` URL permanently redirects (308) to `/`.
- `SPEC.md` narrowed to the generator; the original full specification is kept as `legacy/SPEC.md`.

### Removed
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
