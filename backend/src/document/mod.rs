//! A document: charts and text placed on pages, to be one multi-page PDF.
//!
//! A document starts as a `DocumentRequest`, the JSON a client sends.
//! [`Document::try_from`] checks it down to every chart and line of text; a
//! [`Document`] can only be one that can be made. Every page then becomes one SVG
//! in mm (`svg`), with each chart nested in its box and each line of text where
//! the client put it, and `crate::pdf` puts the pages into one file.

mod svg;

#[cfg(test)]
mod tests;

use rust_core::HipCatalog;
use thiserror::Error;

use crate::chart::{Chart, ChartError, Placement};
use crate::limits::{
    MAX_CHARTS, MAX_ITEMS_PER_PAGE, MAX_LINE_CHARS, MAX_LINES_PER_TEXT, MAX_PAGES,
    MAX_RULE_WIDTH_MM, MAX_RULES_PER_TEXT, MAX_SIDE_MM, MAX_TEXT_SIZE_MM, MAX_TEXTS_PER_PAGE,
    MIN_TEXT_SIZE_MM, PAGE_TOLERANCE_MM,
};
use crate::pdf::{self, PdfError, PdfPage};
use crate::request::{DocumentItem, DocumentPage, DocumentRequest, DocumentText};

/// Why a `DocumentRequest` is not a document. Each is the plain-text message of a
/// 400, naming the page and the item or text (1-based) at fault.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub(crate) enum DocumentError {
    /// No pages, or more than a document holds.
    #[error("a document needs 1 to {MAX_PAGES} pages, got {0}")]
    PageCount(usize),
    /// More charts on all the pages together than a document holds.
    #[error("a document holds at most {MAX_CHARTS} charts, got {0}")]
    TooManyCharts(usize),
    /// A page at fault.
    #[error("page {page}: {fault}")]
    Page {
        /// The page's number.
        page: usize,
        /// What is wrong with it.
        fault: PageError,
    },
    /// A chart at fault.
    #[error("page {page}, item {item}: {fault}")]
    Item {
        /// The page's number.
        page: usize,
        /// The chart's number on its page.
        item: usize,
        /// What is wrong with it.
        fault: ItemError,
    },
    /// A block of text at fault.
    #[error("page {page}, text {text}: {fault}")]
    Text {
        /// The page's number.
        page: usize,
        /// The text's number on its page.
        text: usize,
        /// What is wrong with it.
        fault: TextError,
    },
}

/// What can be wrong with a page as a whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub(crate) enum PageError {
    /// A side that is no length, or longer than a page may be.
    #[error("width_mm and height_mm must be positive and at most {MAX_SIDE_MM}")]
    Size,
    /// More charts than a page holds.
    #[error("at most {MAX_ITEMS_PER_PAGE} items, got {0}")]
    TooManyItems(usize),
    /// More blocks of text than a page holds.
    #[error("at most {MAX_TEXTS_PER_PAGE} texts, got {0}")]
    TooManyTexts(usize),
}

/// What can be wrong with a chart on a page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub(crate) enum ItemError {
    /// A side that is no length, or longer than a chart may be.
    #[error("width_mm and height_mm must be positive and at most {MAX_SIDE_MM}")]
    Size,
    /// The chart's box leaves its page by more than rounding.
    #[error("the chart must lie inside its page")]
    OutsidePage,
    /// No view: on a page a chart needs a size of its own.
    #[error("config needs a view")]
    NoView,
    /// The chart itself cannot be drawn.
    #[error(transparent)]
    Chart(#[from] ChartError),
}

