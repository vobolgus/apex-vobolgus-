//! What every request handler shares.

use std::sync::Arc;

use rust_core::catalog::HipCatalog;
use tokio::sync::Semaphore;

use crate::budget::ExportBudget;
use crate::cached::CatalogCache;
use crate::limits::{CONCURRENT_CHARTS, CONCURRENT_DOCUMENTS};

/// The server's shared state: the star catalogue and what is kept beside it. Cheap
/// to clone, every handler gets its own handle on the same data.
#[derive(Clone)]
pub struct AppState {
    /// The Hipparcos stars every chart and catalogue answer is drawn from.
    pub(crate) hip_catalog: Arc<HipCatalog>,
    /// The catalog endpoints' answers, serialized and compressed once.
    pub(crate) catalog_cache: Arc<CatalogCache>,
    /// What the export endpoints may spend, per client and in all.
    pub(crate) export_budget: Arc<ExportBudget>,
    /// A permit a chart being drawn outside a document.
    pub(crate) chart_permits: Arc<Semaphore>,
    /// A permit a document being converted.
    pub(crate) document_permits: Arc<Semaphore>,
}

impl AppState {
    /// A server's state over `hip_catalog`: nothing cached yet, the export budget
    /// full, every permit free.
    #[must_use]
    pub fn new(hip_catalog: Arc<HipCatalog>) -> Self {
        Self {
            hip_catalog,
            catalog_cache: Arc::default(),
            export_budget: Arc::default(),
            chart_permits: Arc::new(Semaphore::new(CONCURRENT_CHARTS)),
            document_permits: Arc::new(Semaphore::new(CONCURRENT_DOCUMENTS)),
        }
    }

    /// Builds the catalogue answers now, so that no visitor waits for them.
    pub fn warm(&self) {
        self.catalog_cache.warm(&self.hip_catalog);
    }
}
