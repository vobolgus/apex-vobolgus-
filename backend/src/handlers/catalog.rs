use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use crate::AppState;
use rust_core::catalog::Star;

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
