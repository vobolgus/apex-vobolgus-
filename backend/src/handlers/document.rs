//! `POST /api/export/document`: charts and text placed on pages, as one multi-page PDF.

use std::net::SocketAddr;

use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, header};
use axum::response::{IntoResponse, Response};

use super::{Download, headers, off_the_runtime};
use crate::budget::client_key;
use crate::document::Document;
use crate::error::ApiError;
use crate::limits::PDF_CHART_COST;
use crate::request::DocumentRequest;
use crate::state::AppState;

/// `POST /api/export/document`, charged to the export budget by its charts
/// (`crate::budget`) before anything is drawn.
pub(crate) async fn export_document(
    State(state): State<AppState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    request_headers: HeaderMap,
    Json(request): Json<DocumentRequest>,
) -> Result<Response, ApiError> {
    let client = client_key(&request_headers, peer.map(|ConnectInfo(address)| address));
    // An empty document is refused for free further on; anything else costs a chart at least.
    let cost = request.chart_count().max(1) as f64 * PDF_CHART_COST;
    state.export_budget.charge(&client, cost)?;
    let download = convert_off_the_runtime(state, request).await?;
    Ok(download.into_response())
}

/// The export itself, without the budget: validate, wait for a permit and convert
/// on the blocking pool. Up to 200 charts: the conversion is kept off the async
/// workers.
async fn convert_off_the_runtime(
    state: AppState,
    request: DocumentRequest,
) -> Result<Download, ApiError> {
    let document = Document::try_from(request)?;
    let permits = state.document_permits.clone();
    let pdf = off_the_runtime(permits, move || document.to_pdf(&state.hip_catalog))
        .await
        .map_err(ApiError::DocumentLost)??;

    let headers = headers([
        (header::CONTENT_TYPE, "application/pdf"),
        (
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"skycharts.pdf\"",
        ),
    ]);
    Ok((headers, pdf))
}

#[cfg(test)]
mod tests;
