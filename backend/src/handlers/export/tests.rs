use std::sync::Arc;

use axum::http::StatusCode;

use super::*;
use crate::request::{LayersConfig, RenderConfig, StyleConfig};

/// The export without the budget, as the handler runs it once a request is let through.
async fn export_as(config: RenderConfig, format: Format) -> Result<Download, ApiError> {
    let state = AppState::new(Arc::new(HipCatalog::new()));
    draw_off_the_runtime(state, config, format).await
}

#[tokio::test]
async fn test_export_pdf_stereo() {
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
            chart_outline: None,
            font_family: "sans-serif".to_string(),
            magnitude_scale: 1.0,
        },
        marks: vec![],
        print_info: Some(true),
        footer_text: Some("Test Sky Map".to_string()),
    };

    let res = export_as(config, Format::Pdf).await;
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
            chart_outline: None,
            font_family: "sans-serif".to_string(),
            magnitude_scale: 1.0,
        },
        marks: vec![],
        print_info: Some(false),
        footer_text: None,
    };

    let res = export_as(config, Format::Pdf).await;
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

async fn export(payload: serde_json::Value, format: Option<&str>) -> Result<Download, ApiError> {
    let config: RenderConfig = serde_json::from_value(payload).unwrap();
    let query = ExportQuery {
        format: format.map(str::to_string),
    };
    export_as(config, query.format(&HeaderMap::new())).await
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
            .contains(r#"viewBox="0 0 1104 1104""#)
    );

    let (_, pdf) = export(view_payload(), None).await.unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn without_a_view_the_observer_is_required() {
    let mut payload = view_payload();
    payload.as_object_mut().unwrap().remove("view");
    let refused = export(payload, Some("svg")).await.unwrap_err();
    assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rejects_a_degenerate_or_oversized_view() {
    let mut zero_forward = view_payload();
    zero_forward["view"]["forward"] = serde_json::json!([0.0, 0.0, 0.0]);
    assert_eq!(
        export(zero_forward, Some("svg"))
            .await
            .unwrap_err()
            .status(),
        StatusCode::BAD_REQUEST
    );

    let mut huge = view_payload();
    huge["view"]["width"] = serde_json::json!(1.0e6);
    assert_eq!(
        export(huge, Some("svg")).await.unwrap_err().status(),
        StatusCode::BAD_REQUEST
    );

    let mut pinhole_too_wide = view_payload();
    pinhole_too_wide["projection"] = serde_json::json!("pinhole");
    assert_eq!(
        export(pinhole_too_wide, Some("svg"))
            .await
            .unwrap_err()
            .status(),
        StatusCode::BAD_REQUEST
    );
}

#[test]
fn only_svg_by_name_is_the_svg() {
    let format = |name: Option<&str>| {
        ExportQuery {
            format: name.map(str::to_string),
        }
        .format(&HeaderMap::new())
    };
    assert_eq!(format(Some("svg")), Format::Svg(Packing::Plain));
    for other in [None, Some("pdf"), Some("SVG"), Some("")] {
        assert_eq!(format(other), Format::Pdf);
    }
    let takes_gzip: HeaderMap = [(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip"))]
        .into_iter()
        .collect();
    let query = |name: &str| ExportQuery {
        format: Some(name.to_owned()),
    };
    assert_eq!(query("svg").format(&takes_gzip), Format::Svg(Packing::Gzip));
    // Packing is the SVG's: a PDF is sent as it is, whatever the client takes.
    assert_eq!(query("pdf").format(&takes_gzip), Format::Pdf);
    assert!(Format::Pdf.cost() > Format::Svg(Packing::Plain).cost());
}
