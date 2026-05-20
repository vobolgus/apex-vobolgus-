use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

mod db;
mod models;
mod question_factory;
mod svg_generator;
mod handlers {
    pub mod catalog;
    pub mod simulation;
    pub mod game;
    pub mod export;
}

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub hip_catalog: Arc<rust_core::catalog::HipCatalog>,
    pub messier_catalog: Arc<rust_core::catalog::MessierCatalog>,
}

fn build_app(state: AppState) -> Router {
    let static_dir = if Path::new("web/static").exists() {
        "web/static"
    } else {
        "../web/static"
    };

    // Настройка CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/", get(|| async { "Apex Backend is running!" }))
        .nest_service("/static", ServeDir::new(static_dir))
        // Catalog endpoints
        .route("/api/catalog/bright", get(handlers::catalog::get_bright_stars))
        .route("/api/catalog/full", get(handlers::catalog::get_full_stars))
        // Orbit simulation (spec uses GET, keep POST for compatibility)
        .route(
            "/api/compute",
            get(handlers::simulation::compute_orbit_get).post(handlers::simulation::compute_orbit),
        )
        // PDF Export
        .route("/api/export", post(handlers::export::export_pdf))
        // Game (Sky Quiz) endpoints
        .route("/game/api/modes", get(handlers::game::get_game_modes))
        .route("/game/api/start", post(handlers::game::start_game))
        .route("/game/api/question", get(handlers::game::get_question))
        .route("/game/api/answer", post(handlers::game::submit_answer))
        .route("/game/api/hint", get(handlers::game::get_hint))
        .route("/game/api/finish", post(handlers::game::finish_game))
        .layer(cors)
        .with_state(state)
}

#[tokio::main]
async fn main() {
    println!("Initializing catalogs (it may take a few seconds)...");
    let hip_catalog = Arc::new(rust_core::catalog::HipCatalog::new());
    let messier_catalog = Arc::new(rust_core::catalog::MessierCatalog::new());
    println!("Catalogs loaded successfully.");

    println!("Initializing database...");
    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://apex.db".to_string());
    let db_pool = db::init_db(&database_url).await;
    println!("Database initialized successfully.");

    let state = AppState {
        db: db_pool,
        hip_catalog,
        messier_catalog,
    };

    let app = build_app(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    println!("Listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::http::header;
    use serde_json::json;
    use serde_json::Value;
    use tower::ServiceExt;

    async fn test_app() -> Router {
        let db = db::init_db("sqlite::memory:").await;
        let state = AppState {
            db,
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
            messier_catalog: Arc::new(rust_core::catalog::MessierCatalog::new()),
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
        let bright_body = to_bytes(bright_response.into_body(), usize::MAX).await.unwrap();
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
        let full_body = to_bytes(full_response.into_body(), usize::MAX).await.unwrap();
        let full_stars: Vec<Value> = serde_json::from_slice(&full_body).unwrap();
        assert!(full_stars.len() > bright_stars.len());
    }

    #[tokio::test]
    async fn smoke_compute_get_endpoint_from_spec() {
        let app = test_app().await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/compute?r_x=7000&r_y=0&v_x=0&v_y=7.546049108166282&mu=398600.44&dt=10&steps=25")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        let trajectory_len = payload
            .get("trajectory")
            .and_then(Value::as_array)
            .map(|arr| arr.len())
            .unwrap_or_default();
        assert_eq!(trajectory_len, 26);
        assert!(payload.get("semi_major_axis").is_some());
        assert!(payload.get("eccentricity").is_some());
        assert!(payload.get("specific_energy").is_some());
    }

    #[tokio::test]
    async fn smoke_static_assets_served() {
        let app = test_app().await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/static/index.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn smoke_game_http_flow() {
        let app = test_app().await;

        let start_body = json!({
            "mode": "trivia",
            "difficulty": "easy",
            "total_rounds": 2
        });
        let start_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/game/api/start")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(start_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(start_response.status(), StatusCode::OK);
        let start_payload: Value =
            serde_json::from_slice(&to_bytes(start_response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let session_id = start_payload
            .get("session_id")
            .and_then(Value::as_str)
            .unwrap()
            .to_string();

        let question_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/game/api/question?session_id={session_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(question_response.status(), StatusCode::OK);

        let hint_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/game/api/hint?session_id={session_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(hint_response.status(), StatusCode::OK);

        let answer_body = json!({
            "session_id": session_id,
            "answer": "__definitely_wrong_answer__",
            "time_spent": 6.0
        });
        let answer_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/game/api/answer")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(answer_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(answer_response.status(), StatusCode::OK);
        let answer_payload: Value =
            serde_json::from_slice(&to_bytes(answer_response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(answer_payload.get("correct").is_some());
        assert!(answer_payload.get("current_score").is_some());

        let finish_body = json!({
            "session_id": answer_body["session_id"]
        });
        let finish_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/game/api/finish")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(finish_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(finish_response.status(), StatusCode::OK);
        let finish_payload: Value =
            serde_json::from_slice(&to_bytes(finish_response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(
            finish_payload
                .get("is_finished")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            true
        );
    }
}
