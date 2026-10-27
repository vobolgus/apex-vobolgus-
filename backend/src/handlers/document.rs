//! `POST /api/export/document`: charts placed on pages, as one multi-page PDF.
//!
//! Every page becomes one SVG in mm with each chart nested in its box, is converted
//! with `svg2pdf::to_chunk`, and `pdf-writer` puts the chunks on pages of exactly the
//! requested size (`svg2pdf::to_pdf` only writes single-page files).

use std::collections::HashMap;
use std::fmt::Write;

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
};
use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, TextStr};
use rust_core::catalog::HipCatalog;
use tokio::sync::Semaphore;

use crate::AppState;
use crate::handlers::export::{svg_options, validate_config};
use crate::models::{DocumentPage, DocumentRequest};
use crate::svg_generator::{Placement, SvgGenerator};

const MAX_PAGES: usize = 100;
const MAX_ITEMS_PER_PAGE: usize = 50;
/// Charts in the whole document. A chart costs about the same to draw whatever its
/// size (every star to the magnitude limit, roughly 1 MB of PDF), so the work and the
/// file are capped here: the page and item counts alone would allow 5000.
const MAX_CHARTS: usize = 200;
/// Documents converted at once; the next ones wait their turn instead of adding
/// another few hundred MB to the peak.
const CONCURRENT_EXPORTS: usize = 2;

static EXPORT_PERMITS: Semaphore = Semaphore::const_new(CONCURRENT_EXPORTS);
/// Largest page or chart side in mm: past any printer, short of straining the renderer.
const MAX_SIDE_MM: f64 = 2000.0;
/// How far a chart may stick out of its page, in mm: rounding in the client's layout.
const PAGE_TOLERANCE_MM: f64 = 1.0;
/// PDF points per mm.
const PT_PER_MM: f64 = 72.0 / 25.4;

/// Name of a page's single XObject, the page SVG.
const PAGE_XOBJECT: Name<'static> = Name(b"S1");

fn valid_side(mm: f64) -> bool {
    mm.is_finite() && mm > 0.0 && mm <= MAX_SIDE_MM
}

/// Every check before anything is drawn. `Err` is the plain-text message of a 400,
/// naming the page and item (1-based) at fault.
pub(crate) fn validate_document(document: &DocumentRequest) -> Result<(), String> {
    let pages = document.pages.len();
    if !(1..=MAX_PAGES).contains(&pages) {
        return Err(format!(
            "a document needs 1 to {MAX_PAGES} pages, got {pages}"
        ));
    }
    let charts: usize = document.pages.iter().map(|page| page.items.len()).sum();
    if charts > MAX_CHARTS {
        return Err(format!(
            "a document holds at most {MAX_CHARTS} charts, got {charts}"
        ));
    }
    for (page_index, page) in document.pages.iter().enumerate() {
        let page_number = page_index + 1;
        if !(valid_side(page.width_mm) && valid_side(page.height_mm)) {
            return Err(format!(
                "page {page_number}: width_mm and height_mm must be positive and at most {MAX_SIDE_MM}"
            ));
        }
        if page.items.len() > MAX_ITEMS_PER_PAGE {
            return Err(format!(
                "page {page_number}: at most {MAX_ITEMS_PER_PAGE} items, got {}",
                page.items.len()
            ));
        }
        for (item_index, item) in page.items.iter().enumerate() {
            let at = format!("page {page_number}, item {}", item_index + 1);
            if !(valid_side(item.width_mm) && valid_side(item.height_mm)) {
                return Err(format!(
                    "{at}: width_mm and height_mm must be positive and at most {MAX_SIDE_MM}"
                ));
            }
            let inside = item.x_mm >= -PAGE_TOLERANCE_MM
                && item.y_mm >= -PAGE_TOLERANCE_MM
                && item.x_mm + item.width_mm <= page.width_mm + PAGE_TOLERANCE_MM
                && item.y_mm + item.height_mm <= page.height_mm + PAGE_TOLERANCE_MM;
            if !inside {
                return Err(format!("{at}: the chart must lie inside its page"));
            }
            if item.config.view.is_none() {
                return Err(format!("{at}: config needs a view"));
            }
            validate_config(&item.config).map_err(|message| format!("{at}: {message}"))?;
        }
    }
    Ok(())
}

