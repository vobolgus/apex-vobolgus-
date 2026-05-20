# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-21

### Added
- Initial Rust + SvelteKit rewrite of the project as "Apex".
- `rust-core` library: catalogs (HIP, Messier), projections (stereographic, pinhole), scoring and orbital mechanics.
- `backend` HTTP API (Axum + SQLx + SQLite): catalog endpoints, PDF/SVG export, orbital simulator, Sky Quiz session API (5 game modes).
- `frontend` SvelteKit web application: landing page, star-map generator with real-time canvas preview, Sky Quiz games, AstraEtudes orbital simulator.