/// What can be wrong with a block of text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub(crate) enum TextError {
    /// A font size out of range.
    #[error("size_mm must be in {MIN_TEXT_SIZE_MM}..={MAX_TEXT_SIZE_MM}")]
    Size,
    /// More lines than a text holds.
    #[error("at most {MAX_LINES_PER_TEXT} lines, got {0}")]
    TooManyLines(usize),
    /// A turn, or a centre of it, that is no number or is far off any page.
    #[error("rotation_deg, cx_mm and cy_mm must be finite and within ±{MAX_SIDE_MM}")]
    Turn,
    /// More rules than a text holds.
    #[error("at most {MAX_RULES_PER_TEXT} rules, got {0}")]
    TooManyRules(usize),
    /// The rule of this number has an end far off any page or no sane thickness.
    #[error(
        "rule {0}: needs finite ends within ±{MAX_SIDE_MM} and a width_mm in (0, {MAX_RULE_WIDTH_MM}]"
    )]
    Rule(usize),
    /// The line of this number starts off its page once the text is turned.
    #[error("line {0} must start inside its page")]
    LineOutsidePage(usize),
    /// A line longer than a line may be.
    #[error("line {line}: at most {MAX_LINE_CHARS} characters, got {chars}")]
    LineTooLong {
        /// The line's number in its text.
        line: usize,
        /// How many characters it has.
        chars: usize,
    },
}

/// A document that can be made: every page, chart and text has passed its checks.
#[derive(Debug, Clone)]
pub(crate) struct Document {
    pages: Vec<Page>,
}

/// One page of a document, in mm. An empty page is a blank page.
#[derive(Debug, Clone)]
pub(crate) struct Page {
    width_mm: f64,
    height_mm: f64,
    charts: Vec<PlacedChart>,
    /// Drawn over the charts.
    texts: Vec<DocumentText>,
}

/// A chart and its box on the page, mm from the page's top-left, y down.
#[derive(Debug, Clone)]
struct PlacedChart {
    placement: Placement,
    chart: Chart,
}

/// Every check before anything is drawn, in the order the messages are given.
impl TryFrom<DocumentRequest> for Document {
    type Error = DocumentError;

    fn try_from(request: DocumentRequest) -> Result<Self, Self::Error> {
        let pages = request.pages.len();
        if !(1..=MAX_PAGES).contains(&pages) {
            return Err(DocumentError::PageCount(pages));
        }
        let charts = request.chart_count();
        if charts > MAX_CHARTS {
            return Err(DocumentError::TooManyCharts(charts));
        }
        request
            .pages
            .into_iter()
            .enumerate()
            .map(|(page_index, page)| Page::read(page, page_index + 1))
            .collect::<Result<_, _>>()
            .map(|pages| Self { pages })
    }
}

fn valid_side(mm: f64) -> bool {
    mm.is_finite() && mm > 0.0 && mm <= MAX_SIDE_MM
}

impl Page {
    /// The page number `page_number` of a request, checked: its size, its charts,
    /// then its texts.
    fn read(page: DocumentPage, page_number: usize) -> Result<Self, DocumentError> {
        let (width_mm, height_mm) = (page.width_mm, page.height_mm);
        let at_fault = |fault| DocumentError::Page {
            page: page_number,
            fault,
        };
        if !(valid_side(width_mm) && valid_side(height_mm)) {
            return Err(at_fault(PageError::Size));
        }
        if page.items.len() > MAX_ITEMS_PER_PAGE {
            return Err(at_fault(PageError::TooManyItems(page.items.len())));
        }
        let charts = page
            .items
            .into_iter()
            .enumerate()
            .map(|(item_index, item)| {
                PlacedChart::read(item, width_mm, height_mm).map_err(|fault| DocumentError::Item {
                    page: page_number,
                    item: item_index + 1,
                    fault,
                })
            })
            .collect::<Result<_, _>>()?;
        if page.texts.len() > MAX_TEXTS_PER_PAGE {
            return Err(at_fault(PageError::TooManyTexts(page.texts.len())));
        }
        for (text_index, text) in page.texts.iter().enumerate() {
            check_text(text, width_mm, height_mm).map_err(|fault| DocumentError::Text {
                page: page_number,
                text: text_index + 1,
                fault,
            })?;
        }
        Ok(Self {
            width_mm,
            height_mm,
            charts,
            texts: page.texts,
        })
    }
}

