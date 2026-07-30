use crate::AppState;
use crate::svg_generator::{get_constellation_boundaries_data, get_constellations_data};
use axum::{
    Json,
    extract::{Query, State},
};
use rust_core::catalog::Star;
use rust_core::coords::ra_dec_to_unit_vector;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct CatalogQuery {
    pub max_mag: Option<f32>,
    pub min_mag: Option<f32>,
}

pub async fn get_bright_stars(
    State(state): State<AppState>,
    Query(query): Query<CatalogQuery>,
) -> Json<Vec<Star>> {
    let max_mag = query.max_mag.unwrap_or(4.0);
    let min_mag = query.min_mag;

    let stars = state.hip_catalog.get_stars(max_mag, min_mag);
    Json(stars)
}

pub async fn get_full_stars(
    State(state): State<AppState>,
    Query(query): Query<CatalogQuery>,
) -> Json<Vec<Star>> {
    let max_mag = query.max_mag.unwrap_or(6.5);
    let min_mag = query.min_mag;

    let stars = state.hip_catalog.get_stars(max_mag, min_mag);
    Json(stars)
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

pub async fn get_constellation_boundaries() -> Json<Vec<ConstellationResponse>> {
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
    Json(result)
}

pub async fn get_constellations(State(state): State<AppState>) -> Json<Vec<ConstellationResponse>> {
    let constellations = get_constellations_data();
    let stars = state.hip_catalog.get_stars(7.5, None);
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
    Json(result)
}