/// One page as SVG in mm: `viewBox` in mm and a physical size, each chart nested at
/// its box under its own id prefix so the charts' clip paths cannot collide.
pub(crate) fn page_svg(page: &DocumentPage, page_index: usize, hip_catalog: &HipCatalog) -> String {
    let mut svg = String::new();
    let _ = write!(
        svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}mm" height="{h}mm">"##,
        w = page.width_mm,
        h = page.height_mm
    );
    for (item_index, item) in page.items.iter().enumerate() {
        let id_prefix = format!("p{}c{}-", page_index + 1, item_index + 1);
        let placement = Placement {
            x: item.x_mm,
            y: item.y_mm,
            width: item.width_mm,
            height: item.height_mm,
        };
        svg.push_str(&SvgGenerator::render_chart(
            &item.config,
            hip_catalog,
            &id_prefix,
            Some(placement),
        ));
    }
    svg.push_str("</svg>");
    svg
}

/// The whole document as PDF bytes; `Err` is the message of a 500.
pub(crate) fn document_pdf(
    document: &DocumentRequest,
    hip_catalog: &HipCatalog,
) -> Result<Vec<u8>, String> {
    // Loading the system fonts is the slow part of the options: once per document.
    let options = svg_options();
    let mut alloc = Ref::new(1);
    let catalog_id = alloc.bump();
    let page_tree_id = alloc.bump();
    let mut pdf = Pdf::new();
    let mut page_ids = Vec::with_capacity(document.pages.len());

    for (page_index, page) in document.pages.iter().enumerate() {
        let page_number = page_index + 1;
        let svg = page_svg(page, page_index, hip_catalog);
        let tree = svg2pdf::usvg::Tree::from_str(&svg, &options)
            .map_err(|e| format!("SVG parsing error on page {page_number}: {e}"))?;
        let (chunk, xobject) = svg2pdf::to_chunk(&tree, svg2pdf::ConversionOptions::default())
            .map_err(|e| format!("PDF conversion error on page {page_number}: {e}"))?;

        // Each chunk numbers its objects from 1: move them past everything so far.
        let mut renumbered = HashMap::new();
        let chunk = chunk.renumber(|old| *renumbered.entry(old).or_insert_with(|| alloc.bump()));
        let xobject = renumbered[&xobject];

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

pub async fn export_document(
    State(state): State<AppState>,
    Json(document): Json<DocumentRequest>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, String)> {
    validate_document(&document).map_err(|message| (StatusCode::BAD_REQUEST, message))?;

    // A blocking task cannot be cancelled, so a document converted for a client that
    // has gone still holds its permit until it is done.
    let permit = EXPORT_PERMITS.acquire().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("PDF export failed: {e}"),
        )
    })?;
    // Up to 200 charts: keep the conversion off the async workers.
    let hip_catalog = state.hip_catalog.clone();
    let pdf_bytes = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        document_pdf(&document, &hip_catalog)
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("PDF export failed: {e}"),
        )
    })?
    .map_err(|message| (StatusCode::INTERNAL_SERVER_ERROR, message))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"skycharts.pdf\""),
    );
    Ok((headers, pdf_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DocumentItem;
    use std::collections::HashSet;
    use std::sync::{Arc, OnceLock};

    fn hip_catalog() -> &'static HipCatalog {
        static HIP: OnceLock<HipCatalog> = OnceLock::new();
        HIP.get_or_init(HipCatalog::new)
    }

    /// What the document editor sends for a chart: a view sized in mm, stars at a
    /// fixed size on paper, paper styling.
    fn chart_config(projection: &str, width_mm: f64, height_mm: f64) -> serde_json::Value {
        let fov_deg = if projection == "stereo" { 120.0 } else { 70.0 };
        serde_json::json!({
            "projection": projection,
            "datetime": "2024-01-01T00:00:00Z",
            "magnitude_limit": 4.5,
            "fov_deg": fov_deg,
            "view": {
                "right": [0.0, 1.0, 0.0],
                "up": [0.0, 0.0, 1.0],
                "forward": [1.0, 0.0, 0.0],
                "width": width_mm,
                "height": height_mm,
                "px": 186.0 / 1104.0
            },
            "layers": {
                "ecliptic": true, "equator": true, "galactic_equator": false, "planets": true,
                "horizontal_grid": false, "equatorial_grid": false, "constellations": true,
                "constellation_boundaries": false, "constellation_names": false,
                "zenith": false, "poles": false
            },
            "style": {
                "star_color": "#000000", "constellation_line_color": "#000000",
                "grid_color": "#000000", "background_color": "none",
                "chart_color": "#ffffff", "chart_outline": "#c9ced6",
                "font_family": "Inter", "magnitude_scale": 1.0
            }
        })
    }

    fn item(x_mm: f64, y_mm: f64, width_mm: f64, height_mm: f64, projection: &str) -> DocumentItem {
        DocumentItem {
            x_mm,
            y_mm,
            width_mm,
            height_mm,
            config: serde_json::from_value(chart_config(projection, width_mm, height_mm)).unwrap(),
        }
    }

    fn a4(landscape: bool, items: Vec<DocumentItem>) -> DocumentPage {
        let (width_mm, height_mm) = if landscape {
            (297.0, 210.0)
        } else {
            (210.0, 297.0)
        };
        DocumentPage {
            width_mm,
            height_mm,
            items,
        }
    }

    fn two_page_document() -> DocumentRequest {
        DocumentRequest {
            pages: vec![
                a4(
                    false,
                    vec![
                        item(12.0, 12.0, 90.0, 90.0, "stereo"),
                        item(108.0, 12.0, 90.0, 60.0, "pinhole"),
                    ],
                ),
                a4(true, vec![]),
            ],
        }
    }

    fn rejected(document: &DocumentRequest) -> String {
        validate_document(document).expect_err("the document must be rejected")
    }

    #[test]
    fn accepts_a_document_with_charts_and_an_empty_page() {
        assert_eq!(validate_document(&two_page_document()), Ok(()));
    }

    #[test]
    fn rejects_no_pages_and_too_many() {
        assert!(rejected(&DocumentRequest { pages: vec![] }).contains("1 to 100 pages"));
        let pages = (0..=MAX_PAGES).map(|_| a4(false, vec![])).collect();
        assert!(rejected(&DocumentRequest { pages }).contains("got 101"));
        let pages = (0..MAX_PAGES).map(|_| a4(false, vec![])).collect();
        assert_eq!(validate_document(&DocumentRequest { pages }), Ok(()));
    }

    #[test]
    fn rejects_more_than_fifty_items_on_a_page() {
        let items = (0..=MAX_ITEMS_PER_PAGE)
            .map(|_| item(12.0, 12.0, 40.0, 40.0, "stereo"))
            .collect();
        let message = rejected(&DocumentRequest {
            pages: vec![a4(false, items)],
        });
        assert!(message.starts_with("page 1:") && message.contains("at most 50 items"));
    }

    #[test]
    fn rejects_more_than_two_hundred_charts_in_the_document() {
        let full_page = || {
            a4(
                false,
                (0..MAX_ITEMS_PER_PAGE)
                    .map(|_| item(12.0, 12.0, 40.0, 40.0, "stereo"))
                    .collect(),
            )
        };
        let mut pages: Vec<DocumentPage> = (0..MAX_CHARTS / MAX_ITEMS_PER_PAGE)
            .map(|_| full_page())
            .collect();
        pages.push(a4(true, vec![]));
        let mut document = DocumentRequest { pages };
        assert_eq!(validate_document(&document), Ok(()), "200 charts are fine");

        document.pages[4]
            .items
            .push(item(12.0, 12.0, 40.0, 40.0, "stereo"));
        assert_eq!(
            rejected(&document),
            "a document holds at most 200 charts, got 201"
        );
    }

    #[test]
    fn rejects_page_sizes_that_are_not_positive_finite_and_at_most_2000_mm() {
        for bad in [0.0, -210.0, f64::NAN, f64::INFINITY, 2000.5] {
            let mut document = two_page_document();
            document.pages[1].width_mm = bad;
            assert!(
                rejected(&document).starts_with("page 2:"),
                "width {bad} must be rejected"
            );
        }
        let mut document = two_page_document();
        document.pages[1].height_mm = 2000.0;
        assert_eq!(validate_document(&document), Ok(()));
    }

    #[test]
    fn rejects_item_sizes_that_are_not_positive_finite_and_at_most_2000_mm() {
        for bad in [0.0, -1.0, f64::NAN, 2001.0] {
            let mut document = two_page_document();
            document.pages[0].items[1].height_mm = bad;
            assert!(
                rejected(&document).starts_with("page 1, item 2:"),
                "height {bad} must be rejected"
            );
        }
    }

    #[test]
    fn items_must_lie_inside_their_page_within_a_millimetre() {
        let place = |x_mm: f64, y_mm: f64| DocumentRequest {
            pages: vec![a4(false, vec![item(x_mm, y_mm, 90.0, 90.0, "stereo")])],
        };
        // Up to 1 mm out on any side is rounding.
        for (x, y) in [(-1.0, 0.0), (0.0, -1.0), (121.0, 0.0), (0.0, 208.0)] {
            assert_eq!(validate_document(&place(x, y)), Ok(()), "({x}, {y}) is in");
        }
        for (x, y) in [
            (-1.5, 0.0),
            (0.0, -1.5),
            (121.5, 0.0),
            (0.0, 208.5),
            (f64::NAN, 0.0),
        ] {
            assert!(
                rejected(&place(x, y)).contains("inside its page"),
                "({x}, {y}) is out"
            );
        }
    }

    #[test]
    fn every_item_needs_a_view_and_a_valid_config() {
        let mut document = two_page_document();
        document.pages[0].items[0].config.view = None;
        // The observer would do for /api/export, but a page needs the chart's own size.
        document.pages[0].items[0].config.latitude = Some(55.0);
        document.pages[0].items[0].config.longitude = Some(37.0);
        assert_eq!(rejected(&document), "page 1, item 1: config needs a view");

        let mut document = two_page_document();
        document.pages[0].items[1].config.projection = "mercator".to_string();
        assert_eq!(
            rejected(&document),
            "page 1, item 2: projection must be 'stereo' or 'pinhole'"
        );

        for bad_px in [0.0, -1.0, 1000.5] {
            let mut document = two_page_document();
            document.pages[0].items[0].config.view.as_mut().unwrap().px = Some(bad_px);
            assert!(
                rejected(&document).starts_with("page 1, item 1: view px must be in (0, 1000]"),
                "px {bad_px} must be rejected"
            );
        }
    }

    fn ids(svg: &str) -> Vec<&str> {
        svg.split(" id=\"")
            .skip(1)
            .map(|rest| rest.split('"').next().unwrap())
            .collect()
    }

    #[test]
    fn page_svg_is_in_mm_and_nests_each_chart_at_its_box() {
        let document = two_page_document();
        let svg = page_svg(&document.pages[0], 0, hip_catalog());
        assert!(svg.starts_with(
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm">"##
        ));
        assert!(
            svg.contains(r##"<svg x="12" y="12" width="90" height="90" viewBox="0 0 90 90">"##)
        );
        assert!(
            svg.contains(r##"<svg x="108" y="12" width="90" height="60" viewBox="0 0 90 60">"##)
        );
        assert_eq!(svg.matches("<svg").count(), 3, "the page and two charts");
        assert_eq!(svg.matches("</svg>").count(), 3);
        assert!(svg.ends_with("</svg></svg>"));
        // Paper styling: no background rect, the sky filled white and outlined.
        assert!(!svg.contains(r##"fill="none" />"##));
        assert!(svg.contains(r##"fill="#ffffff""##));
        assert_eq!(svg.matches(r##"stroke="#c9ced6""##).count(), 2);

        let tree = svg2pdf::usvg::Tree::from_str(&svg, &svg_options()).unwrap();
        let px_per_mm = 96.0 / 25.4;
        assert!((tree.size().width() - 210.0 * px_per_mm).abs() < 0.01);
        assert!((tree.size().height() - 297.0 * px_per_mm).abs() < 0.01);
    }

    #[test]
    fn page_svg_ids_are_unique_and_every_reference_resolves() {
        let document = DocumentRequest {
            pages: vec![a4(
                false,
                vec![
                    item(12.0, 12.0, 90.0, 90.0, "stereo"),
                    item(108.0, 12.0, 90.0, 90.0, "stereo"),
                    item(12.0, 108.0, 90.0, 60.0, "pinhole"),
                ],
            )],
        };
        let svg = page_svg(&document.pages[0], 2, hip_catalog());
        let ids = ids(&svg);
        let unique: HashSet<&str> = ids.iter().copied().collect();
        assert_eq!(unique.len(), ids.len(), "duplicate ids in {ids:?}");
        for chart in 1..=3 {
            assert!(unique.contains(format!("p3c{chart}-sky-mask").as_str()));
        }
        // The view looks along the ecliptic at New Year 2024: planets are on it.
        assert!(ids.iter().any(|id| id.contains("-planet-")));
        for reference in svg.split("url(#").skip(1) {
            let id = reference.split(')').next().unwrap();
            assert!(unique.contains(id), "url(#{id}) has no target");
        }
    }

    #[test]
    fn an_empty_page_is_a_blank_page() {
        let svg = page_svg(&a4(true, vec![]), 0, hip_catalog());
        assert_eq!(
            svg,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="297mm" height="210mm"></svg>"##
        );
    }

    /// The media box of every page object, in file order (which is page order: they
    /// are written one after the other). Enough of a parser for pdf-writer's output,
    /// whose dictionaries are never compressed.
    fn page_media_boxes(pdf: &[u8]) -> Vec<[f64; 4]> {
        let text = String::from_utf8_lossy(pdf);
        let mut boxes = Vec::new();
        for (at, _) in text.match_indices("/Type /Page") {
            if text[at + "/Type /Page".len()..].starts_with('s') {
                continue; // the page tree, /Pages
            }
            let start = text[..at].rfind(" obj").expect("a page is an object");
            let end = at + text[at..].find("endobj").expect("objects end");
            let object = &text[start..end];
            let media_box = object
                .split("/MediaBox [")
                .nth(1)
                .and_then(|rest| rest.split(']').next())
                .unwrap_or_else(|| panic!("page without a media box: {object}"));
            let numbers: Vec<f64> = media_box
                .split_whitespace()
                .map(|n| n.parse().unwrap())
                .collect();
            boxes.push(numbers.try_into().expect("a media box has 4 numbers"));
        }
        boxes
    }

    fn assert_a4(media_box: [f64; 4], width_pt: f64, height_pt: f64) {
        let [x0, y0, x1, y1] = media_box;
        assert_eq!((x0, y0), (0.0, 0.0));
        assert!(
            (x1 - width_pt).abs() < 0.01 && (y1 - height_pt).abs() < 0.01,
            "media box {media_box:?}, expected {width_pt} × {height_pt}"
        );
    }

    #[tokio::test]
    async fn a_two_page_document_is_one_pdf_with_a_portrait_and_a_landscape_page() {
        let state = AppState {
            hip_catalog: Arc::new(HipCatalog::new()),
        };
        let (headers, pdf) = export_document(State(state), Json(two_page_document()))
            .await
            .unwrap();
        assert_eq!(headers[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(
            headers[header::CONTENT_DISPOSITION],
            "attachment; filename=\"skycharts.pdf\""
        );
        assert!(pdf.starts_with(b"%PDF-"));

        let boxes = page_media_boxes(&pdf);
        assert_eq!(boxes.len(), 2, "two pages");
        assert_a4(boxes[0], 595.28, 841.89);
        assert_a4(boxes[1], 841.89, 595.28);
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/Count 2"));
    }

    #[tokio::test]
    async fn an_invalid_document_is_a_400_with_a_message() {
        let state = AppState {
            hip_catalog: Arc::new(HipCatalog::new()),
        };
        let (status, message) =
            export_document(State(state), Json(DocumentRequest { pages: vec![] }))
                .await
                .unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(message.contains("pages"));
    }
}