impl PlacedChart {
    /// An item of a page of `page_width_mm` by `page_height_mm`, checked.
    fn read(
        item: DocumentItem,
        page_width_mm: f64,
        page_height_mm: f64,
    ) -> Result<Self, ItemError> {
        if !(valid_side(item.width_mm) && valid_side(item.height_mm)) {
            return Err(ItemError::Size);
        }
        let inside = item.x_mm >= -PAGE_TOLERANCE_MM
            && item.y_mm >= -PAGE_TOLERANCE_MM
            && item.x_mm + item.width_mm <= page_width_mm + PAGE_TOLERANCE_MM
            && item.y_mm + item.height_mm <= page_height_mm + PAGE_TOLERANCE_MM;
        if !inside {
            return Err(ItemError::OutsidePage);
        }
        if item.config.view.is_none() {
            return Err(ItemError::NoView);
        }
        Ok(Self {
            placement: Placement {
                x: item.x_mm,
                y: item.y_mm,
                width: item.width_mm,
                height: item.height_mm,
            },
            chart: Chart::try_from(item.config)?,
        })
    }
}

/// The checks of one block of text on a page of `page_width_mm` by `page_height_mm`.
fn check_text(
    text: &DocumentText,
    page_width_mm: f64,
    page_height_mm: f64,
) -> Result<(), TextError> {
    let near = |value: &f64| value.is_finite() && value.abs() <= MAX_SIDE_MM;
    if !(MIN_TEXT_SIZE_MM..=MAX_TEXT_SIZE_MM).contains(&text.size_mm) {
        return Err(TextError::Size);
    }
    if text.lines.len() > MAX_LINES_PER_TEXT {
        return Err(TextError::TooManyLines(text.lines.len()));
    }
    if ![text.rotation_deg, text.cx_mm, text.cy_mm].iter().all(near) {
        return Err(TextError::Turn);
    }
    if text.rules.len() > MAX_RULES_PER_TEXT {
        return Err(TextError::TooManyRules(text.rules.len()));
    }
    for (rule_index, rule) in text.rules.iter().enumerate() {
        let ends = [rule.x1_mm, rule.y1_mm, rule.x2_mm, rule.y2_mm];
        let sound =
            ends.iter().all(near) && rule.width_mm > 0.0 && rule.width_mm <= MAX_RULE_WIDTH_MM;
        if !sound {
            return Err(TextError::Rule(rule_index + 1));
        }
    }
    let (sin, cos) = text.rotation_deg.to_radians().sin_cos();
    for (line_index, line) in text.lines.iter().enumerate() {
        let line_number = line_index + 1;
        // Where the line starts once the text is turned. A baseline off the page is a
        // line nobody would see: the client leaves it out.
        let (dx, dy) = (line.x_mm - text.cx_mm, line.y_mm - text.cy_mm);
        let x_mm = text.cx_mm + dx * cos - dy * sin;
        let y_mm = text.cy_mm + dx * sin + dy * cos;
        let inside = x_mm >= -PAGE_TOLERANCE_MM
            && y_mm >= -PAGE_TOLERANCE_MM
            && x_mm <= page_width_mm + PAGE_TOLERANCE_MM
            && y_mm <= page_height_mm + PAGE_TOLERANCE_MM;
        if !inside {
            return Err(TextError::LineOutsidePage(line_number));
        }
        let chars = line.text.chars().count();
        if chars > MAX_LINE_CHARS {
            return Err(TextError::LineTooLong {
                line: line_number,
                chars,
            });
        }
    }
    Ok(())
}

impl Document {
    /// The pages, in order.
    #[cfg(test)]
    pub(crate) fn pages(&self) -> &[Page] {
        &self.pages
    }

    /// The whole document as PDF bytes: every page drawn as SVG and converted in
    /// turn, on a page of exactly the size asked for.
    pub(crate) fn to_pdf(&self, catalog: &HipCatalog) -> Result<Vec<u8>, PdfError> {
        pdf::from_pages(
            self.pages
                .iter()
                .enumerate()
                .map(|(page_index, page)| PdfPage {
                    width_mm: page.width_mm,
                    height_mm: page.height_mm,
                    svg: page.to_svg(page_index, catalog),
                }),
        )
    }
}
