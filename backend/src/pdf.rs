//! SVG into PDF.
//!
//! A chart is one SVG and becomes a one-page PDF of its own size
//! (`svg2pdf::to_pdf`). A document is an SVG a page: each is converted with
//! `svg2pdf::to_chunk`, and `pdf-writer` puts the chunks on pages of exactly the
//! requested size (`svg2pdf::to_pdf` only writes single-page files).

use std::collections::HashMap;

use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, TextStr};
use svg2pdf::usvg;
use thiserror::Error;

use crate::fonts;

/// PDF points per mm.
const PT_PER_MM: f64 = 72.0 / 25.4;

/// Name of a page's single `XObject`, the page SVG.
const PAGE_XOBJECT: Name<'static> = Name(b"S1");

/// Why an SVG did not become a PDF. The SVG is the server's own, so each is the
/// message of a 500.
#[derive(Debug, Error)]
pub(crate) enum PdfError {
    /// A chart's SVG is not one usvg reads.
    #[error("SVG parsing error: {0}")]
    Parse(#[source] usvg::Error),
    /// A chart's SVG could not be converted.
    #[error("PDF conversion error: {0}")]
    Convert(svg2pdf::ConversionError),
    /// The SVG of a document's page (1-based) is not one usvg reads.
    #[error("SVG parsing error on page {page}: {source}")]
    ParsePage {
        /// The page's number.
        page: usize,
        /// What usvg made of it.
        source: usvg::Error,
    },
    /// The SVG of a document's page (1-based) could not be converted.
    #[error("PDF conversion error on page {page}: {reason}")]
    ConvertPage {
        /// The page's number.
        page: usize,
        /// What svg2pdf made of it.
        reason: svg2pdf::ConversionError,
    },
}

/// One page of a document on its way into a PDF.
pub(crate) struct PdfPage {
    /// The page's width, mm.
    pub(crate) width_mm: f64,
    /// The page's height, mm.
    pub(crate) height_mm: f64,
    /// What is on it.
    pub(crate) svg: String,
}

/// usvg options with the fonts a PDF is set in (`crate::fonts`), for turning SVG into PDF.
pub(crate) fn svg_options() -> usvg::Options<'static> {
    usvg::Options {
        fontdb: fonts::database(),
        ..Default::default()
    }
}

/// `svg` as a PDF of one page, the size the SVG says it is.
pub(crate) fn from_svg(svg: &str) -> Result<Vec<u8>, PdfError> {
    let tree = usvg::Tree::from_str(svg, &svg_options()).map_err(PdfError::Parse)?;
    svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions::default(),
    )
    .map_err(PdfError::Convert)
}

/// `pages` as one PDF, each on a page of its own size. A page is taken, converted
/// and let go before the next is asked for, so only one SVG is held at a time.
pub(crate) fn from_pages(pages: impl IntoIterator<Item = PdfPage>) -> Result<Vec<u8>, PdfError> {
    let options = svg_options();
    let mut alloc = Ref::new(1);
    let catalog_id = alloc.bump();
    let page_tree_id = alloc.bump();
    let mut pdf = Pdf::new();
    let mut page_ids = Vec::new();

    for (page_index, page) in pages.into_iter().enumerate() {
        let page_number = page_index + 1;
        let tree =
            usvg::Tree::from_str(&page.svg, &options).map_err(|source| PdfError::ParsePage {
                page: page_number,
                source,
            })?;
        let (chunk, xobject) = svg2pdf::to_chunk(&tree, svg2pdf::ConversionOptions::default())
            .map_err(|reason| PdfError::ConvertPage {
                page: page_number,
                reason,
            })?;

        // Each chunk numbers its objects from 1: move them past everything so far.
        let mut renumbered = HashMap::new();
        let chunk = chunk.renumber(|old| *renumbered.entry(old).or_insert_with(|| alloc.bump()));
        // The page's own XObject is one of the chunk's objects, so it has a new number.
        let xobject = *renumbered
            .get(&xobject)
            .expect("the page's XObject is one of the chunk's objects, all renumbered above");

        let page_id = alloc.bump();
        let content_id = alloc.bump();
        let width_pt = (page.width_mm * PT_PER_MM) as f32;
        let height_pt = (page.height_mm * PT_PER_MM) as f32;

        let mut pdf_page = pdf.page(page_id);
        pdf_page.media_box(Rect::new(0.0, 0.0, width_pt, height_pt));
        pdf_page.parent(page_tree_id);
        pdf_page.contents(content_id);
        pdf_page.resources().x_objects().pair(PAGE_XOBJECT, xobject);
        pdf_page.finish();

        // The XObject is 1 × 1 pt: stretch it over the media box.
        let mut content = Content::new();
        content
            .transform([width_pt, 0.0, 0.0, height_pt, 0.0, 0.0])
            .x_object(PAGE_XOBJECT);
        pdf.stream(content_id, &content.finish());
        pdf.extend(&chunk);
        page_ids.push(page_id);
    }

    pdf.catalog(catalog_id).pages(page_tree_id);
    pdf.pages(page_tree_id)
        .count(page_ids.len() as i32)
        .kids(page_ids);
    pdf.document_info(alloc.bump())
        .producer(TextStr("Skycharts"));
    Ok(pdf.finish())
}
