//! A page of a document as SVG: its charts, and its text over them.

use rust_core::catalog::HipCatalog;

use super::Page;
use crate::fonts;
use crate::request::{DocumentText, TextAnchor, TextFont};
use crate::svg::{CharacterData, SvgWriter};

impl TextAnchor {
    /// The anchor as SVG's `text-anchor` names it.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Middle => "middle",
            Self::End => "end",
        }
    }
}

/// `font-weight` of the bold face, or of the regular one.
const fn font_weight(bold: bool) -> u16 {
    if bold { 700 } else { 400 }
}

/// A block of text as SVG: one `<text>` per line, black, in a bundled font, with its
/// rules, the block turned about its centre when it is.
fn write_text(svg: &mut SvgWriter, text: &DocumentText) {
    let family = match text.font {
        TextFont::Serif => fonts::SERIF,
        TextFont::Sans => fonts::SANS,
    };
    let weight = font_weight(text.bold);
    let style = if text.italic { "italic" } else { "normal" };
    let anchor = text.anchor.as_str();
    write!(
        svg,
        r##"<g font-family="{family}" font-size="{}" font-weight="{weight}" font-style="{style}" text-anchor="{anchor}" fill="#000000""##,
        text.size_mm
    );
    if text.rotation_deg != 0.0 {
        write!(
            svg,
            r#" transform="rotate({} {} {})""#,
            text.rotation_deg, text.cx_mm, text.cy_mm
        );
    }
    svg.push_str(">");
    for rule in &text.rules {
        write!(
            svg,
            r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#000000" stroke-width="{}" />"##,
            rule.x1_mm, rule.y1_mm, rule.x2_mm, rule.y2_mm, rule.width_mm
        );
    }
    for line in &text.lines {
        // Nothing to draw, and usvg would only carry an empty node along.
        if line.text.trim().is_empty() {
            continue;
        }
        write!(svg, r#"<text x="{}" y="{}""#, line.x_mm, line.y_mm);
        // A cell's own anchor and weight, where they differ from the block's.
        if let Some(own) = line.anchor.filter(|own| *own != text.anchor) {
            write!(svg, r#" text-anchor="{}""#, own.as_str());
        }
        if let Some(bold) = line.bold.filter(|bold| *bold != text.bold) {
            write!(svg, r#" font-weight="{}""#, font_weight(bold));
        }
        write!(
            svg,
            r#" xml:space="preserve">{}</text>"#,
            CharacterData(&line.text)
        );
    }
    svg.push_str("</g>");
}

impl Page {
    /// The page as SVG in mm: `viewBox` in mm and a physical size, each chart nested at
    /// its box under its own id prefix so the charts' clip paths cannot collide, and the
    /// text over them. `page_index` counts from 0; the ids count from 1.
    pub(crate) fn to_svg(&self, page_index: usize, catalog: &HipCatalog) -> String {
        let mut svg = SvgWriter::new();
        write!(
            svg,
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}mm" height="{h}mm">"#,
            w = self.width_mm,
            h = self.height_mm
        );
        for (item_index, item) in self.charts.iter().enumerate() {
            let id_prefix = format!("p{}c{}-", page_index + 1, item_index + 1);
            item.chart
                .write_nested(&mut svg, catalog, &id_prefix, item.placement);
        }
        for text in &self.texts {
            write_text(&mut svg, text);
        }
        svg.push_str("</svg>");
        svg.into()
    }
}
