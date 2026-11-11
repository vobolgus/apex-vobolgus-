//! The Skycharts server: the star catalogues as JSON, a chart as SVG or PDF, a
//! document of charts and text as one multi-page PDF, and the page that asks for
//! them (the frontend's static build, when there is one to serve).
//!
//! The crate is the binary's library: [`router()`] is the whole app and [`AppState`]
//! what it runs on; `main` only reads the environment and listens.
//!
//! A request comes in through `router` and `middleware` to one of the `handlers`,
//! which read it as a `request` type and answer with a file or with the one
//! `error`. Behind them:
//!
//! - `chart` checks a chart request and draws it as SVG; `document` does the same
//!   for pages of charts and text; `svg` is what both write with, and `pdf` turns
//!   their SVG into the PDF that is sent.
//! - `payload` builds the catalogue answers and `cached` keeps them ready;
//!   `constellations` is the data both they and the charts read.
//! - `limits` holds every number that bounds a request, and `budget` rations the
//!   exports with them.
//! - `fonts` are the faces a PDF is set in, `static_site` the page itself.

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

// The pins are tables of cases, some a few hundred lines long, with small helpers
// that take a fixture whole: written to be read down, and not to be reshaped.
#[cfg(test)]
#[allow(
    clippy::format_push_string,
    clippy::needless_pass_by_value,
    clippy::needless_raw_string_hashes,
    clippy::too_many_lines
)]
mod golden;

pub use router::router;
pub use state::AppState;
