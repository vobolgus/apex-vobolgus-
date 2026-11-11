//! What a chart's layers are drawn on: the canvas, and the way the sky falls on it.

use rust_core::coords::Direction;
use rust_core::projections::{
    CameraConfig, PinholeProjection, Project, StereoProjection, ViewProjection,
};
use rust_core::time::DateTime;

use super::labels::Info;
use super::{Chart, Projection};
use crate::constellations;
use crate::request::{LayersConfig, RenderConfig, SkyMark, StyleConfig};

/// Side of the observer's horizon chart, and height of the observer's camera chart,
/// in px.
const CHART_SIDE_PX: u32 = 800;
/// Radius of the sky's disc on the observer's horizon chart, px.
const HORIZON_RADIUS_PX: f32 = 380.0;
/// What the horizon chart's stereographic plane is stretched by: the horizon, at 2
/// on that plane, lands on the disc's edge.
const HORIZON_SCALE: f32 = 190.0;
/// Width over height of the observer's camera chart that names none.
const DEFAULT_ASPECT_RATIO: f32 = 1.5;
/// Field of view across the frame diagonal of the observer's camera chart that names
/// none, degrees.
const DEFAULT_CAMERA_FOV_DEG: f32 = 60.0;

/// The three ways a chart looks at the sky, each with its camera set up.
#[derive(Debug, Clone, Copy)]
pub(super) enum Sky {
    /// The generator preview's camera, with its own size.
    View(ViewProjection),
    /// The whole sky over an observer at the chart's instant, the zenith in the middle.
    Horizon(StereoProjection),
    /// The observer's camera, aimed at a direction.
    Camera {
        /// The canvas width, px; its height is `CHART_SIDE_PX`.
        width: u32,
        /// The camera. One that cannot be set up sees nothing.
        camera: Option<PinholeProjection>,
    },
}

impl Sky {
    /// The observer's camera chart `config` asks for: aimed where it says, rolled by
    /// its tilt, `CHART_SIDE_PX` high and its aspect ratio times as wide.
    pub(super) fn camera(config: &RenderConfig) -> Self {
        // Настраиваем камеру для Pinhole
        let aspect = config.aspect_ratio.unwrap_or(DEFAULT_ASPECT_RATIO);
        let fov = f64::from(config.fov_deg.unwrap_or(DEFAULT_CAMERA_FOV_DEG));
        let frame = CameraConfig::from_fov_and_aspect(fov, f64::from(aspect), CHART_SIDE_PX);
        let tilt_angle = f64::from(config.tilt_angle.unwrap_or(0.0));
        Self::Camera {
            width: (CHART_SIDE_PX as f32 * aspect) as u32,
            // A camera that cannot be set up sees nothing.
            camera: PinholeProjection::new(aim(config), tilt_angle, frame).ok(),
        }
    }
}

/// One chart's canvas, worked out once, and what the chart holds; every layer is
/// drawn against it.
pub(super) struct Scene<'a> {
    /// What is drawn besides the stars.
    pub(super) layers: &'a LayersConfig,
    /// The chart's colours, font and star sizes.
    pub(super) style: &'a StyleConfig,
    /// The one constellation drawn, by abbreviation; all of them when `None`.
    pub(super) constellation: Option<&'a str>,
    /// Places ringed on the chart.
    pub(super) marks: &'a [SkyMark],
    /// The place and time printed in the corner, when the chart prints them.
    pub(super) info: Option<&'a Info>,
    /// A line of text centred under the chart.
    pub(super) footer: Option<&'a str>,
    /// What every `id` the chart emits starts with.
    pub(super) id_prefix: &'a str,
    /// Length of one preview px in chart units (`view.px`): everything sized in preview
    /// px (star and planet radii, line widths, text) is multiplied by it. 1 without a view.
    pub(super) px: f32,
    /// The canvas width, chart units.
    pub(super) width: f32,
    /// The canvas height, chart units.
    pub(super) height: f32,
    /// The middle of the canvas, x.
    pub(super) center_x: f32,
    /// The middle of the canvas, y.
    pub(super) center_y: f32,
    /// Radius of the sky's disc on a stereographic chart.
    pub(super) sky_radius: f32,
    /// The instant the chart is drawn for, UT.
    pub(super) time: DateTime,
    /// How the chart looks at the sky; asked through `Project`.
    sky: Sky,
}

