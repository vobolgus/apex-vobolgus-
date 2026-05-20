# Apex — Web service and mobile app for learning astronomy

Apex offers three independent tools under one brand:

1. **Star-map Generator**: Custom PDF and SVG maps for observations, Olympiads, and astronomy lessons. It features high-fidelity real-time previews with support for stereographic and pinhole projections.
2. **Sky Quiz**: An educational gaming platform with five distinct modes for learning constellations, stars, and Messier objects. It implements engagement mechanics like streaks, ranks, and scoring bonuses.
3. **AstraEtudes**: A suite of interactive physics simulators designed for educational purposes, covering orbital mechanics, lunar phases, and other astronomical phenomena.

The project is designed for students, educators, and astronomy enthusiasts, providing a modern dark-space UI experience.

## Stack

- **Rust Core**: The engine of the project, implemented as a shared library (`rust-core/`). It handles star catalogs (Hipparcos, Messier), coordinate projections, and orbital mechanics.
- **Backend**: A high-performance Axum-based HTTP API (`backend/`) using SQLx for SQLite persistence. It handles server-side PDF/SVG export and game session management.
- **Frontend**: A reactive SvelteKit web application (`frontend/`). It utilizes 2D Canvas for instantaneous local previews, ensuring a seamless user experience.
- **Mobile (Planned)**: Cross-platform iOS and Android applications built with Flutter. It will leverage `flutter_rust_bridge` to execute the Rust core natively on the device for offline capabilities.

## Architecture

```text
┌─────────────────────────────────────────┐
│             rust-core (lib)             │
│   catalog · projections · mechanics     │
│   scoring · constellation data         │
└──────────┬──────────────────┬───────────┘
           │                  │
    ┌──────▼──────┐    ┌──────▼────────────────┐
    │ Axum server │    │   Flutter (mobile)    │
    │ PDF export  │    │   (planned)           │
    │ Game API    │    │   FFI → rust-core     │
    │ Sim API     │    └───────────────────────┘
    └──────┬──────┘
           │ HTTP
    ┌──────▼──────────────────────────────┐
    │           SvelteKit (web)           │
    │  Landing · Generator · Quiz · Sims  │
    │  Canvas preview — realtime (JS)     │
    └─────────────────────────────────────┘
```

## Key Features

- **High-Precision Astronomy**: Uses standard astronomical catalogs and rigorous projection algorithms.
- **Real-Time Visualization**: Instant feedback in the generator UI using client-side Canvas rendering.
- **Multi-Format Export**: Generate production-ready PDF and SVG maps for print and digital use.
- **Gamified Learning**: Progressive difficulty levels and rank-based progression in Sky Quiz.
- **Physical Simulations**: Numerical integrators (RK4) for realistic orbital mechanics modeling.
- **Optimized Performance**: Layered catalog loading ensures the interface remains responsive even with large datasets.

## How to develop

### Backend

From the repository root:

```bash
cargo run -p backend
```

Configurable via `DATABASE_URL` (defaults to `sqlite://apex.db`).

### Frontend

From the `frontend/` directory:

```bash
npm install
npm run dev
```

### Tests

- **Rust**: `cargo test --workspace`
- **Frontend**: `cd frontend && npm run check && npm run test:unit && npx playwright test`

## Project structure

- `rust-core/`: The core astronomy engine. Includes star catalog loaders, projection mathematics, and physical mechanics.
- `backend/`: Axum server implementation. Handles API endpoints for catalogs, game sessions, and high-quality PDF/SVG generation using the `plotters` crate.
- `frontend/`: The web frontend built with SvelteKit and Tailwind CSS. Contains the landing page, generator UI, and quiz game screens.
- `SPEC.md`: The source of truth for the project's technical specification, architectural design, and UI/UX references.
- `Cargo.toml`: Workspace configuration for the Rust ecosystem.

## License

Refer to the [LICENSE](LICENSE) file for details.
