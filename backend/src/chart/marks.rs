//! The marked places: a ring round each, over everything else on the sky.

use super::polyline::{self, PolylineStyle, circle_angles};
use super::scene::{Scene, SkyPoint};
use crate::svg::SvgWriter;

/// The ring round a marked place: the app's accent (`--accent` in tokens.css).
const MARK_COLOR: &str = "#d34b4b";

/// The ring of points `radius_deg` from (`ra_deg`, `dec_deg`), closed.
fn ring_points(ra_deg: f64, dec_deg: f64, radius_deg: f64) -> impl Iterator<Item = SkyPoint> {
    let (ra, dec, radius) = (
        ra_deg.to_radians(),
        dec_deg.to_radians(),
        radius_deg.to_radians(),
    );
    // The centre, and two directions square to it and to each other: east and north.
    let centre = [dec.cos() * ra.cos(), dec.cos() * ra.sin(), dec.sin()];
    let east = [-ra.sin(), ra.cos(), 0.0];
    let north = [-dec.sin() * ra.cos(), -dec.sin() * ra.sin(), dec.cos()];
    circle_angles().map(move |angle| {
        let (sin, cos) = f64::from(angle).sin_cos();
        let at =
            |i: usize| radius.cos() * centre[i] + radius.sin() * (cos * east[i] + sin * north[i]);
        (at(0) as f32, at(1) as f32, at(2) as f32)
    })
}

/// A ring round each marked place, in the app's accent: where a close-up looks.
pub(super) fn draw(svg: &mut SvgWriter, scene: &Scene<'_>) {
    let style = PolylineStyle {
        stroke: MARK_COLOR,
        width: 1.5 * scene.px,
        opacity: "1",
    };
    for mark in &scene.config.marks {
        polyline::draw(
            svg,
            ring_points(mark.ra_deg, mark.dec_deg, mark.radius_deg),
            scene,
            &style,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ring_is_closed_and_its_points_are_its_radius_from_the_centre() {
        let (ra, dec) = (83.8_f64.to_radians(), (-5.4_f64).to_radians());
        let centre = [dec.cos() * ra.cos(), dec.cos() * ra.sin(), dec.sin()];
        let ring: Vec<SkyPoint> = ring_points(83.8, -5.4, 10.0).collect();
        assert_eq!(ring.len(), 361);
        for (x, y, z) in &ring {
            let dot =
                f64::from(*x) * centre[0] + f64::from(*y) * centre[1] + f64::from(*z) * centre[2];
            assert!((dot.acos().to_degrees() - 10.0).abs() < 1e-3);
        }
        let (first, last) = (ring[0], ring[360]);
        assert!((first.0 - last.0).abs() < 1e-6 && (first.2 - last.2).abs() < 1e-6);
    }
}
