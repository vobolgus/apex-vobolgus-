//! The layers laid over the routes.

use axum::extract::DefaultBodyLimit;
use tower_http::cors::{Any, CorsLayer};

use crate::limits::DOCUMENT_BODY_LIMIT_BYTES;

/// Any origin may ask, with any method and any headers: the API holds nothing
/// private, and the page may be served from somewhere else (the Vite dev server).
pub(crate) fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
}

/// How much of a document request is read; see `DOCUMENT_BODY_LIMIT_BYTES`.
pub(crate) fn document_body_limit() -> DefaultBodyLimit {
    DefaultBodyLimit::max(DOCUMENT_BODY_LIMIT_BYTES)
}
