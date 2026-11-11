//! A star chart as SVG.
//!
//! A chart starts as a `RenderConfig`, the JSON a client sends. [`Chart::try_from`]
//! checks it and works out the camera it asks for; a [`Chart`] can only be one that
//! can be drawn. [`Chart::to_svg`] then draws it, a layer at a time, each in a
//! module of its own:
//!
//! - `frame`: the root element, the background, the sky's fill, clip and outline,
//!   the horizon;
//! - `grids`: the coordinate grid, the equator, the ecliptic, the galactic equator;
//! - `constellations`: boundaries, stick figures, names;
//! - `stars`, `planets`, `marks`;
//! - `labels`: the compass points, the observer's place and time, the footer.
//!
//! They all draw against a `scene::Scene` (the canvas and the camera, worked out
//! once) into a `crate::svg::SvgWriter`, and curves go through `polyline`.
//!
//! There are three kinds of chart. With a `view` the chart is the generator
//! preview's own picture: its camera, its size, its star sizes, so the export shows
//! what the screen shows. Without one it is the observer's: for `stereo` the whole
//! sky over a place at an instant, north up, with its horizon; for `pinhole` a
//! camera aimed at a constellation or a direction.

mod constellations;
mod frame;
mod grids;
mod labels;
mod marks;
mod planets;
mod polyline;
mod scene;
mod stars;
mod time;

#[cfg(test)]
mod tests;

use std::str::FromStr;

use rust_core::{HipCatalog, Star, ViewKind, ViewProjection};
use thiserror::Error;

use self::scene::Scene;
use crate::limits::{MAX_MAGNITUDE_LIMIT, MAX_MARKS, MAX_VIEW_PX, MAX_VIEW_SIZE_PX};
use crate::request::{RenderConfig, SkyMark, ViewConfig};
use crate::svg::SvgWriter;

/// The faintest star drawn when the chart names no limit: everything the catalogue's
/// naked-eye sky holds.
const DEFAULT_MAGNITUDE_LIMIT: f32 = 6.5;

/// How the sky is flattened onto a chart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Projection {
    /// Stereographic: a round chart, the whole sky if need be.
    Stereo,
    /// Gnomonic, as a camera sees: a rectangular frame, straight great circles.
    Pinhole,
}

impl Projection {
    /// The field of view of a `view` that names none, degrees: the whole disc of a
    /// hemisphere, or a camera's normal lens.
    const fn default_view_fov(self) -> f64 {
        match self {
            Self::Stereo => 180.0,
            Self::Pinhole => 60.0,
        }
    }
}

impl FromStr for Projection {
    type Err = ChartError;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        match name {
            "stereo" => Ok(Self::Stereo),
            "pinhole" => Ok(Self::Pinhole),
            _ => Err(ChartError::UnknownProjection),
        }
    }
}

impl From<Projection> for ViewKind {
    fn from(projection: Projection) -> Self {
        match projection {
            Projection::Stereo => Self::Stereo,
            Projection::Pinhole => Self::Pinhole,
        }
    }
}

/// Why a `RenderConfig` is not a chart. Each is the plain-text message of a 400.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub(crate) enum ChartError {
    /// `projection` is neither of the two there are.
    #[error("projection must be 'stereo' or 'pinhole'")]
    UnknownProjection,
    /// Neither a view nor a whole observer: nothing says where the chart looks.
    #[error("latitude and longitude are required without a view")]
    NoObserver,
    /// `latitude` is off the globe.
    #[error("latitude must be in -90..=90")]
    Latitude,
    /// `longitude` is off the globe.
    #[error("longitude must be in -180..=180")]
    Longitude,
    /// The view is larger than any chart worth drawing (or its size is no number).
    #[error("view width and height must be at most {MAX_VIEW_SIZE_PX} px")]
    ViewTooLarge,
    /// `view.px` is not a length.
    #[error("view px must be in (0, {MAX_VIEW_PX}]")]
    ViewPx,
    /// The view's basis, size and field make no camera.
    #[error(
        "view needs non-zero right, up and forward vectors, a positive size and a fov_deg \
         the projection can show"
    )]
    NoCamera,
    /// More rings than a chart may carry.
    #[error("at most {MAX_MARKS} marks")]
    TooManyMarks,
    /// A ring that is nowhere, or of no size.
    #[error("a mark needs a finite ra_deg, dec_deg in -90..=90 and radius_deg in (0, 90]")]
    Mark,
    /// `magnitude_limit` is out of range.
    #[error("magnitude_limit must be in 0..={MAX_MAGNITUDE_LIMIT}")]
    MagnitudeLimit,
}

/// Where a chart nested in a larger SVG goes, in the parent's units.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Placement {
    /// The box's left edge.
    pub(crate) x: f64,
    /// The box's top edge.
    pub(crate) y: f64,
    /// The box's width.
    pub(crate) width: f64,
    /// The box's height.
    pub(crate) height: f64,
}

/// A chart that can be drawn: a `RenderConfig` that passed every check, with the
/// projection it names and the camera of its view.
#[derive(Debug, Clone)]
pub(crate) struct Chart {
    /// The settings as they were sent.
    config: RenderConfig,
    /// What `config.projection` names.
    projection: Projection,
    /// The camera of `config.view`, when there is one.
    view: Option<ViewProjection>,
}

