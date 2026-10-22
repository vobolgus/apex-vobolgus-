## Learned User Preferences
- User prefers direct execution of requested git workflows (stage, commit, push) with minimal back-and-forth.
- User expects exact adherence to instruction corrections when clarifying intent.
- User prefers concise, action-oriented follow-up guidance on next steps.
- User prefers communication in Russian during implementation iterations.

- User expects git operations to target the explicitly named repository/remote and branch constraints without deviation.
- User expects new feature work to be implemented as a new project per `SPEC.md`, using legacy code only as a reference.
## Learned Workspace Facts
- The repository is a Rust workspace plus a SvelteKit app in `frontend/`; `legacy/` holds archived, unbuilt code (the earlier Python project was removed from the tree).
- The Rust workspace currently centers on `backend` and `rust-core` crates at the repo root.
- Incremental continual-learning state is tracked at `.cursor/hooks/state/continual-learning-index.json`.
- The GitHub repository `vobolgus/apex-vobolgus-` is a public fork of `04Maksimka/apex`.
- The SvelteKit frontend in `frontend/` is a single-page app: the generator page is `frontend/src/routes/+page.svelte`, served at `/` (`/generator` redirects to `/`).
- Project scope is the star-map generator only (served at `/`); archived features (Sky Quiz, AstraEtudes, Messier photos, landing page, original `SPEC.md`) live in `legacy/` for reference and are not built or routed.
