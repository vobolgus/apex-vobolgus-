//! Curves on the sky as SVG paths: the points along a circle or a great-circle arc,
//! and the `<path>` they make once projected.

use std::fmt::Write;

use rust_core::coords::Direction;
use rust_core::projections::Project;

use crate::svg::SvgWriter;

/// Every traced circle is sampled in 1° steps, i.e. 361 points for a full turn, as
/// the preview does (`SAMPLE_STEP_DEG` in `reference-lines.ts`): coarser chords
/// show as corners on a zoomed-in stereo chart.
const CIRCLE_STEPS: u32 = 360;
/// The angle between two samples of a traced circle, degrees.
const CIRCLE_STEP_DEG: f32 = 1.0;

/// Longest piece of a great-circle arc drawn as one straight segment, as in the
/// preview (`GREAT_CIRCLE_SUBDIV_DEG`).
const GREAT_CIRCLE_STEP_DEG: f32 = 3.0;

/// Stroke styling applied to one traced polyline.
pub(super) struct PolylineStyle<'a> {
    /// The stroke's paint.
    pub(super) stroke: &'a str,
    /// In chart units: the preview's width in px times `view.px`.
    pub(super) width: f32,
    /// Written as `stroke-opacity`, the same on a path with no fill: element `opacity`
    /// makes svg2pdf wrap every path in a transparency group of its own.
    pub(super) opacity: &'a str,
}

/// Angles, in radians, of the `CIRCLE_STEPS + 1` samples of a full circle.
pub(super) fn circle_angles() -> impl Iterator<Item = f32> {
    (0..=CIRCLE_STEPS).map(|i| ((i as f32) * CIRCLE_STEP_DEG).to_radians())
}

/// The points of the shorter great-circle arc from `a` to `b`, both ends included,
/// at most `GREAT_CIRCLE_STEP_DEG` apart. Projected, a stereo arc stays curved.
pub(super) fn great_circle_points(a: Direction, b: Direction) -> impl Iterator<Item = Direction> {
    let dot = (a.x * b.x + a.y * b.y + a.z * b.z).clamp(-1.0, 1.0);
    let angle = dot.acos();
    let steps = ((angle.to_degrees() / GREAT_CIRCLE_STEP_DEG).ceil() as u32).max(1);
    let sin_angle = angle.sin();
    (0..=steps).map(move |step| {
        if step == 0 || sin_angle.abs() < 1e-6 {
            return if step == 0 { a } else { b };
        }
        let t = step as f32 / steps as f32;
        let wa = ((1.0 - t) * angle).sin() / sin_angle;
        let wb = (t * angle).sin() / sin_angle;
        Direction::new(
            wa * a.x + wb * b.x,
            wa * a.y + wb * b.y,
            wa * a.z + wb * b.z,
        )
    })
}

/// Projects each point and joins the visible runs into a single SVG path `d` value.
///
/// A point that fails to project (behind the camera, outside the frame, ...) breaks
/// the polyline, so the next visible point starts a fresh `M` sub-path.
fn trace(points: impl Iterator<Item = Direction>, projector: &impl Project) -> String {
    let mut path = String::with_capacity(4096);
    let mut first = true;

    for point in points {
        match projector.project(point) {
            Some((px, py)) => {
                // Writing to a String cannot fail.
                let _ = if first {
                    write!(path, "M {px} {py}")
                } else {
                    write!(path, " L {px} {py}")
                };
                first = false;
            }
            None => first = true,
        }
    }

    path
}

/// Traces `points` and, if anything was visible, appends the styled `<path>` element.
pub(super) fn draw(
    svg: &mut SvgWriter,
    points: impl Iterator<Item = Direction>,
    projector: &impl Project,
    style: &PolylineStyle<'_>,
) {
    let path = trace(points, projector);
    if !path.is_empty() {
        write!(
            svg,
            r#"<path d="{}" fill="none" stroke="{}" stroke-width="{}" stroke-opacity="{}" />"#,
            path, style.stroke, style.width, style.opacity
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Puts a direction at its `(x, y)`, but for the one at `x = 2`, which it hides.
    struct HidingTwo;

    impl Project for HidingTwo {
        fn project(&self, direction: Direction) -> Option<(f32, f32)> {
            (direction.x != 2.0).then_some((direction.x, direction.y))
        }
    }

    /// Shows nothing at all.
    struct Blind;

    impl Project for Blind {
        fn project(&self, _direction: Direction) -> Option<(f32, f32)> {
            None
        }
    }

    #[test]
    fn trace_breaks_the_path_on_invisible_points() {
        // Hide the middle point: the polyline must restart with a fresh `M`.
        let points = [
            (1.0, 1.0, 0.0),
            (2.0, 2.0, 0.0),
            (3.0, 3.0, 0.0),
            (4.0, 4.0, 0.0),
        ];
        let path = trace(points.into_iter().map(Direction::from), &HidingTwo);
        assert_eq!(path, "M 1 1M 3 3 L 4 4");
    }

    #[test]
    fn nothing_visible_emits_no_path_element() {
        let style = PolylineStyle {
            stroke: "#B58CFF",
            width: 1.0,
            opacity: "0.9",
        };
        let mut svg = SvgWriter::new();
        draw(
            &mut svg,
            circle_angles().map(|a| Direction::new(a, a, a)),
            &Blind,
            &style,
        );
        assert!(svg.is_empty(), "no visible points must emit no <path>");
    }

    #[test]
    fn a_great_circle_arc_keeps_its_ends_and_steps_at_most_three_degrees() {
        let (a, b) = (Direction::new(1.0, 0.0, 0.0), Direction::new(0.0, 1.0, 0.0));
        let points: Vec<Direction> = great_circle_points(a, b).collect();
        assert_eq!(points.len(), 31, "90° in 3° steps");
        assert_eq!((points[0], points[30]), (a, b));
        // The same point twice is one step from itself to itself.
        assert_eq!(great_circle_points(a, a).collect::<Vec<_>>(), [a, a]);
    }
}
