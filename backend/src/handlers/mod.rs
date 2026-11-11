//! The request handlers, one module per family of routes.

pub(crate) mod catalog;
pub(crate) mod document;
pub(crate) mod export;

use std::sync::Arc;

use axum::http::{HeaderMap, HeaderName, HeaderValue};
use tokio::sync::Semaphore;

use crate::error::TaskError;

/// A file on its way out: its headers and its bytes.
type Download = (HeaderMap, Vec<u8>);

/// Headers with fixed values, in the order given.
fn headers<const N: usize>(pairs: [(HeaderName, &'static str); N]) -> HeaderMap {
    pairs
        .into_iter()
        .map(|(name, value)| (name, HeaderValue::from_static(value)))
        .collect()
}

/// Waits for one of `permits`, then runs `work` on the blocking pool: drawing and
/// converting are CPU work, and on the async workers they would hold up every other
/// request.
///
/// A blocking task cannot be cancelled, so work started for a client that has gone
/// still holds its permit until it is done.
async fn off_the_runtime<T: Send + 'static>(
    permits: Arc<Semaphore>,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, TaskError> {
    let permit = permits.acquire_owned().await?;
    let done = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await?;
    Ok(done)
}
