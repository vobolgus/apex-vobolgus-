use std::collections::HashSet;
use std::sync::OnceLock;

use svg2pdf::usvg;

use super::*;
use crate::chart::UnknownProjection;
use crate::pdf::svg_options;
use crate::request::{DocumentRule, DocumentTextLine, TextAnchor, TextFont};

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
        texts: vec![],
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

/// The checks of `document`: nothing, or the message it is refused with.
fn validate_document(document: &DocumentRequest) -> Result<(), String> {
    Document::try_from(document.clone())
        .map(drop)
        .map_err(|refusal| refusal.to_string())
}

fn rejected(document: &DocumentRequest) -> String {
    validate_document(document).expect_err("the document must be rejected")
}

/// The SVG of `page`, which must be one that passes the checks, as the page of
/// index `page_index` of its document.
fn page_svg(page: &DocumentPage, page_index: usize, hip_catalog: &HipCatalog) -> String {
    let document = Document::try_from(DocumentRequest {
        pages: vec![page.clone()],
    })
    .expect("the fixture is a page that can be made");
    document.pages()[0].to_svg(page_index, hip_catalog)
}

/// The PDF of `document`, which must be one that can be made.
fn pdf_of(document: DocumentRequest) -> Vec<u8> {
    Document::try_from(document)
        .expect("the fixture is a document that can be made")
        .to_pdf(hip_catalog())
        .expect("the document converts")
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
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm">"#
    ));
    assert!(svg.contains(r#"<svg x="12" y="12" width="90" height="90" viewBox="0 0 90 90">"#));
    assert!(svg.contains(r#"<svg x="108" y="12" width="90" height="60" viewBox="0 0 90 60">"#));
    assert_eq!(svg.matches("<svg").count(), 3, "the page and two charts");
    assert_eq!(svg.matches("</svg>").count(), 3);
    assert!(svg.ends_with("</svg></svg>"));
    // Paper styling: no background rect, the sky filled white and outlined.
    assert!(!svg.contains(r#"fill="none" />"#));
    assert!(svg.contains(r##"fill="#ffffff""##));
    assert_eq!(svg.matches(r##"stroke="#c9ced6""##).count(), 2);

    let tree = usvg::Tree::from_str(&svg, &svg_options()).unwrap();
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
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="297mm" height="210mm"></svg>"#
    );
}

fn line(x_mm: f64, y_mm: f64, text: &str) -> DocumentTextLine {
    DocumentTextLine {
        x_mm,
        y_mm,
        text: text.to_string(),
        anchor: None,
        bold: None,
    }
}

fn text(lines: Vec<DocumentTextLine>) -> DocumentText {
    DocumentText {
        font: TextFont::Serif,
        bold: false,
        italic: false,
        size_mm: 4.0,
        anchor: TextAnchor::Start,
        rotation_deg: 0.0,
        cx_mm: 0.0,
        cy_mm: 0.0,
        lines,
        rules: vec![],
    }
}

fn page_with_text(text: DocumentText) -> DocumentRequest {
    let mut page = a4(false, vec![]);
    page.texts.push(text);
    DocumentRequest { pages: vec![page] }
}

#[test]
fn text_is_read_with_its_defaults() {
    let page: DocumentPage = serde_json::from_value(serde_json::json!({
        "width_mm": 210, "height_mm": 297,
        "texts": [{ "font": "sans", "size_mm": 3.5, "lines": [{ "x_mm": 12, "y_mm": 20, "text": "Hi" }] }]
    }))
    .unwrap();
    assert!(page.items.is_empty());
    let text = &page.texts[0];
    assert_eq!(text.font, TextFont::Sans);
    assert_eq!(text.anchor, TextAnchor::Start);
    assert!(!text.bold && !text.italic);
    // A page from before text was: no `texts` at all.
    let old: DocumentPage =
        serde_json::from_value(serde_json::json!({ "width_mm": 210, "height_mm": 297 })).unwrap();
    assert!(old.texts.is_empty());
}

#[test]
fn rejects_text_out_of_bounds() {
    let ok = page_with_text(text(vec![line(12.0, 20.0, "Latitude")]));
    assert_eq!(validate_document(&ok), Ok(()));

    for size_mm in [0.0, 0.5, 100.5, f64::NAN] {
        let mut bad = text(vec![line(12.0, 20.0, "x")]);
        bad.size_mm = size_mm;
        assert!(
            rejected(&page_with_text(bad)).starts_with("page 1, text 1: size_mm must be in"),
            "size {size_mm} must be rejected"
        );
    }
    for (x, y) in [(-1.5, 20.0), (211.5, 20.0), (12.0, 298.5), (f64::NAN, 20.0)] {
        assert_eq!(
            rejected(&page_with_text(text(vec![
                line(12.0, 20.0, "in"),
                line(x, y, "out")
            ]))),
            "page 1, text 1: line 2 must start inside its page"
        );
    }
    let long = "я".repeat(MAX_LINE_CHARS + 1);
    assert!(
        rejected(&page_with_text(text(vec![line(12.0, 20.0, &long)])))
            .contains("at most 400 characters, got 401")
    );
    // Characters, not bytes: 400 Cyrillic letters are 800 bytes.
    let fits = "я".repeat(MAX_LINE_CHARS);
    assert_eq!(
        validate_document(&page_with_text(text(vec![line(12.0, 20.0, &fits)]))),
        Ok(())
    );
    let many = (0..=MAX_LINES_PER_TEXT)
        .map(|_| line(12.0, 20.0, "x"))
        .collect();
    assert!(rejected(&page_with_text(text(many))).contains("at most 400 lines"));

    let mut page = a4(false, vec![]);
    page.texts = (0..=MAX_TEXTS_PER_PAGE)
        .map(|_| text(vec![line(12.0, 20.0, "x")]))
        .collect();
    assert_eq!(
        rejected(&DocumentRequest { pages: vec![page] }),
        "page 1: at most 50 texts, got 51"
    );
}

#[test]
fn text_is_set_line_by_line_over_the_charts_in_a_bundled_font() {
    /// The glyph count of every text under `group`, in order.
    fn texts(group: &usvg::Group, glyphs: &mut Vec<usize>) {
        for node in group.children() {
            match node {
                usvg::Node::Group(group) => texts(group, glyphs),
                usvg::Node::Text(text) => glyphs.push(
                    text.layouted()
                        .iter()
                        .map(|span| span.positioned_glyphs.len())
                        .sum(),
                ),
                _ => {}
            }
        }
    }

    let mut page = a4(false, vec![item(12.0, 30.0, 90.0, 90.0, "stereo")]);
    page.texts.push(DocumentText {
        font: TextFont::Sans,
        bold: true,
        italic: true,
        size_mm: 4.5,
        anchor: TextAnchor::Middle,
        rotation_deg: 0.0,
        cx_mm: 0.0,
        cy_mm: 0.0,
        rules: vec![],
        lines: vec![
            line(105.0, 18.0, "φ < 56° & \"LST\""),
            line(105.0, 24.0, "   "),
            line(105.0, 30.0, "Широта\tи\u{7}время"),
        ],
    });
    let svg = page_svg(&page, 0, hip_catalog());
    let group = r##"<g font-family="PT Sans" font-size="4.5" font-weight="700" font-style="italic" text-anchor="middle" fill="#000000">"##;
    assert!(svg.contains(group), "{}", &svg[svg.len() - 400..]);
    assert!(
        svg.contains(r#"<text x="105" y="18" xml:space="preserve">φ &lt; 56° &amp; "LST"</text>"#)
    );
    // A blank line is not drawn; a control character is a space.
    assert_eq!(svg.matches("<text x=\"105\"").count(), 2);
    assert!(svg.contains(">Широта и время</text>"));
    // Over the charts: after the last of them.
    assert!(svg.find(group).unwrap() > svg.rfind("sky-mask").unwrap());
    assert!(svg.ends_with("</text></g></svg>"));

    let tree = usvg::Tree::from_str(&svg, &svg_options()).unwrap();
    let mut glyphs = Vec::new();
    texts(tree.root(), &mut glyphs);
    // Laid out: the font was found, or the lines would have no glyphs.
    assert_eq!(glyphs.len(), 2, "two lines drawn");
    assert!(glyphs.iter().all(|&count| count >= 14), "{glyphs:?}");
}

#[test]
fn a_turned_text_is_checked_and_drawn_where_the_turn_puts_it() {
    // Down the left margin: upright its lines would start 78 mm off the page.
    let mut sideways = text(vec![line(-78.0, 150.0, "Key: 56° N, 13h 45m")]);
    sideways.rotation_deg = -90.0;
    sideways.cx_mm = 15.0;
    sideways.cy_mm = 148.5;
    let document = page_with_text(sideways.clone());
    assert_eq!(validate_document(&document), Ok(()));
    let svg = page_svg(&document.pages[0], 0, hip_catalog());
    assert!(svg.contains(r##"fill="#000000" transform="rotate(-90 15 148.5)">"##));
    // An upright text has no transform at all.
    let upright = page_svg(
        &page_with_text(text(vec![line(12.0, 20.0, "x")])).pages[0],
        0,
        hip_catalog(),
    );
    assert!(!upright.contains("transform=\"rotate"));

    // The same lines, not turned, are off the page; so is a turn that throws them off.
    let mut flat = sideways.clone();
    flat.rotation_deg = 0.0;
    assert_eq!(
        rejected(&page_with_text(flat)),
        "page 1, text 1: line 1 must start inside its page"
    );
    let mut thrown = text(vec![line(12.0, 20.0, "x")]);
    thrown.rotation_deg = 180.0;
    thrown.cx_mm = 0.0;
    thrown.cy_mm = 0.0;
    assert!(rejected(&page_with_text(thrown)).contains("must start inside its page"));
    for bad in [f64::NAN, f64::INFINITY, 1e9] {
        let mut wild = text(vec![line(12.0, 20.0, "x")]);
        wild.rotation_deg = bad;
        assert!(
            rejected(&page_with_text(wild)).contains("rotation_deg, cx_mm and cy_mm"),
            "{bad} must be rejected"
        );
    }
}

#[test]
fn a_table_is_cells_with_their_own_anchor_and_weight_and_its_rules() {
    let mut table = text(vec![
        line(12.0, 100.0, "Name"),
        line(90.0, 100.0, "Mag"),
        line(12.0, 106.0, "Orion Nebula"),
        line(90.0, 106.0, "4.0"),
    ]);
    table.lines[0].bold = Some(true);
    table.lines[1].bold = Some(true);
    table.lines[1].anchor = Some(TextAnchor::End);
    table.lines[3].anchor = Some(TextAnchor::End);
    // The block's own anchor and weight, named again, add nothing to the cell.
    table.lines[2].anchor = Some(TextAnchor::Start);
    table.lines[2].bold = Some(false);
    table.rules = vec![DocumentRule {
        x1_mm: 12.0,
        y1_mm: 101.5,
        x2_mm: 90.0,
        y2_mm: 101.5,
        width_mm: 0.2,
    }];
    table.rotation_deg = 90.0;
    table.cx_mm = 51.0;
    table.cy_mm = 103.0;
    let document = page_with_text(table.clone());
    assert_eq!(validate_document(&document), Ok(()));
    let svg = page_svg(&document.pages[0], 0, hip_catalog());
    assert!(
        svg.contains(r#"<text x="12" y="100" font-weight="700" xml:space="preserve">Name</text>"#)
    );
    assert!(svg.contains(
        r#"<text x="90" y="100" text-anchor="end" font-weight="700" xml:space="preserve">Mag</text>"#
    ));
    assert!(svg.contains(r#"<text x="12" y="106" xml:space="preserve">Orion Nebula</text>"#));
    assert!(
        svg.contains(r#"<text x="90" y="106" text-anchor="end" xml:space="preserve">4.0</text>"#)
    );
    // The rule is in the text's own group, so it turns with the text.
    let rule =
        r##"<line x1="12" y1="101.5" x2="90" y2="101.5" stroke="#000000" stroke-width="0.2" />"##;
    let group = svg.find(r#"transform="rotate(90 51 103)">"#).unwrap();
    assert!(svg.find(rule).unwrap() > group);
    assert!(svg.find(rule).unwrap() < svg.rfind("</g>").unwrap());

    for (width_mm, x2_mm) in [(0.0, 90.0), (5.5, 90.0), (0.2, f64::NAN)] {
        let mut bad = table.clone();
        bad.rules[0].width_mm = width_mm;
        bad.rules[0].x2_mm = x2_mm;
        assert!(rejected(&page_with_text(bad)).starts_with("page 1, text 1: rule 1: needs"));
    }
    let mut many = table.clone();
    many.rules = vec![table.rules[0].clone(); MAX_RULES_PER_TEXT + 1];
    assert!(rejected(&page_with_text(many)).contains("at most 100 rules"));
    // A text from before tables were has no rules, and its lines no anchor of their own.
    let old: DocumentText = serde_json::from_value(serde_json::json!({
        "font": "serif", "size_mm": 4.0, "lines": [{ "x_mm": 12, "y_mm": 20, "text": "x" }]
    }))
    .unwrap();
    assert!(old.rules.is_empty());
    assert!(old.lines[0].anchor.is_none() && old.lines[0].bold.is_none());
}

#[test]
fn a_page_of_text_is_a_pdf_with_its_font_embedded() {
    let document = page_with_text(text(vec![line(12.0, 20.0, "Широта: 56° N")]));
    let pdf = pdf_of(document);
    let body = String::from_utf8_lossy(&pdf);
    assert!(body.contains("/Type /Font"), "no font in the PDF");
    assert!(body.contains("PTSerif"), "not set in PT Serif");
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

#[test]
fn a_two_page_document_is_one_pdf_with_a_portrait_and_a_landscape_page() {
    let pdf = pdf_of(two_page_document());
    assert!(pdf.starts_with(b"%PDF-"));

    let boxes = page_media_boxes(&pdf);
    assert_eq!(boxes.len(), 2, "two pages");
    assert_a4(boxes[0], 595.28, 841.89);
    assert_a4(boxes[1], 841.89, 595.28);
    let text = String::from_utf8_lossy(&pdf);
    assert!(text.contains("/Count 2"));
}

#[test]
fn a_refusal_names_the_page_and_what_is_on_it() {
    let refusal = DocumentError::Item {
        page: 3,
        item: 2,
        fault: ItemError::Chart(ChartError::UnknownProjection(UnknownProjection)),
    };
    assert_eq!(
        refusal.to_string(),
        "page 3, item 2: projection must be 'stereo' or 'pinhole'"
    );
    let mut document = two_page_document();
    document.pages[0].items[1].config.projection = "mercator".to_string();
    assert_eq!(
        Document::try_from(document).unwrap_err(),
        DocumentError::Item {
            page: 1,
            item: 2,
            fault: ItemError::Chart(ChartError::UnknownProjection(UnknownProjection)),
        }
    );
    assert_eq!(
        Document::try_from(DocumentRequest { pages: vec![] }).unwrap_err(),
        DocumentError::PageCount(0)
    );
}
