use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

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

    // Настройка CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(|| async { "Apex Backend is running!" }))
        // Catalog endpoints
        .route("/api/catalog/bright", get(handlers::catalog::get_bright_stars))
        .route("/api/catalog/full", get(handlers::catalog::get_full_stars))
        // Orbit simulation
        .route("/api/compute", post(handlers::simulation::compute_orbit))
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
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    println!("Listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
