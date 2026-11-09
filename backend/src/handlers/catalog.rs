use crate::AppState;
use crate::svg_generator::{get_constellation_boundaries_data, get_constellations_data};
use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use rust_core::catalog::{HipCatalog, Star};
use rust_core::coords::ra_dec_to_unit_vector;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Faintest star of `/api/catalog/bright` by default: the first, small load.
pub const BRIGHT_MAX_MAG: f32 = 4.0;
/// Faintest star of `/api/catalog/full` by default: everything the chart draws.
pub const FULL_MAX_MAG: f32 = 6.5;

#[derive(Debug, Deserialize)]
pub struct CatalogQuery {
    pub max_mag: Option<f32>,
    pub min_mag: Option<f32>,
}

/// A star as the catalog routes send it: where it is and how bright, which is all
/// a chart needs to draw it. The catalog's own `Star` also carries the HIP number
/// and the unit vector; a client derives the vector from `ra` and `dec`, and
/// leaving the four fields out makes the payload about a third of the size.
#[derive(Debug, Serialize)]
pub struct CatalogStar {
    pub v_mag: f32,
    /// Radians.
    pub ra: f32,
    /// Radians.
    pub dec: f32,
}

/// The stars with `min_mag <= v_mag <= max_mag`, as the catalog routes send them.
pub fn stars_payload(catalog: &HipCatalog, max_mag: f32, min_mag: Option<f32>) -> Vec<CatalogStar> {
    catalog
        .iter_stars(max_mag, min_mag)
        .map(|star| CatalogStar {
            v_mag: star.v_mag,
            ra: star.ra,
            dec: star.dec,
        })
        .collect()
}

impl CatalogQuery {
    /// The endpoint's default slice, which is kept ready in the cache; naming the
    /// default limit outright asks for the same.
    fn is_default(&self, default_max_mag: f32) -> bool {
        self.min_mag.is_none() && self.max_mag.is_none_or(|max| max == default_max_mag)
    }
}

pub async fn get_bright_stars(
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
    let max_mag = query.max_mag.unwrap_or(BRIGHT_MAX_MAG);
    Json(stars_payload(&state.hip_catalog, max_mag, query.min_mag)).into_response()
}

pub async fn get_full_stars(
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
    let max_mag = query.max_mag.unwrap_or(FULL_MAX_MAG);
    Json(stars_payload(&state.hip_catalog, max_mag, query.min_mag)).into_response()
}

#[derive(Serialize)]
pub struct ConstellationSegmentPoint {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Serialize)]
pub struct ConstellationResponse {
    pub abbr: String,
    pub segments: Vec<Vec<ConstellationSegmentPoint>>,
}

pub async fn get_constellation_boundaries(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    state
        .catalog_cache
        .constellation_boundaries()
        .response(&headers)
}

pub async fn get_constellations(State(state): State<AppState>, headers: HeaderMap) -> Response {
    state
        .catalog_cache
        .constellations(&state.hip_catalog)
        .response(&headers)
}

/// The IAU boundaries as polygons of unit vectors, sorted by constellation.
pub fn constellation_boundaries_payload() -> Vec<ConstellationResponse> {
    let boundaries = get_constellation_boundaries_data();
    let mut result: Vec<ConstellationResponse> = boundaries
        .iter()
        .map(|(abbr, polygons)| {
            let segments: Vec<Vec<ConstellationSegmentPoint>> = polygons
                .iter()
                .map(|polygon| {
                    polygon
                        .iter()
                        .map(|&[ra_deg, dec_deg]| {
                            let (x, y, z) =
                                ra_dec_to_unit_vector(ra_deg.to_radians(), dec_deg.to_radians());
                            ConstellationSegmentPoint { x, y, z }
                        })
                        .collect()
                })
                .collect();
            ConstellationResponse {
                abbr: abbr.clone(),
                segments,
            }
        })
        .collect();
    result.sort_by(|a, b| a.abbr.cmp(&b.abbr));
    result
}

/// The stick figures as polylines of unit vectors, sorted by constellation.
pub fn constellations_payload(catalog: &HipCatalog) -> Vec<ConstellationResponse> {
    let constellations = get_constellations_data();
    let stars = catalog.get_stars(7.5, None);
    let star_map: HashMap<i32, &Star> = stars.iter().map(|s| (s.hip_id, s)).collect();

    let mut result: Vec<ConstellationResponse> = constellations
        .iter()
        .filter_map(|(abbr, data)| {
            let segments: Vec<Vec<ConstellationSegmentPoint>> = data
                .lines
                .iter()
                .filter_map(|line| {
                    let points: Vec<ConstellationSegmentPoint> = line
                        .iter()
                        .filter_map(|&hip_id| {
                            star_map.get(&hip_id).map(|s| ConstellationSegmentPoint {
                                x: s.x,
                                y: s.y,
                                z: s.z,
                            })
                        })
                        .collect();
                    if points.len() >= 2 {
                        Some(points)
                    } else {
                        None
                    }
                })
                .collect();
            if segments.is_empty() {
                None
            } else {
                Some(ConstellationResponse {
                    abbr: abbr.clone(),
                    segments,
                })
            }
        })
        .collect();
    result.sort_by(|a, b| a.abbr.cmp(&b.abbr));
    result
}