impl<'a> Scene<'a> {
    /// The scene of `chart`, its ids prefixed with `id_prefix`.
    pub(super) fn new(chart: &'a Chart, id_prefix: &'a str) -> Self {
        // Определяем размеры холста. A view brings its own size, in preview px.
        let (width, height) = match chart.sky {
            Sky::View(view) => (view.width() as f32, view.height() as f32),
            Sky::Horizon(_) => (CHART_SIDE_PX as f32, CHART_SIDE_PX as f32),
            Sky::Camera { width, .. } => (width as f32, CHART_SIDE_PX as f32),
        };
        let sky_radius = match chart.sky {
            Sky::View(view) => view.half_extent().0 as f32,
            Sky::Horizon(_) | Sky::Camera { .. } => HORIZON_RADIUS_PX,
        };

        Self {
            layers: &chart.layers,
            style: &chart.style,
            constellation: chart.constellation.as_deref(),
            marks: &chart.marks,
            info: chart.info.as_ref(),
            footer: chart.footer.as_deref(),
            id_prefix,
            px: chart.px,
            width,
            height,
            center_x: width / 2.0,
            center_y: height / 2.0,
            sky_radius,
            time: chart.time,
            sky: chart.sky,
        }
    }

    /// How the sky is flattened: round, or a rectangular frame.
    pub(super) fn projection(&self) -> Projection {
        match self.sky {
            Sky::View(view) => view.kind().into(),
            Sky::Horizon(_) => Projection::Stereo,
            Sky::Camera { .. } => Projection::Pinhole,
        }
    }

    /// The chart is seen through the preview's camera.
    pub(super) fn has_view(&self) -> bool {
        matches!(self.sky, Sky::View(_))
    }

    /// The observer's horizon chart: the round one with no view, which has a horizon
    /// to label.
    pub(super) fn is_horizon_chart(&self) -> bool {
        matches!(self.sky, Sky::Horizon(_))
    }

    /// Whether a disc of radius `r` at `(x, y)` reaches the chart. Stars and planets
    /// only go into the file when they do.
    pub(super) fn shows(&self, x: f32, y: f32, r: f32) -> bool {
        match self.sky {
            Sky::View(view) => view.touches_chart(x, y, r),
            Sky::Horizon(_) | Sky::Camera { .. } => true,
        }
    }
}

// Вспомогательная функция для проецирования звезды/точки ECI
impl Project for Scene<'_> {
    /// The canvas position of `direction`, in chart units; `None` when the chart does
    /// not show it (behind the camera, below the horizon, ...).
    fn project(&self, direction: Direction) -> Option<(f32, f32)> {
        match &self.sky {
            Sky::View(view) => view.project(direction),
            // The zenith is drawn in the middle of the canvas.
            Sky::Horizon(stereo) => {
                let point = stereo.project(direction)?;
                let svg_x = self.center_x + point.x * HORIZON_SCALE;
                let svg_y = self.center_y - point.y * HORIZON_SCALE;
                Some((svg_x, svg_y))
            }
            Sky::Camera { camera, .. } => camera.as_ref()?.project(direction),
        }
    }
}

/// Where the observer's camera looks: along `center_direction` if there is one worth
/// the name, else at the constellation named, else at RA 0h on the equator.
// Направление камеры для Pinhole
fn aim(config: &RenderConfig) -> [f64; 3] {
    const DEFAULT_AIM: [f64; 3] = [1.0, 0.0, 0.0];
    match config.center_direction {
        Some(direction) => {
            let direction = direction.map(f64::from);
            let norm = (direction[0].powi(2) + direction[1].powi(2) + direction[2].powi(2)).sqrt();
            if norm > 1e-7 {
                direction.map(|component| component / norm)
            } else {
                DEFAULT_AIM
            }
        }
        None => config
            .constellation
            .as_deref()
            .and_then(|abbr| constellations::figures().get(abbr))
            .map_or(DEFAULT_AIM, |figure| figure.center.map(f64::from)),
    }
}
