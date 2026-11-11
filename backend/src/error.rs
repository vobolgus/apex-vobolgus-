//! The one error a handler answers with.
//!
//! Each part of the server fails in its own type; a handler returns them all as
//! [`ApiError`], which knows the status of each and sends its message as the plain
//! text body.

use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use thiserror::Error;
use tokio::sync::AcquireError;
use tokio::task::JoinError;

use crate::budget::OverBudget;
use crate::chart::ChartError;
use crate::document::DocumentError;
use crate::pdf::PdfError;

/// Why a request was not answered with what it asked for.
#[derive(Debug, Error)]
pub(crate) enum ApiError {
    /// The chart asked for cannot be drawn: a 400 naming the setting at fault.
    #[error(transparent)]
    Chart(#[from] ChartError),
    /// The document asked for cannot be made: a 400 naming the page and the item.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// The export budget is spent: a 429 with `Retry-After`.
    #[error(transparent)]
    OverBudget(#[from] OverBudget),
    /// A chart's drawing was lost on the way: a 500.
    #[error("Export failed: {0}")]
    ChartLost(#[source] TaskError),
    /// A document's conversion was lost on the way: a 500.
    #[error("PDF export failed: {0}")]
    DocumentLost(#[source] TaskError),
    /// An SVG could not be packed: a 500.
    #[error("SVG compression error: {0}")]
    Compression(#[source] std::io::Error),
    /// An SVG did not become a PDF: a 500.
    #[error(transparent)]
    Pdf(#[from] PdfError),
}

/// How work sent to the blocking pool is lost: neither happens while the server runs
/// as it should.
#[derive(Debug, Error)]
pub(crate) enum TaskError {
    /// The semaphore the work waits its turn on was closed.
    #[error(transparent)]
    Permit(#[from] AcquireError),
    /// The work panicked or was cancelled.
    #[error(transparent)]
    Join(#[from] JoinError),
}

impl ApiError {
    /// The HTTP status this error is answered with.
    pub(crate) fn status(&self) -> StatusCode {
        match self {
            Self::Chart(_) | Self::Document(_) => StatusCode::BAD_REQUEST,
            Self::OverBudget(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::ChartLost(_) | Self::DocumentLost(_) | Self::Compression(_) | Self::Pdf(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = (self.status(), self.to_string());
        match self {
            Self::OverBudget(refused) => {
                let retry_after = HeaderValue::from(refused.retry_after_secs());
                (status, [(header::RETRY_AFTER, retry_after)], message).into_response()
            }
            _ => (status, message).into_response(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn the_429_says_when_to_come_back() {
        let refused = OverBudget {
            wait: Duration::from_secs_f64(12.3),
        };
        let response = ApiError::from(refused).into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[header::RETRY_AFTER], "13");
    }

    #[test]
    fn a_request_at_fault_is_a_400_and_the_server_s_own_failure_a_500() {
        let refused = ApiError::from(ChartError::UnknownProjection);
        assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            refused.to_string(),
            "projection must be 'stereo' or 'pinhole'"
        );
        let failed = ApiError::Compression(std::io::Error::other("disk"));
        assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(failed.to_string(), "SVG compression error: disk");
    }
}
