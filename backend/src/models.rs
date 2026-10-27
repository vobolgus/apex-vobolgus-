use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderConfig {
    pub projection: String, // "stereo" | "pinhole"
    pub datetime: Option<String>,
    /// Observer position. Orients the chart when there is no `view`, so it is
    /// required then; with a `view` it is unused.
    pub latitude: Option<f32>,
    pub longitude: Option<f32>,
    pub magnitude_limit: Option<f32>,
    /// With a `view`: across the disc for "stereo", horizontal for "pinhole".
    /// Without one, pinhole only, across the frame diagonal.
    pub fov_deg: Option<f32>,
    pub aspect_ratio: Option<f32>,
    pub constellation: Option<String>,
    pub center_direction: Option<[f32; 3]>,
    pub tilt_angle: Option<f32>,
    /// The generator preview's camera. When present it decides what the chart
    /// shows and how big it is, instead of the observer and `center_direction`.
    #[serde(default)]
    pub view: Option<ViewConfig>,
    pub layers: LayersConfig,
    pub style: StyleConfig,
    pub print_info: Option<bool>,
    pub footer_text: Option<String>,
}

/// Camera basis in the equatorial frame (x → RA 0h, z → north pole), and the
/// chart size. Sizes are px of the preview, so stars and lines keep its proportions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewConfig {
    /// Screen right.
    pub right: [f64; 3],
    /// Screen up.
    pub up: [f64; 3],
    /// The chart centre.
    pub forward: [f64; 3],
    pub width: f64,
    pub height: f64,
    /// Length of one preview px in the units of `width` and `height`, default 1.
    /// Star radii and line widths are multiplied by it: a chart sized in mm with
    /// a fixed `px` keeps its stars the same size on paper however large it is.
    #[serde(default)]
    pub px: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayersConfig {
    pub ecliptic: bool,
    pub equator: bool,
    pub galactic_equator: bool,
    pub planets: bool,
    pub horizontal_grid: bool,
    pub equatorial_grid: bool,
    pub constellations: bool,
    #[serde(default)]
    pub constellation_boundaries: bool,
    pub constellation_names: bool,
    pub zenith: bool,
    pub poles: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleConfig {
    pub star_color: String,
    pub constellation_line_color: String,
    pub grid_color: String,
    /// Behind everything, the area around a stereo disc included. `none` paints
    /// nothing, so whatever the chart is drawn on shows through.
    pub background_color: String,
    /// Fill of the sky itself (the disc, or the pinhole frame). None leaves the background.
    #[serde(default)]
    pub chart_color: Option<String>,
    /// Stroke around the sky's edge, 1 preview px wide. A white disc on white paper needs it.
    #[serde(default)]
    pub chart_outline: Option<String>,
    pub font_family: String,
    pub magnitude_scale: f32,
}

/// `POST /api/export/document`: pages of a multi-page PDF, each holding charts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRequest {
    pub pages: Vec<DocumentPage>,
}

/// One page, in mm. An empty page is a blank page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentPage {
    pub width_mm: f64,
    pub height_mm: f64,
    #[serde(default)]
    pub items: Vec<DocumentItem>,
}

/// A chart on a page: its box in mm from the page's top-left, y down, and what to draw.
/// The config's `view` sizes the chart's own coordinates, which are fitted into the box.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentItem {
    pub x_mm: f64,
    pub y_mm: f64,
    pub width_mm: f64,
    pub height_mm: f64,
    pub config: RenderConfig,
}
