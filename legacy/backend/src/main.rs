// Extracted from backend/src/main.rs at 05becf9 — game (Sky Quiz), orbit simulation (AstraEtudes) and Messier-only parts. Full original: git show 05becf9:backend/src/main.rs
//
// Справочный фрагмент, не компилируется. Живой backend/src/main.rs оставил только
// GET /, каталог, созвездия и POST /api/export.
//
// Зависимости из backend/Cargo.toml, которые нужны были только этому коду
// (удалены из живого манифеста):
//   sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "macros", "migrate"] }
//   uuid = { version = "1.0", features = ["v4", "serde"] }
//   rand = "0.8"
//   tower-http feature "fs" (ServeDir для /images)

use std::path::{Path, PathBuf};
use tower_http::services::ServeDir;

mod db;
mod question_factory;
mod handlers {
    pub mod game;
    pub mod simulation;
}

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub hip_catalog: Arc<rust_core::catalog::HipCatalog>,
    pub messier_catalog: Arc<rust_core::catalog::MessierCatalog>,
}

fn messier_assets_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/messier")
}

fn build_app(state: AppState) -> Router {
    let images_dir = messier_assets_dir();

    // ... (CORS, GET /, каталог — остались в живом коде)

    Router::new()
        .nest_service("/images", ServeDir::new(images_dir))
        // Orbit simulation (spec uses GET, keep POST for compatibility)
        .route(
            "/api/compute",
            get(handlers::simulation::compute_orbit_get).post(handlers::simulation::compute_orbit),
        )
        // Game (Sky Quiz) endpoints
        .route("/game/api/modes", get(handlers::game::get_game_modes))
        .route("/game/api/start", post(handlers::game::start_game))
        .route("/game/api/question", get(handlers::game::get_question))
        .route("/game/api/answer", post(handlers::game::submit_answer))
        .route("/game/api/hint", get(handlers::game::get_hint))
        .route("/game/api/finish", post(handlers::game::finish_game))
    // ...
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Initializing catalogs (it may take a few seconds)...");
    let hip_catalog = Arc::new(rust_core::catalog::HipCatalog::new());
    let messier_catalog = Arc::new(rust_core::catalog::MessierCatalog::new());
    println!("Catalogs loaded successfully.");

    println!("Initializing database...");
    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://apex.db".to_string());
    let db_pool = db::init_db(&database_url).await?;
    println!("Database initialized successfully.");

    let state = AppState {
        db: db_pool,
        hip_catalog,
        messier_catalog,
    };

    // ... (bind 0.0.0.0:8080, axum::serve — остались в живом коде)
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
        let db = db::init_db("sqlite::memory:").await.unwrap();
        let state = AppState {
            db,
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
            messier_catalog: Arc::new(rust_core::catalog::MessierCatalog::new()),
        };
        build_app(state)
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
    async fn smoke_compute_get_validation_errors() {
        let app = test_app().await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/compute?r_x=7000&r_y=0&v_x=0&v_y=7.5&mu=398600.44&dt=0&steps=25")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn smoke_compute_post_endpoint() {
        let app = test_app().await;
        let body = json!({
            "r_x": 7000.0,
            "r_y": 0.0,
            "v_x": 0.0,
            "v_y": 7.546049108166282,
            "mu": 398600.44,
            "dt": 10.0,
            "steps": 25
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/compute")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn smoke_messier_images_available() {
        let messier_count = std::fs::read_dir(messier_assets_dir())
            .unwrap()
            .flatten()
            .filter(|e| {
                let name = e.file_name();
                let name = name.to_string_lossy();
                name.starts_with('m') && name.ends_with(".jpeg")
            })
            .count();
        assert_eq!(messier_count, 110);

        let app = test_app().await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/images/m31.jpeg")
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
        let start_payload: Value = serde_json::from_slice(
            &to_bytes(start_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
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
        let answer_payload: Value = serde_json::from_slice(
            &to_bytes(answer_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
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
        let finish_payload: Value = serde_json::from_slice(
            &to_bytes(finish_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(
            finish_payload
                .get("is_finished")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        );
    }

    #[tokio::test]
    async fn smoke_game_start_validation_errors() {
        let app = test_app().await;

        let start_body = json!({
            "mode": "trivia",
            "difficulty": "easy",
            "total_rounds": 0
        });
        let response = app
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
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
