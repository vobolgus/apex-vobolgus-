//! The frontend, served by this same server.
//!
//! The page is a static build (`frontend/build`, SvelteKit's adapter-static): with
//! it here there is one service to run instead of a Node server next to this one,
//! and the page talks to `/api/*` on its own origin. The build ships every file
//! packed as well (`.br`, `.gz`), so a request is a file read and no compression.
//!
//! - `/_app/immutable/*` has a content hash in every name: cached for a year.
//! - Everything else (`index.html` above all) is revalidated on each visit, so a
//!   deploy shows at once; an unchanged file answers 304.
//! - A path that is no file gets the build's `404.html`, with status 404.

use std::path::Path;

use axum::Router;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::Response;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const REVALIDATE: &str = "no-cache";

/// `Cache-Control: value` on the responses that carry (or confirm) a file. A 404
/// is left alone: cached for a year, it would outlive the deploy that fixes it.
fn cache_control<B>(
    value: &'static str,
) -> SetResponseHeaderLayer<impl FnMut(&Response<B>) -> Option<HeaderValue> + Clone> {
    SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, move |response: &Response<B>| {
        let status = response.status();
        (status.is_success() || status == StatusCode::NOT_MODIFIED)
            .then(|| HeaderValue::from_static(value))
    })
}

/// Routes that serve the static build in `dir`, to be the app's fallback.
pub fn router<S: Clone + Send + Sync + 'static>(dir: &Path) -> Router<S> {
    let packed = |dir: &Path| ServeDir::new(dir).precompressed_br().precompressed_gzip();
    let immutable = packed(&dir.join("_app/immutable"));
    let site = packed(dir).not_found_service(ServeFile::new(dir.join("404.html")));
    Router::new()
        .nest_service(
            "/_app/immutable",
            tower::ServiceBuilder::new()
                .layer(cache_control(IMMUTABLE))
                .service(immutable),
        )
        .fallback_service(
            tower::ServiceBuilder::new()
                .layer(cache_control(REVALIDATE))
                .service(site),
        )
}
