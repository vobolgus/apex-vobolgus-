//! What every request handler shares.

use std::sync::Arc;

use rust_core::HipCatalog;

use crate::budget::ExportBudget;
use crate::cached::CatalogCache;

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
}

impl AppState {
    /// A server's state over `hip_catalog`: nothing cached yet, the export budget full.
    #[must_use]
    pub fn new(hip_catalog: Arc<HipCatalog>) -> Self {
        Self {
            hip_catalog,
            catalog_cache: Arc::default(),
            export_budget: Arc::default(),
        }
    }

    /// Builds the catalogue answers now, so that no visitor waits for them.
    pub fn warm(&self) {
        self.catalog_cache.warm(&self.hip_catalog);
    }
}
