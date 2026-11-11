//! What a client sends: the JSON bodies of the export routes, as they are on the
//! wire.
//!
//! These types only say what the JSON looks like. Nothing here is checked yet: a
//! chart is checked when it becomes a `crate::chart::Chart`, a document when it
//! becomes a `crate::document::Document`.
//!
//! The page's TypeScript is written from these same types (`crate::wire`), which is
//! what the `ts` attributes are for. They say what the JSON reader takes: an
//! `Option` may be left out or be `null`, and a field with a default may be left
//! out, which `ts-rs` has to be told by calling it an `Option`.

use serde::Deserialize;

/// One chart, as `POST /api/export` takes it and as a document carries it.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct RenderConfig {
    /// `"stereo"` or `"pinhole"`. Text here, so that any other name is refused by
    /// the chart's own check with its own message, and not by the JSON reader.
    #[cfg_attr(test, ts(as = "crate::chart::Projection"))]
    pub(crate) projection: String,
    /// The instant the planets are placed at and the horizon chart is turned to:
    /// RFC 3339, `YYYY-MM-DD HH:MM:SS` or a bare date, read as UTC.
    pub(crate) datetime: Option<String>,
    /// Observer position. Orients the chart when there is no `view`, so it is
    /// required then; with a `view` it is unused.
    pub(crate) latitude: Option<f32>,
    /// The observer's longitude, degrees east.
    pub(crate) longitude: Option<f32>,
    /// The faintest star drawn, in visual magnitude.
    pub(crate) magnitude_limit: Option<f32>,
    /// With a `view`: across the disc for "stereo", horizontal for "pinhole".
    /// Without one, pinhole only, across the frame diagonal.
    pub(crate) fov_deg: Option<f32>,
    /// Width over height of a pinhole chart without a `view`.
    pub(crate) aspect_ratio: Option<f32>,
    /// The one constellation whose figure, boundary and name are drawn, by
    /// abbreviation; a pinhole chart without a `view` is aimed at it too.
    pub(crate) constellation: Option<String>,
    /// Where a pinhole chart without a `view` looks: a vector in the J2000
    /// equatorial frame, of any length.
    pub(crate) center_direction: Option<[f32; 3]>,
    /// Degrees a pinhole chart without a `view` is rolled about its axis.
    pub(crate) tilt_angle: Option<f32>,
    /// The generator preview's camera. When present it decides what the chart
    /// shows and how big it is, instead of the observer and `center_direction`.
    #[serde(default)]
    pub(crate) view: Option<ViewConfig>,
    /// What is drawn besides the stars.
    pub(crate) layers: LayersConfig,
    /// The chart's colours, font and star sizes.
    pub(crate) style: StyleConfig,
    /// Places ringed on the chart: where a close-up chart looks, on the wide one.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) marks: Vec<SkyMark>,
    /// Print the observer's place and the time in the chart's corner.
    pub(crate) print_info: Option<bool>,
    /// A line of text centred under the chart.
    pub(crate) footer_text: Option<String>,
}

/// A ring on the sky: every point `radius_deg` from (`ra_deg`, `dec_deg`).
#[expect(
    clippy::struct_field_names,
    reason = "the unit is part of every field's name on the wire"
)]
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct SkyMark {
    /// Right ascension of the ring's centre, degrees, J2000.
    pub(crate) ra_deg: f64,
    /// Declination of the ring's centre, degrees, J2000.
    pub(crate) dec_deg: f64,
    /// The ring's angular radius, degrees.
    pub(crate) radius_deg: f64,
}

/// Camera basis in the equatorial frame (x → RA 0h, z → north pole), and the
/// chart size. Sizes are px of the preview, so stars and lines keep its proportions.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct ViewConfig {
    /// Screen right.
    pub(crate) right: [f64; 3],
    /// Screen up.
    pub(crate) up: [f64; 3],
    /// The chart centre.
    pub(crate) forward: [f64; 3],
    /// The chart's width, in the units `px` is given in.
    pub(crate) width: f64,
    /// The chart's height, in the same units.
    pub(crate) height: f64,
    /// Length of one preview px in the units of `width` and `height`, default 1.
    /// Star radii and line widths are multiplied by it: a chart sized in mm with
    /// a fixed `px` keeps its stars the same size on paper however large it is.
    #[serde(default)]
    pub(crate) px: Option<f64>,
}

/// The layers of a chart, each on or off. `horizontal_grid` and `poles` are read
/// and draw nothing.
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch a layer is what the page sends"
)]
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct LayersConfig {
    /// The ecliptic, a line.
    pub(crate) ecliptic: bool,
    /// The celestial equator, a line.
    pub(crate) equator: bool,
    /// The galactic equator, a line.
    pub(crate) galactic_equator: bool,
    /// The Sun, the Moon and the planets at the chart's instant.
    pub(crate) planets: bool,
    /// Altitude and azimuth circles; not drawn.
    #[expect(
        dead_code,
        reason = "the page sends it, and the chart draws nothing for it"
    )]
    pub(crate) horizontal_grid: bool,
    /// Parallels of declination and meridians of right ascension.
    pub(crate) equatorial_grid: bool,
    /// The constellations' stick figures.
    pub(crate) constellations: bool,
    /// The constellations' IAU boundaries.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) constellation_boundaries: bool,
    /// The constellations' names, and the planets' beside them.
    pub(crate) constellation_names: bool,
    /// A cross at the zenith of the observer's horizon chart.
    pub(crate) zenith: bool,
    /// The celestial poles; not drawn.
    #[expect(
        dead_code,
        reason = "the page sends it, and the chart draws nothing for it"
    )]
    pub(crate) poles: bool,
}

