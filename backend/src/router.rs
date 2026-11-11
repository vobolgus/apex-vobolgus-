//! The routes: which handler answers which path.

use std::path::Path;

use axum::Router;
use axum::response::Redirect;
use axum::routing::{get, post};

use crate::handlers::{catalog, document, export};
use crate::state::AppState;
use crate::{middleware, static_site};

/// The API, and the frontend's static build as well when `static_dir` holds one.
/// Without it `/` is the health probe it always was, and the page is served by
/// someone else (the Vite dev server, which proxies `/api` here).
pub fn router(state: AppState, static_dir: Option<&Path>) -> Router {
    let app = match static_dir {
        Some(dir) => Router::new().fallback_service(static_site::router(dir)),
        None => Router::new().route("/", get(|| async { "Apex Backend is running!" })),
    };

    app.route("/api/health", get(|| async { "ok" }))
        // The generator used to live at /generator; old links keep working.
        .route("/generator", get(|| async { Redirect::permanent("/") }))
        // Catalog endpoints
        .route("/api/catalog/bright", get(catalog::get_bright_stars))
        .route("/api/catalog/full", get(catalog::get_full_stars))
        .route("/api/catalog/messier", get(catalog::get_messier))
        .route("/api/constellations", get(catalog::get_constellations))
        .route(
            "/api/constellation-boundaries",
            get(catalog::get_constellation_boundaries),
        )
        // PDF Export
        .route("/api/export", post(export::export_chart))
        .route(
            "/api/export/document",
            post(document::export_document_within_budget).layer(middleware::document_body_limit()),
        )
        .layer(middleware::cors())
        .with_state(state)
}

#[cfg(test)]
mod tests;
