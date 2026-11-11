//! Every number that bounds what a request may ask for and what the server spends
//! on it, in one place: what a chart and a document may hold, how many are drawn
//! at once, and what an export costs against the budget (`crate::budget`).
//!
//! The checks themselves are where the requests are read (`crate::chart` and
//! `crate::document`); the messages they refuse with name these numbers.

// ---------------------------------------------------------------------------
// A chart.
// ---------------------------------------------------------------------------

/// Largest chart side a `view` may ask for; the preview's is about 1100 px.
pub(crate) const MAX_VIEW_SIZE_PX: f64 = 20_000.0;

/// Largest `view.px`: far beyond any real chart, it only keeps the numbers sane.
pub(crate) const MAX_VIEW_PX: f64 = 1000.0;

/// Rings on one chart: a finder card needs one.
pub(crate) const MAX_MARKS: usize = 16;

/// The faintest `magnitude_limit` a chart may ask for: past the catalogue's own.
pub(crate) const MAX_MAGNITUDE_LIMIT: f32 = 10.0;

// ---------------------------------------------------------------------------
// A document.
// ---------------------------------------------------------------------------

/// Pages in one document.
pub(crate) const MAX_PAGES: usize = 100;
/// Charts on one page.
pub(crate) const MAX_ITEMS_PER_PAGE: usize = 50;
/// Charts in the whole document. A chart costs about the same to draw whatever its
/// size (every star to the magnitude limit, roughly 1 MB of PDF), so the work and the
/// file are capped here: the page and item counts alone would allow 5000.
pub(crate) const MAX_CHARTS: usize = 200;
/// Blocks of text on one page.
pub(crate) const MAX_TEXTS_PER_PAGE: usize = 50;
/// Lines in one block of text: a page of 6 pt type is under 200, and a table is a
/// line a cell (40 rows of 8 columns under a header).
pub(crate) const MAX_LINES_PER_TEXT: usize = 400;
/// Rules in one block of text: a table has one over, under and below its header.
pub(crate) const MAX_RULES_PER_TEXT: usize = 100;
/// The thickest rule, mm.
pub(crate) const MAX_RULE_WIDTH_MM: f64 = 5.0;
/// Characters in one line: far more than a page is wide at any size worth reading.
pub(crate) const MAX_LINE_CHARS: usize = 400;
/// The smallest font size, mm: about 3 pt.
pub(crate) const MIN_TEXT_SIZE_MM: f64 = 1.0;
/// The largest font size, mm: about 280 pt.
pub(crate) const MAX_TEXT_SIZE_MM: f64 = 100.0;
/// Largest page or chart side in mm: past any printer, short of straining the renderer.
pub(crate) const MAX_SIDE_MM: f64 = 2000.0;
/// How far a chart may stick out of its page, in mm: rounding in the client's layout.
pub(crate) const PAGE_TOLERANCE_MM: f64 = 1.0;

/// Request body limit of `/api/export/document`: 200 charts (the most a document
/// holds) at about 1 KB of config each and 100 pages, with plenty of room.
pub(crate) const DOCUMENT_BODY_LIMIT_BYTES: usize = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Drawn at once.
// ---------------------------------------------------------------------------

/// Charts drawn at once outside a document. A PDF takes tens of ms of CPU and some
/// 10 MB while it is converted; the next ones wait their turn rather than pile up.
pub(crate) const CONCURRENT_CHARTS: usize = 4;

/// Documents converted at once; the next ones wait their turn instead of adding
/// another few hundred MB to the peak.
pub(crate) const CONCURRENT_DOCUMENTS: usize = 2;

// ---------------------------------------------------------------------------
// The export budget, in units; a unit is one chart sent as SVG.
// ---------------------------------------------------------------------------

/// Units for one chart drawn into a PDF, alone or in a document.
pub(crate) const PDF_CHART_COST: f64 = 4.0;
/// Units for one chart sent as SVG.
pub(crate) const SVG_CHART_COST: f64 = 1.0;

/// A client's burst: two full documents (200 charts each) back to back, or 1600
/// previews.
pub(crate) const CLIENT_BURST: f64 = 1600.0;
/// A client's steady rate, units per second: 900 PDF charts an hour.
pub(crate) const CLIENT_RATE: f64 = 1.0;
/// The server's burst: several clients at theirs.
pub(crate) const SERVER_BURST: f64 = 8000.0;
/// The server's steady rate, units per second: 1800 PDF charts an hour, roughly a
/// gigabyte of PDF, whoever asks and from however many addresses.
pub(crate) const SERVER_RATE: f64 = 2.0;
/// Clients remembered at once. Past this the idle ones are dropped, and if that is
/// not enough the newcomers share one bucket: the map cannot be grown without end.
pub(crate) const MAX_CLIENTS: usize = 4096;
