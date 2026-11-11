//! `POST /api/export`: one chart, as PDF or as SVG.

use std::io::Write;
use std::net::SocketAddr;

use axum::Json;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use flate2::{Compression, write::GzEncoder};
use rust_core::HipCatalog;
use serde::Deserialize;
use tokio::sync::Semaphore;

use super::{Download, headers, off_the_runtime};
use crate::budget::client_key;
use crate::cached::accepts_gzip;
use crate::chart::Chart;
use crate::error::ApiError;
use crate::limits::{CONCURRENT_CHARTS, PDF_CHART_COST, SVG_CHART_COST};
use crate::pdf;
use crate::request::RenderConfig;
use crate::state::AppState;

static CHART_PERMITS: Semaphore = Semaphore::const_new(CONCURRENT_CHARTS);

/// The query of `/api/export`.
#[derive(Debug, Deserialize, Default)]
pub(crate) struct ExportQuery {
    /// `svg` asks for the SVG; anything else, or nothing, for the PDF.
    format: Option<String>,
}

/// What a chart is sent as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    /// A one-page PDF, to download.
    Pdf,
    /// The SVG itself.
    Svg,
}

impl ExportQuery {
    fn format(&self) -> Format {
        match self.format.as_deref() {
            Some("svg") => Format::Svg,
            _ => Format::Pdf,
        }
    }
}

impl Format {
    /// What one chart in this format takes from the export budget.
    const fn cost(self) -> f64 {
        match self {
            Self::Pdf => PDF_CHART_COST,
            Self::Svg => SVG_CHART_COST,
        }
    }
}

/// `POST /api/export`: the chart as PDF, or as SVG with `?format=svg`. It is
/// charged to the export budget first (`crate::budget`), and an SVG goes out
/// gzipped when the client takes gzip: it is text, a fifth of the size packed.
pub(crate) async fn export_chart(
    State(state): State<AppState>,
    Query(query): Query<ExportQuery>,
    peer: Option<ConnectInfo<SocketAddr>>,
    request_headers: HeaderMap,
    Json(config): Json<RenderConfig>,
) -> Result<Response, ApiError> {
    let format = query.format();
    let client = client_key(&request_headers, peer.map(|ConnectInfo(address)| address));
    state.export_budget.charge(&client, format.cost())?;
    let gzip = format == Format::Svg && accepts_gzip(&request_headers);
    let download = draw_off_the_runtime(state, config, format, gzip).await?;
    Ok(download.into_response())
}

/// The export itself, without the budget: validate, wait for a permit and draw on
/// the blocking pool.
async fn draw_off_the_runtime(
    state: AppState,
    config: RenderConfig,
    format: Format,
    gzip: bool,
) -> Result<Download, ApiError> {
    let chart = Chart::try_from(config)?;
    off_the_runtime(&CHART_PERMITS, move || {
        draw_chart(&chart, &state.hip_catalog, format, gzip)
    })
    .await
    .map_err(ApiError::ChartLost)?
}

fn draw_chart(
    chart: &Chart,
    hip_catalog: &HipCatalog,
    format: Format,
    gzip: bool,
) -> Result<Download, ApiError> {
    // 1. Генерируем SVG
    let svg = chart.to_svg(hip_catalog);

    match format {
        Format::Svg => {
            let mut headers = headers([
                (header::CONTENT_TYPE, "image/svg+xml; charset=utf-8"),
                // The body differs by Accept-Encoding whether or not this one is packed.
                (header::VARY, "accept-encoding"),
            ]);
            if !gzip {
                return Ok((headers, svg.into_bytes()));
            }
            // The default level: a chart is drawn per request, so the packing must stay
            // cheap next to the drawing (the catalogs, packed once, take the best level).
            let mut encoder =
                GzEncoder::new(Vec::with_capacity(svg.len() / 4), Compression::default());
            let packed = encoder
                .write_all(svg.as_bytes())
                .and_then(|()| encoder.finish())
                .map_err(ApiError::Compression)?;
            headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
            Ok((headers, packed))
        }
        Format::Pdf => {
            // 2. Конвертируем в PDF через svg2pdf
            let pdf = pdf::from_svg(&svg)?;
            // 3. Формируем заголовки ответа
            let headers = headers([
                (header::CONTENT_TYPE, "application/pdf"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=\"sky_chart.pdf\"",
                ),
            ]);
            Ok((headers, pdf))
        }
    }
}

#[cfg(test)]
mod tests;
