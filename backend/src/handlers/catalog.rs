//! `GET /api/catalog/*` and the constellation routes: the JSON a chart is drawn from
//! in the browser.
//!
//! Every default answer is kept ready (`crate::cached`); only a slice of the stars
//! a client names for itself is worked out per request.

use axum::Json;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::payload::{self, BRIGHT_MAX_MAG, FULL_MAX_MAG};
use crate::state::AppState;

/// The magnitude range a star route is asked for; both ends are optional.
#[derive(Debug, Deserialize)]
pub(crate) struct CatalogQuery {
    /// The faintest star wanted; the route's own default when absent.
    max_mag: Option<f32>,
    /// The brightest star wanted; none are left out when absent.
    min_mag: Option<f32>,
}

impl CatalogQuery {
    /// The endpoint's default slice, which is kept ready in the cache; naming the
    /// default limit outright asks for the same.
    fn is_default(&self, default_max_mag: f32) -> bool {
        self.min_mag.is_none() && self.max_mag.is_none_or(|max| max == default_max_mag)
    }

    /// The stars asked for, worked out on the spot and not cached.
    fn slice(&self, state: &AppState, default_max_mag: f32) -> Response {
        let max_mag = self.max_mag.unwrap_or(default_max_mag);
        Json(payload::stars(&state.hip_catalog, max_mag, self.min_mag)).into_response()
    }
}

/// `GET /api/catalog/bright`: the stars to magnitude 4, the first, small load.
pub(crate) async fn bright_stars(
    State(state): State<AppState>,
    Query(query): Query<CatalogQuery>,
    headers: HeaderMap,
) -> Response {
    if query.is_default(BRIGHT_MAX_MAG) {
        return state
            .catalog_cache
            .bright(&state.hip_catalog)
            .response(&headers);
    }
    query.slice(&state, BRIGHT_MAX_MAG)
}

/// `GET /api/catalog/full`: the stars to magnitude 6.5, everything the chart draws.
pub(crate) async fn full_stars(
    State(state): State<AppState>,
    Query(query): Query<CatalogQuery>,
    headers: HeaderMap,
) -> Response {
    if query.is_default(FULL_MAX_MAG) {
        return state
            .catalog_cache
            .full(&state.hip_catalog)
            .response(&headers);
    }
    query.slice(&state, FULL_MAX_MAG)
}

/// `GET /api/catalog/messier`: the Messier catalogue, by number.
pub(crate) async fn messier(State(state): State<AppState>, headers: HeaderMap) -> Response {
    state.catalog_cache.messier().response(&headers)
}

/// `GET /api/constellation-boundaries`: the IAU boundaries.
pub(crate) async fn constellation_boundaries(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    state
        .catalog_cache
        .constellation_boundaries()
        .response(&headers)
}

/// `GET /api/constellations`: the stick figures.
pub(crate) async fn constellations(State(state): State<AppState>, headers: HeaderMap) -> Response {
    state
        .catalog_cache
        .constellations(&state.hip_catalog)
        .response(&headers)
}