/// The checks every chart passes before it is drawn, alone and in a document, in
/// the order their messages are given.
impl TryFrom<RenderConfig> for Chart {
    type Error = ChartError;

    fn try_from(config: RenderConfig) -> Result<Self, Self::Error> {
        let projection: Projection = config.projection.parse()?;
        if config.view.is_none() && (config.latitude.is_none() || config.longitude.is_none()) {
            return Err(ChartError::NoObserver);
        }
        if config
            .latitude
            .is_some_and(|latitude| !(-90.0..=90.0).contains(&latitude))
        {
            return Err(ChartError::Latitude);
        }
        if config
            .longitude
            .is_some_and(|longitude| !(-180.0..=180.0).contains(&longitude))
        {
            return Err(ChartError::Longitude);
        }
        let view = config
            .view
            .as_ref()
            .map(|view| camera(view, projection, config.fov_deg))
            .transpose()?;
        if config.marks.len() > MAX_MARKS {
            return Err(ChartError::TooManyMarks);
        }
        if !config.marks.iter().all(is_sound) {
            return Err(ChartError::Mark);
        }
        if config
            .magnitude_limit
            .is_some_and(|max_mag| !(0.0..=MAX_MAGNITUDE_LIMIT).contains(&max_mag))
        {
            return Err(ChartError::MagnitudeLimit);
        }
        Ok(Self {
            config,
            projection,
            view,
        })
    }
}

/// The preview camera `view` describes, for a chart in `projection` with the field
/// of view `fov_deg`.
fn camera(
    view: &ViewConfig,
    projection: Projection,
    fov_deg: Option<f32>,
) -> Result<ViewProjection, ChartError> {
    // Written so that a size that is no number fails too.
    let fits = view.width <= MAX_VIEW_SIZE_PX && view.height <= MAX_VIEW_SIZE_PX;
    if !fits {
        return Err(ChartError::ViewTooLarge);
    }
    if view.px.is_some_and(|px| !(px > 0.0 && px <= MAX_VIEW_PX)) {
        return Err(ChartError::ViewPx);
    }
    ViewProjection::new(
        projection.into(),
        view.right,
        view.up,
        view.forward,
        fov_deg.map_or(projection.default_view_fov(), f64::from),
        view.width,
        view.height,
    )
    .map_err(|_| ChartError::NoCamera)
}

/// A ring that is somewhere on the sky and has a size.
fn is_sound(mark: &SkyMark) -> bool {
    mark.ra_deg.is_finite()
        && (-90.0..=90.0).contains(&mark.dec_deg)
        && mark.radius_deg > 0.0
        && mark.radius_deg <= 90.0
}

impl Chart {
    /// The preview camera of the chart's view, if it has one.
    #[cfg(test)]
    pub(crate) fn view(&self) -> Option<&ViewProjection> {
        self.view.as_ref()
    }

    /// The chart as a standalone SVG document.
    pub(crate) fn to_svg(&self, catalog: &HipCatalog) -> String {
        // Pre-allocate to avoid O(n²) reallocations during SVG build.
        // Empirically derived from full-sky maps ~200KB; round to power-of-2.
        let mut svg = SvgWriter::with_capacity(256 * 1024);
        self.draw(&mut svg, catalog, "", None);
        svg.into()
    }

    /// The chart for a document holding several: every `id` it emits starts with
    /// `id_prefix`, and its root `<svg>` sits in the `placement` box of the parent
    /// SVG (aspect kept) instead of filling the viewport.
    pub(crate) fn write_nested(
        &self,
        svg: &mut SvgWriter,
        catalog: &HipCatalog,
        id_prefix: &str,
        placement: Placement,
    ) {
        self.draw(svg, catalog, id_prefix, Some(placement));
    }

    /// Draws the chart into `svg`, bottom layer first.
    fn draw(
        &self,
        svg: &mut SvgWriter,
        catalog: &HipCatalog,
        id_prefix: &str,
        placement: Option<Placement>,
    ) {
        let scene = Scene::new(self, id_prefix);
        let mag_limit = self
            .config
            .magnitude_limit
            .unwrap_or(DEFAULT_MAGNITUDE_LIMIT);
        let stars: Vec<&Star> = catalog.stars(mag_limit, None).collect();

        frame::open(svg, &scene, placement);

        // 1. Отрисовка координатных сеток
        grids::draw(svg, &scene);
        // 2. Линии созвездий
        constellations::draw_boundaries(svg, &scene);
        constellations::draw_figures(svg, &scene, &stars);
        // 3. Звезды
        stars::draw(svg, &scene, &stars);
        // 3.1 Планеты
        planets::draw(svg, &scene, mag_limit);
        // 6. Названия созвездий
        constellations::draw_names(svg, &scene);
        // 7. Marked places, over everything else on the sky.
        marks::draw(svg, &scene);

        frame::close_sky(svg);
        frame::draw_outline(svg, &scene);

        // 7. Оформление рамки для круглой стереографической карты.
        // Only for the observer's horizon chart: a view has no horizon to label.
        if scene.is_horizon_chart() {
            frame::draw_zenith(svg, &scene);
            labels::draw_compass(svg, &scene);
            frame::draw_horizon(svg, &scene);
        }

        labels::draw_info(svg, &scene);
        labels::draw_footer(svg, &scene);

        frame::close(svg);
    }
}