/// A chart's colours (anything SVG takes as a paint), its font and its star sizes.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct StyleConfig {
    /// Fill of the stars.
    pub(crate) star_color: String,
    /// Stroke of the constellations' figures and boundaries.
    pub(crate) constellation_line_color: String,
    /// Stroke of the grid, the equator and the horizon.
    pub(crate) grid_color: String,
    /// Behind everything, the area around a stereo disc included. `none` paints
    /// nothing, so whatever the chart is drawn on shows through.
    pub(crate) background_color: String,
    /// Fill of the sky itself (the disc, or the pinhole frame). None leaves the background.
    #[serde(default)]
    pub(crate) chart_color: Option<String>,
    /// Stroke around the sky's edge, 1 preview px wide. A white disc on white paper needs it.
    #[serde(default)]
    pub(crate) chart_outline: Option<String>,
    /// `font-family` of the chart's own text.
    pub(crate) font_family: String,
    /// What every star's and planet's radius is multiplied by.
    pub(crate) magnitude_scale: f32,
}

/// `POST /api/export/document`: pages of a multi-page PDF, each holding charts and text.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct DocumentRequest {
    /// The pages, in order.
    pub(crate) pages: Vec<DocumentPage>,
}

impl DocumentRequest {
    /// The charts on all its pages together: what the document costs to make.
    pub(crate) fn chart_count(&self) -> usize {
        self.pages.iter().map(|page| page.items.len()).sum()
    }
}

/// One page, in mm. An empty page is a blank page.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct DocumentPage {
    /// The page's width, mm.
    pub(crate) width_mm: f64,
    /// The page's height, mm.
    pub(crate) height_mm: f64,
    /// The charts on it.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) items: Vec<DocumentItem>,
    /// Drawn over the charts.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) texts: Vec<DocumentText>,
}

/// A chart on a page: its box in mm from the page's top-left, y down, and what to draw.
/// The config's `view` sizes the chart's own coordinates, which are fitted into the box.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct DocumentItem {
    /// The box's left edge, mm from the page's.
    pub(crate) x_mm: f64,
    /// The box's top edge, mm from the page's.
    pub(crate) y_mm: f64,
    /// The box's width, mm.
    pub(crate) width_mm: f64,
    /// The box's height, mm.
    pub(crate) height_mm: f64,
    /// The chart drawn in the box.
    pub(crate) config: RenderConfig,
}

/// A block of text on a page, already broken into lines: the page editor wraps it
/// (it shows the text as it is typed) and this server only sets each line where it is
/// told to, in the same font file (`crate::fonts`), so the PDF breaks where the editor did.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct DocumentText {
    /// Which bundled family the text is set in.
    pub(crate) font: TextFont,
    /// Set in the bold face.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) bold: bool,
    /// Set in the italic face.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) italic: bool,
    /// The font size, mm.
    pub(crate) size_mm: f64,
    /// Which point of a line its `x_mm` is.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) anchor: TextAnchor,
    /// Degrees the text is turned clockwise about (`cx_mm`, `cy_mm`). Its lines are
    /// given as they are before the turn.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) rotation_deg: f64,
    /// The centre of the turn, mm from the page's left edge.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) cx_mm: f64,
    /// The centre of the turn, mm from the page's top edge.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) cy_mm: f64,
    /// The lines, each where the editor put it.
    pub(crate) lines: Vec<DocumentTextLine>,
    /// Hairlines drawn with the text and turned with it: the rules of a table.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<_>", optional))]
    pub(crate) rules: Vec<DocumentRule>,
}

/// A straight line from (`x1_mm`, `y1_mm`) to (`x2_mm`, `y2_mm`), `width_mm` thick, black.
#[expect(
    clippy::struct_field_names,
    reason = "the unit is part of every field's name on the wire"
)]
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct DocumentRule {
    /// Where the rule starts, mm from the page's left edge.
    pub(crate) x1_mm: f64,
    /// Where the rule starts, mm from the page's top edge.
    pub(crate) y1_mm: f64,
    /// Where the rule ends, mm from the page's left edge.
    pub(crate) x2_mm: f64,
    /// Where the rule ends, mm from the page's top edge.
    pub(crate) y2_mm: f64,
    /// The rule's thickness, mm.
    pub(crate) width_mm: f64,
}

/// One line of text: where its baseline starts (or its middle, or its end: the
/// text's `anchor`), mm from the page's top-left, y down. A cell of a table is a
/// line with an anchor and a weight of its own.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(optional_fields = nullable))]
pub(crate) struct DocumentTextLine {
    /// The anchor point of the line, mm from the page's left edge.
    pub(crate) x_mm: f64,
    /// The line's baseline, mm from the page's top edge.
    pub(crate) y_mm: f64,
    /// What the line says.
    pub(crate) text: String,
    /// Which point of this line its `x_mm` is; the text's `anchor` when absent.
    #[serde(default)]
    pub(crate) anchor: Option<TextAnchor>,
    /// Set this line bold, or not, whatever the text is; the text's `bold` when absent.
    #[serde(default)]
    pub(crate) bold: Option<bool>,
}

/// The bundled families a text may be set in (`crate::fonts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub(crate) enum TextFont {
    /// PT Serif.
    Serif,
    /// PT Sans.
    Sans,
}

/// Which point of a line of text its `x_mm` is: SVG's `text-anchor`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub(crate) enum TextAnchor {
    /// The line starts at `x_mm`.
    #[default]
    Start,
    /// The line is centred on `x_mm`.
    Middle,
    /// The line ends at `x_mm`.
    End,
}
