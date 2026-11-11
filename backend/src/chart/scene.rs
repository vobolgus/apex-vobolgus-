//! What a chart's layers are drawn on: the canvas, and the way the sky falls on it.

use rust_core::{CameraConfig, DateTime, PinholeProjection, StereoProjection, ViewProjection};

use super::time::{DEFAULT_TIME, parse_datetime};
use super::{Chart, Projection};
use crate::constellations;
use crate::request::RenderConfig;

/// A direction on the sky: a unit vector in the J2000 equatorial frame (x to RA 0h,
/// z to the north pole).
pub(super) type SkyPoint = (f32, f32, f32);

/// Side of the observer's horizon chart, and height of the observer's camera chart,
/// in px.
const CHART_SIDE_PX: u32 = 800;
/// Radius of the sky's disc on the observer's horizon chart, px.
const HORIZON_RADIUS_PX: f32 = 380.0;
/// What the horizon chart's stereographic plane is stretched by: the horizon, at 2
/// on that plane, lands on the disc's edge.
const HORIZON_SCALE: f32 = 190.0;

/// Where a direction on the sky lands on a chart, if it lands at all.
pub(super) trait Project {
    /// The canvas position of the direction `(x, y, z)`; `None` when the chart does
    /// not show it (behind the camera, below the horizon, ...).
    fn project(&self, x: f32, y: f32, z: f32) -> Option<(f32, f32)>;
}

impl<F: Fn(f32, f32, f32) -> Option<(f32, f32)>> Project for F {
    fn project(&self, x: f32, y: f32, z: f32) -> Option<(f32, f32)> {
        self(x, y, z)
    }
}

/// The three ways a chart looks at the sky.
enum Projector {
    /// The generator preview's camera, with its own size.
    View(ViewProjection),
    /// The whole sky over an observer, the zenith at `center`.
    Horizon {
        stereo: StereoProjection,
        center: (f32, f32),
    },
    /// A camera aimed at a direction. One that cannot be set up sees nothing.
    Camera(Option<PinholeProjection>),
}

/// One chart's canvas and camera, worked out once from its settings; every layer is
/// drawn against it.
pub(super) struct Scene<'a> {
    /// The chart's settings as they were sent.
    pub(super) config: &'a RenderConfig,
    /// How the sky is flattened.
    pub(super) projection: Projection,
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
    /// The chart is seen through the preview's camera.
    pub(super) has_view: bool,
    projector: Projector,
}

impl<'a> Scene<'a> {
    /// The scene of `chart`, its ids prefixed with `id_prefix`.
    pub(super) fn new(chart: &'a Chart, id_prefix: &'a str) -> Self {
        let config = &chart.config;
        let projection = chart.projection;

        // Определяем размеры холста
        let (width, height) = match projection {
            Projection::Stereo => (CHART_SIDE_PX, CHART_SIDE_PX),
            Projection::Pinhole => {
                let aspect = config.aspect_ratio.unwrap_or(1.5);
                ((CHART_SIDE_PX as f32 * aspect) as u32, CHART_SIDE_PX)
            }
        };
        // A view brings its own size, in preview px.
        let (canvas_width, canvas_height) = match &chart.view {
            Some(view) => (view.width() as f32, view.height() as f32),
            None => (width as f32, height as f32),
        };
        let center_x = canvas_width / 2.0;
        let center_y = canvas_height / 2.0;
        let sky_radius = match &chart.view {
            Some(view) => view.half_extent().0 as f32,
            None => HORIZON_RADIUS_PX,
        };

        // Парсим время
        let time = config
            .datetime
            .as_deref()
            .and_then(parse_datetime)
            .unwrap_or(DEFAULT_TIME);

        let projector = match (chart.view, projection) {
            (Some(view), _) => Projector::View(view),
            (None, Projection::Stereo) => Projector::Horizon {
                // The observer is required when there is no view; the view ignores it.
                stereo: StereoProjection::new(
                    config.latitude.unwrap_or(0.0),
                    config.longitude.unwrap_or(0.0),
                    time,
                ),
                center: (center_x, center_y),
            },
            (None, Projection::Pinhole) => {
                // Настраиваем камеру для Pinhole
                let fov = f64::from(config.fov_deg.unwrap_or(60.0));
                let aspect = f64::from(config.aspect_ratio.unwrap_or(1.5));
                let camera = CameraConfig::from_fov_and_aspect(fov, aspect, height);
                let tilt_angle = f64::from(config.tilt_angle.unwrap_or(0.0));
                // A camera that cannot be set up sees nothing.
                Projector::Camera(PinholeProjection::new(aim(config), tilt_angle, camera).ok())
            }
        };

        Self {
            config,
            projection,
            id_prefix,
            px: preview_px(config),
            width: canvas_width,
            height: canvas_height,
            center_x,
            center_y,
            sky_radius,
            time,
            has_view: chart.view.is_some(),
            projector,
        }
    }

    /// The observer's horizon chart: the round one with no view, which has a horizon
    /// to label.
    pub(super) fn is_horizon_chart(&self) -> bool {
        self.projection == Projection::Stereo && !self.has_view
    }

    /// Whether a disc of radius `r` at `(x, y)` reaches the chart. Stars and planets
    /// only go into the file when they do.
    pub(super) fn shows(&self, x: f32, y: f32, r: f32) -> bool {
        match &self.projector {
            Projector::View(view) => view.touches_chart(x, y, r),
            Projector::Horizon { .. } | Projector::Camera(_) => true,
        }
    }
}

// Вспомогательная функция для проецирования звезды/точки ECI
impl Project for Scene<'_> {
    fn project(&self, x: f32, y: f32, z: f32) -> Option<(f32, f32)> {
        match &self.projector {
            Projector::View(view) => view.project(x, y, z),
            Projector::Horizon { stereo, center } => {
                let point = stereo.project(x, y, z)?;
                let svg_x = center.0 + point.x * HORIZON_SCALE;
                let svg_y = center.1 - point.y * HORIZON_SCALE;
                Some((svg_x, svg_y))
            }
            Projector::Camera(camera) => camera.as_ref()?.project(x, y, z),
        }
    }
}

/// Length of one preview px in chart units (`view.px`); 1 without a view.
fn preview_px(config: &RenderConfig) -> f32 {
    config
        .view
        .as_ref()
        .and_then(|view| view.px)
        .map_or(1.0, |px| px as f32)
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
            .as_ref()
            .and_then(|abbr| constellations::figures().get(abbr))
            .map_or(DEFAULT_AIM, |figure| figure.center.map(f64::from)),
    }
}
