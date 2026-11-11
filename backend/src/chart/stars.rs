//! The stars: a disc each, the brighter the larger.

use rust_core::Star;

use super::scene::{Project, Scene};
use crate::svg::SvgWriter;

/// Star radius of the generator preview, in its px: `frontend/src/lib/constants.ts`
/// (`STAR_BASE_RADIUS_PX`, `STAR_MAG_COEFF`, `STAR_MIN_RADIUS_PX`). A `view` is sized in
/// those px, so the exported stars come out as large as on screen.
fn preview_star_radius(v_mag: f32) -> f32 {
    const BASE_RADIUS_PX: f32 = 4.0;
    const MAG_COEFF: f32 = 0.75;
    const MIN_RADIUS_PX: f32 = 0.5;
    (BASE_RADIUS_PX - MAG_COEFF * v_mag).max(MIN_RADIUS_PX)
}

/// Star radius of the observer's charts, which have no preview to match: 1.3 px at
/// magnitude 0 and 0.16 dex smaller a magnitude, held to 0.6..=12.
fn observer_star_radius(v_mag: f32, magnitude_scale: f32) -> f32 {
    (magnitude_scale * 1.3 * 10.0f32.powf(-0.16 * v_mag)).clamp(0.6, 12.0)
}

/// Every star of `stars` that reaches the chart.
pub(super) fn draw(svg: &mut SvgWriter, scene: &Scene<'_>, stars: &[&Star]) {
    let star_color = &scene.config.style.star_color;
    let mag_scale = scene.config.style.magnitude_scale;

    for star in stars {
        if let Some((cx, cy)) = scene.project(star.x, star.y, star.z) {
            let r = if scene.has_view {
                preview_star_radius(star.v_mag) * mag_scale
            } else {
                observer_star_radius(star.v_mag, mag_scale)
            } * scene.px;
            if !scene.shows(cx, cy, r) {
                continue;
            }
            write!(
                svg,
                r#"<circle cx="{cx:.2}" cy="{cy:.2}" r="{r:.2}" fill="{star_color}" />"#
            );
        }
    }
}
