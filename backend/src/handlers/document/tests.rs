use std::sync::Arc;

use axum::http::StatusCode;
use rust_core::HipCatalog;
use serde_json::json;

use super::*;

/// The export without the budget, as the handler runs it once a request is let through.
async fn export(request: serde_json::Value) -> Result<Download, ApiError> {
    let state = AppState::new(Arc::new(HipCatalog::new()));
    let request: DocumentRequest = serde_json::from_value(request).unwrap();
    convert_off_the_runtime(state, request).await
}

#[tokio::test]
async fn a_document_goes_out_as_a_pdf_to_download() {
    let (headers, pdf) = export(json!({
        "pages": [{ "width_mm": 210, "height_mm": 297 }, { "width_mm": 297, "height_mm": 210 }]
    }))
    .await
    .unwrap();
    assert_eq!(headers[header::CONTENT_TYPE], "application/pdf");
    assert_eq!(
        headers[header::CONTENT_DISPOSITION],
        "attachment; filename=\"skycharts.pdf\""
    );
    assert!(pdf.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn an_invalid_document_is_a_400_with_a_message() {
    let refused = export(json!({ "pages": [] })).await.unwrap_err();
    assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
    assert!(refused.to_string().contains("pages"));
}
