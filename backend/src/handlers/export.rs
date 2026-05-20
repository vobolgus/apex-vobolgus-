use axum::{
    extract::Query,
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};
use crate::AppState;
use crate::models::RenderConfig;
use crate::svg_generator::SvgGenerator;
use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
pub struct ExportQuery {
    pub format: Option<String>,
}

pub async fn export_pdf(
    State(state): State<AppState>,
    Query(query): Query<ExportQuery>,
    Json(config): Json<RenderConfig>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, String)> {
    if config.projection != "stereo" && config.projection != "pinhole" {
        return Err((StatusCode::BAD_REQUEST, "projection must be 'stereo' or 'pinhole'".to_string()));
    }
    if !(-90.0..=90.0).contains(&config.latitude) {
        return Err((StatusCode::BAD_REQUEST, "latitude must be in -90..=90".to_string()));
    }
    if !(-180.0..=180.0).contains(&config.longitude) {
        return Err((StatusCode::BAD_REQUEST, "longitude must be in -180..=180".to_string()));
    }
    if let Some(max_mag) = config.magnitude_limit {
        if !(0.0..=10.0).contains(&max_mag) {
            return Err((StatusCode::BAD_REQUEST, "magnitude_limit must be in 0..=10".to_string()));
        }
    }

    // 1. Генерируем SVG
    let svg_str = SvgGenerator::render_map(
        &config,
        &state.hip_catalog,
        &state.messier_catalog,
        None,
        None,
    );

    if query.format.as_deref() == Some("svg") {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/svg+xml; charset=utf-8"));
        return Ok((headers, svg_str.into_bytes()));
    }

    // 2. Конвертируем в PDF через svg2pdf
    let mut options = svg2pdf::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();

    let tree = svg2pdf::usvg::Tree::from_str(&svg_str, &options)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("SVG parsing error: {}", e)))?;

    let pdf_bytes = svg2pdf::to_pdf(&tree, svg2pdf::ConversionOptions::default(), svg2pdf::PageOptions::default())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("PDF conversion error: {}", e)))?;

    // 3. Формируем заголовки ответа
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/pdf"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"sky_chart.pdf\""),
    );

    Ok((headers, pdf_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppState;
    use sqlx::SqlitePool;
    use std::sync::Arc;
    use crate::models::{RenderConfig, LayersConfig, StyleConfig};

    #[tokio::test]
    async fn test_export_pdf_stereo() {
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let state = AppState {
            db,
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
            messier_catalog: Arc::new(rust_core::catalog::MessierCatalog::new()),
        };

        let config = RenderConfig {
            projection: "stereo".to_string(),
            datetime: Some("2026-05-20T12:00:00Z".to_string()),
            latitude: 55.75,
            longitude: 37.62,
            magnitude_limit: Some(6.0),
            fov_deg: Some(120.0),
            aspect_ratio: Some(1.0),
            constellation: None,
            center_direction: None,
            tilt_angle: Some(0.0),
            layers: LayersConfig {
                ecliptic: true,
                equator: true,
                galactic_equator: true,
                planets: true,
                horizontal_grid: true,
                equatorial_grid: true,
                constellations: true,
                constellation_names: true,
                zenith: true,
                poles: true,
            },
            style: StyleConfig {
                star_color: "#FFFFFF".to_string(),
                constellation_line_color: "#808080".to_string(),
                grid_color: "#404040".to_string(),
                background_color: "#05050A".to_string(),
                font_family: "sans-serif".to_string(),
                magnitude_scale: 1.0,
            },
            print_info: Some(true),
            footer_text: Some("Test Sky Map".to_string()),
        };

        let res = export_pdf(State(state), Query(ExportQuery::default()), Json(config)).await;
        assert!(res.is_ok());
        let (headers, pdf_bytes) = res.unwrap();
        assert_eq!(headers.get("content-type").unwrap().to_str().unwrap(), "application/pdf");
        assert!(pdf_bytes.starts_with(b"%PDF-"));
    }

    #[tokio::test]
    async fn test_export_pdf_pinhole() {
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let state = AppState {
            db,
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
            messier_catalog: Arc::new(rust_core::catalog::MessierCatalog::new()),
        };

        let config = RenderConfig {
            projection: "pinhole".to_string(),
            datetime: Some("2026-05-20T12:00:00Z".to_string()),
            latitude: 45.0,
            longitude: 19.0,
            magnitude_limit: Some(5.0),
            fov_deg: Some(60.0),
            aspect_ratio: Some(1.0),
            constellation: Some("ORI".to_string()),
            center_direction: None,
            tilt_angle: Some(0.0),
            layers: LayersConfig {
                ecliptic: false,
                equator: false,
                galactic_equator: false,
                planets: false,
                horizontal_grid: false,
                equatorial_grid: false,
                constellations: true,
                constellation_names: false,
                zenith: false,
                poles: false,
            },
            style: StyleConfig {
                star_color: "#FFFFFF".to_string(),
                constellation_line_color: "#808080".to_string(),
                grid_color: "#404040".to_string(),
                background_color: "#05050A".to_string(),
                font_family: "sans-serif".to_string(),
                magnitude_scale: 1.0,
            },
            print_info: Some(false),
            footer_text: None,
        };

        let res = export_pdf(State(state), Query(ExportQuery::default()), Json(config)).await;
        assert!(res.is_ok());
        let (headers, pdf_bytes) = res.unwrap();
        assert_eq!(headers.get("content-type").unwrap().to_str().unwrap(), "application/pdf");
        assert!(pdf_bytes.starts_with(b"%PDF-"));
    }
}
