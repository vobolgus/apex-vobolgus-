use anyhow::Context;
use axum::{
    Router,
    routing::{get, post},
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

mod models;
mod svg_generator;
mod handlers {
    pub mod catalog;
    pub mod export;
}

#[derive(Clone)]
pub struct AppState {
    pub hip_catalog: Arc<rust_core::catalog::HipCatalog>,
}

fn build_app(state: AppState) -> Router {
    // Настройка CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/", get(|| async { "Apex Backend is running!" }))
        // Catalog endpoints
        .route(
            "/api/catalog/bright",
            get(handlers::catalog::get_bright_stars),
        )
        .route("/api/catalog/full", get(handlers::catalog::get_full_stars))
        .route(
            "/api/constellations",
            get(handlers::catalog::get_constellations),
        )
        .route(
            "/api/constellation-boundaries",
            get(handlers::catalog::get_constellation_boundaries),
        )
        // PDF Export
        .route("/api/export", post(handlers::export::export_pdf))
        .layer(cors)
        .with_state(state)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Initializing catalogs (it may take a few seconds)...");
    let hip_catalog = Arc::new(rust_core::catalog::HipCatalog::new());
    println!("Catalogs loaded successfully.");

    let state = AppState { hip_catalog };

    let app = build_app(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    println!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind to {addr}"))?;
    axum::serve(listener, app)
        .await
        .context("axum server failed")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, to_bytes};
    use axum::http::header;
    use axum::http::{Request, StatusCode};
    use serde_json::Value;
    use serde_json::json;
    use tower::ServiceExt;

    async fn test_app() -> Router {
        let state = AppState {
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
        };
        build_app(state)
    }

    #[tokio::test]
    async fn smoke_health_endpoint() {
        let app = test_app().await;
        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn smoke_catalog_layered_loading_contract() {
        let app = test_app().await;

        let bright_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/catalog/bright")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bright_response.status(), StatusCode::OK);
        let bright_body = to_bytes(bright_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let bright_stars: Vec<Value> = serde_json::from_slice(&bright_body).unwrap();
        assert!(!bright_stars.is_empty());
        assert!(bright_stars.iter().all(|s| {
            s.get("v_mag")
                .and_then(Value::as_f64)
                .map(|v| v <= 4.0)
                .unwrap_or(false)
        }));

        let full_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/catalog/full")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(full_response.status(), StatusCode::OK);
        let full_body = to_bytes(full_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let full_stars: Vec<Value> = serde_json::from_slice(&full_body).unwrap();
        assert!(full_stars.len() > bright_stars.len());
    }

    #[tokio::test]
    async fn smoke_export_validation_errors() {
        let app = test_app().await;
        let base_payload = json!({
            "projection": "stereo",
            "datetime": "2026-05-20T12:00:00Z",
            "latitude": 55.75,
            "longitude": 37.62,
            "magnitude_limit": 6.0,
            "fov_deg": 120.0,
            "aspect_ratio": 1.0,
            "constellation": null,
            "tilt_angle": 0.0,
            "layers": {
                "ecliptic": true,
                "equator": false,
                "galactic_equator": false,
                "planets": false,
                "horizontal_grid": false,
                "equatorial_grid": false,
                "constellations": true,
                "constellation_names": false,
                "zenith": false,
                "poles": false
            },
            "style": {
                "star_color": "#FFFFFF",
                "constellation_line_color": "#808080",
                "grid_color": "#404040",
                "background_color": "#05050A",
                "font_family": "sans-serif",
                "magnitude_scale": 1.0
            },
            "print_info": false,
            "footer_text": null
        });

        let mut invalid_projection = base_payload.clone();
        invalid_projection["projection"] = json!("cylindric");
        let projection_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/export")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(invalid_projection.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(projection_response.status(), StatusCode::BAD_REQUEST);

        let mut invalid_latitude = base_payload.clone();
        invalid_latitude["latitude"] = json!(123.0);
        let latitude_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/export")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(invalid_latitude.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(latitude_response.status(), StatusCode::BAD_REQUEST);
    }
}
