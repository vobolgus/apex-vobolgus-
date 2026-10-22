# legacy/

Archive of the features that were removed when Apex was narrowed to a single
tool, the star-map generator. Everything here was moved out of the live tree
as of commit `05becf9` and is kept for reference only.

Nothing in this directory is built, compiled or routed:

- it is not a member of the Cargo workspace (`Cargo.toml` lists only
  `rust-core` and `backend`), so `cargo build` / `cargo test` never see it;
- SvelteKit only routes `frontend/src/routes/`, so the pages under
  `legacy/frontend/` are not served;
- no CI job checks it.

The code here references modules, types and state that no longer exist in the
live tree (`AppState.db`, `rust_core::scoring`, `rust_core::mechanics`, the
`question_factory` module, and so on). Do not expect it to compile as is.

## What is here

### Backend (`legacy/backend/`)

- `src/handlers/game/`: Sky Quiz game API (`/game/api/*`: modes, start,
  question, answer, hint, finish).
- `src/question_factory/`: question generators for the five quiz modes
  (constellation, star, Messier, trivia, draw).
- `src/handlers/simulation.rs`: AstraEtudes orbital simulator API
  (`/api/compute`).
- `src/db.rs` and `migrations/`: SQLite persistence for game sessions (`sqlx`).
- `assets/messier/`: 110 Messier object photos (`m1.jpeg` to `m110.jpeg`),
  formerly served at `/images/*`.

### rust-core (`legacy/rust-core/`)

- `src/mechanics.rs`: RK4 orbit integrator and orbital elements.
- `src/scoring.rs`: quiz scoring, streaks and ranks.

The Messier catalog (`rust-core/src/catalog/messier.rs`) was kept live: its
object positions are planned for the generator map.

### Frontend (`legacy/frontend/`)

- `src/routes/+page.svelte`: the old landing page.
- `src/routes/games/`: the Sky Quiz page.
- `src/routes/astra-etudes/`: the AstraEtudes page.

### Specification

- `SPEC.md`: the original full specification (generator, Sky Quiz,
  AstraEtudes, Flutter mobile app). The live, generator-only spec is the
  root [`SPEC.md`](../SPEC.md).

## Partial files

Some files are not whole originals but extracts: the game- and
simulation-only code (including the quiz's Messier/HIP highlighting in the map
renderer) that was trimmed out of files which stayed live:

- `backend/src/main.rs`: game, simulation and `/images` routes, the SQLite
  pool in `AppState`, and their tests;
- `backend/src/models.rs`: Sky Quiz and orbit request/response types;
- `backend/src/svg_generator/mod.rs`: the `highlight_hip` /
  `highlight_messier` parameters of `render_map` and their drawing code;
- `rust-core/src/lib.rs`: the `mechanics` / `scoring` modules, re-exports and
  tests.

Each such file sits at the same relative path as its source and starts with a header comment naming it:

```
// Extracted from backend/src/models.rs at 05becf9 — ... Full original: git show 05becf9:backend/src/models.rs
```

To list them:

```sh
grep -rl --include='*.rs' '^// Extracted from' legacy/
```

## Viewing the full originals

Any file as it was before the split, archived or not, is available from git:

```sh
git show 05becf9:<path>
# e.g.
git show 05becf9:backend/src/main.rs
git show 05becf9:rust-core/src/lib.rs
```
