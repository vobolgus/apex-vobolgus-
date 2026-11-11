//! The Skycharts server's binary: reads where to listen and what to serve from the
//! environment, loads the star catalogue and runs the app of the `backend` library.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;
use backend::AppState;
use rust_core::HipCatalog;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Initializing catalogs (it may take a few seconds)...");
    let hip_catalog = Arc::new(HipCatalog::new());
    println!("Catalogs loaded successfully.");

    let state = AppState::new(hip_catalog);
    // Built now, so the first visitor does not wait for the compression.
    state.warm();

    // The frontend's build, when this server is to serve the page too (the Docker
    // image sets it). A directory that is not there is a deploy gone wrong: say so
    // now rather than answer every visitor with a 404.
    let static_dir = std::env::var_os("STATIC_DIR").map(PathBuf::from);
    if let Some(dir) = &static_dir {
        anyhow::ensure!(
            dir.join("index.html").is_file(),
            "STATIC_DIR={} has no index.html",
            dir.display()
        );
        println!("Serving the frontend from {}", dir.display());
    }
    let app = backend::router(state, static_dir.as_deref());

    // The host names the port (Railway sets PORT); 8080 is the local default.
    let port = match std::env::var("PORT") {
        Ok(port) => port
            .parse::<u16>()
            .with_context(|| format!("PORT={port} is not a port number"))?,
        Err(_) => 8080,
    };
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind to {addr}"))?;
    // With the peer's address, for the export budget when no proxy reports one.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .context("axum server failed")?;
    Ok(())
}
