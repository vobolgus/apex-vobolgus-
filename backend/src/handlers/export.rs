use crate::AppState;
use crate::models::RenderConfig;
use crate::svg_generator::SvgGenerator;
use axum::{
    Json,
    extract::Query,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
};
use serde::Deserialize;

/// Largest chart side a `view` may ask for; the preview's is about 1100 px.
const MAX_VIEW_SIZE_PX: f64 = 20_000.0;

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
        return Err((
            StatusCode::BAD_REQUEST,
            "projection must be 'stereo' or 'pinhole'".to_string(),
        ));
    }
    if config.view.is_none() && (config.latitude.is_none() || config.longitude.is_none()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "latitude and longitude are required without a view".to_string(),
        ));
    }
    if let Some(latitude) = config.latitude
        && !(-90.0..=90.0).contains(&latitude)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "latitude must be in -90..=90".to_string(),
        ));
    }
    if let Some(longitude) = config.longitude
        && !(-180.0..=180.0).contains(&longitude)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "longitude must be in -180..=180".to_string(),
        ));
    }
    if let Some(view) = &config.view {
        if !(view.width <= MAX_VIEW_SIZE_PX && view.height <= MAX_VIEW_SIZE_PX) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("view width and height must be at most {MAX_VIEW_SIZE_PX} px"),
            ));
        }
        if SvgGenerator::view_projection(&config).is_none() {
            return Err((
                StatusCode::BAD_REQUEST,
                "view needs non-zero right, up and forward vectors, a positive size and a fov_deg \
                 the projection can show"
                    .to_string(),
            ));
        }
    }
    if let Some(max_mag) = config.magnitude_limit
        && !(0.0..=10.0).contains(&max_mag)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "magnitude_limit must be in 0..=10".to_string(),
        ));
    }

    // 1. Генерируем SVG
    let svg_str = SvgGenerator::render_map(&config, &state.hip_catalog);

    if query.format.as_deref() == Some("svg") {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("image/svg+xml; charset=utf-8"),
        );
        return Ok((headers, svg_str.into_bytes()));
    }

    // 2. Конвертируем в PDF через svg2pdf
    let mut options = svg2pdf::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();

    let tree = svg2pdf::usvg::Tree::from_str(&svg_str, &options).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("SVG parsing error: {}", e),
        )
    })?;

    let pdf_bytes = svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions::default(),
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("PDF conversion error: {}", e),
        )
    })?;

    // 3. Формируем заголовки ответа
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
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
    use crate::models::{LayersConfig, RenderConfig, StyleConfig};
    use std::sync::Arc;

    #[tokio::test]
    async fn test_export_pdf_stereo() {
        let state = AppState {
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
        };

        let config = RenderConfig {
            projection: "stereo".to_string(),
            datetime: Some("2026-05-20T12:00:00Z".to_string()),
            latitude: Some(55.75),
            longitude: Some(37.62),
            magnitude_limit: Some(6.0),
            fov_deg: Some(120.0),
            aspect_ratio: Some(1.0),
            constellation: None,
            center_direction: None,
            tilt_angle: Some(0.0),
            view: None,
            layers: LayersConfig {
                ecliptic: true,
                equator: true,
                galactic_equator: true,
                planets: true,
                horizontal_grid: true,
                equatorial_grid: true,
                constellations: true,
                constellation_boundaries: false,
                constellation_names: true,
                zenith: true,
                poles: true,
            },
            style: StyleConfig {
                star_color: "#FFFFFF".to_string(),
                constellation_line_color: "#808080".to_string(),
                grid_color: "#404040".to_string(),
                background_color: "#05050A".to_string(),
                chart_color: None,
                font_family: "sans-serif".to_string(),
                magnitude_scale: 1.0,
            },
            print_info: Some(true),
            footer_text: Some("Test Sky Map".to_string()),
        };

        let res = export_pdf(State(state), Query(ExportQuery::default()), Json(config)).await;
        assert!(res.is_ok());
        let (headers, pdf_bytes) = res.unwrap();
        assert_eq!(
            headers.get("content-type").unwrap().to_str().unwrap(),
            "application/pdf"
        );
        assert!(pdf_bytes.starts_with(b"%PDF-"));
    }

    #[tokio::test]
    async fn test_export_pdf_pinhole() {
        let state = AppState {
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
        };

        let config = RenderConfig {
            projection: "pinhole".to_string(),
            datetime: Some("2026-05-20T12:00:00Z".to_string()),
            latitude: Some(45.0),
            longitude: Some(19.0),
            magnitude_limit: Some(5.0),
            fov_deg: Some(60.0),
            aspect_ratio: Some(1.0),
            constellation: Some("ORI".to_string()),
            center_direction: None,
            tilt_angle: Some(0.0),
            view: None,
            layers: LayersConfig {
                ecliptic: false,
                equator: false,
                galactic_equator: false,
                planets: false, // intentional test fixture: verifies export path with planets layer disabled
                horizontal_grid: false,
                equatorial_grid: false,
                constellations: true,
                constellation_boundaries: false,
                constellation_names: false,
                zenith: false,
                poles: false,
            },
            style: StyleConfig {
                star_color: "#FFFFFF".to_string(),
                constellation_line_color: "#808080".to_string(),
                grid_color: "#404040".to_string(),
                background_color: "#05050A".to_string(),
                chart_color: None,
                font_family: "sans-serif".to_string(),
                magnitude_scale: 1.0,
            },
            print_info: Some(false),
            footer_text: None,
        };

        let res = export_pdf(State(state), Query(ExportQuery::default()), Json(config)).await;
        assert!(res.is_ok());
        let (headers, pdf_bytes) = res.unwrap();
        assert_eq!(
            headers.get("content-type").unwrap().to_str().unwrap(),
            "application/pdf"
        );
        assert!(pdf_bytes.starts_with(b"%PDF-"));
    }

    fn view_payload() -> serde_json::Value {
        serde_json::json!({
            "projection": "stereo",
            "fov_deg": 180.0,
            "view": {
                "right": [1.0, 0.0, 0.0],
                "up": [0.0, 1.0, 0.0],
                "forward": [0.0, 0.0, 1.0],
                "width": 1104.0,
                "height": 1104.0
            },
            "layers": {
                "ecliptic": true, "equator": true, "galactic_equator": true, "planets": false,
                "horizontal_grid": false, "equatorial_grid": false, "constellations": true,
                "constellation_boundaries": true, "constellation_names": false,
                "zenith": false, "poles": false
            },
            "style": {
                "star_color": "#000000", "constellation_line_color": "#000000",
                "grid_color": "#000000", "background_color": "#0a0a0b",
                "chart_color": "#ffffff", "font_family": "Inter", "magnitude_scale": 1.0
            }
        })
    }

    async fn export(
        payload: serde_json::Value,
        format: Option<&str>,
    ) -> Result<(HeaderMap, Vec<u8>), (StatusCode, String)> {
        let state = AppState {
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
        };
        let config: RenderConfig = serde_json::from_value(payload).unwrap();
        let query = ExportQuery {
            format: format.map(str::to_string),
        };
        export_pdf(State(state), Query(query), Json(config)).await
    }

    #[tokio::test]
    async fn a_view_needs_no_observer_and_exports_svg_and_pdf() {
        let (headers, body) = export(view_payload(), Some("svg")).await.unwrap();
        assert!(
            headers[header::CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with("image/svg+xml")
        );
        assert!(
            String::from_utf8(body)
                .unwrap()
                .contains(r##"viewBox="0 0 1104 1104""##)
        );

        let (_, pdf) = export(view_payload(), None).await.unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[tokio::test]
    async fn without_a_view_the_observer_is_required() {
        let mut payload = view_payload();
        payload.as_object_mut().unwrap().remove("view");
        let (status, _) = export(payload, Some("svg")).await.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn rejects_a_degenerate_or_oversized_view() {
        let mut zero_forward = view_payload();
        zero_forward["view"]["forward"] = serde_json::json!([0.0, 0.0, 0.0]);
        assert_eq!(
            export(zero_forward, Some("svg")).await.unwrap_err().0,
            StatusCode::BAD_REQUEST
        );

        let mut huge = view_payload();
        huge["view"]["width"] = serde_json::json!(1.0e6);
        assert_eq!(
            export(huge, Some("svg")).await.unwrap_err().0,
            StatusCode::BAD_REQUEST
        );

        let mut pinhole_too_wide = view_payload();
        pinhole_too_wide["projection"] = serde_json::json!("pinhole");
        assert_eq!(
            export(pinhole_too_wide, Some("svg")).await.unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
    }
}
