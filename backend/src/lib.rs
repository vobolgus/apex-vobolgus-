//! The Skycharts server: the star catalogues as JSON, a chart as SVG or PDF, a
//! document of charts and text as one multi-page PDF, and the page that asks for
//! them (the frontend's static build, when there is one to serve).
//!
//! The crate is the binary's library: [`router`] is the whole app and [`AppState`]
//! what it runs on; `main` only reads the environment and listens.

// The workspace's pedantic lints and missing docs: lifted in the backend step.
#![allow(clippy::pedantic, missing_docs)]

mod budget;
mod cached;
mod chart;
mod constellations;
mod document;
mod error;
mod fonts;
mod handlers;
mod limits;
mod middleware;
mod payload;
mod pdf;
mod request;
mod router;
mod state;
mod static_site;
mod svg;

#[cfg(test)]
mod golden;

pub use router::router;
pub use state::AppState;
