use crate::models::RenderConfig;
use rust_core::coords::ra_dec_to_unit_vector;
use std::fmt::Write;

/// Every traced circle is sampled in 5° steps, i.e. 73 points for a full turn.
const CIRCLE_STEPS: u32 = 72;
const CIRCLE_STEP_DEG: f32 = 5.0;

/// Mean obliquity of the ecliptic at J2000, in degrees.
pub(crate) const OBLIQUITY_DEG: f32 = 23.439_291;

/// ICRS J2000 → galactic rotation matrix (standard ESA/Hipparcos values). We need
/// R^T (galactic → equatorial) applied to `(cos l, sin l, 0)` to trace the galactic
/// equator (b = 0) on the sky, so only the first two columns of R^T are used.
///
/// Declared as `f64` so the published precision survives in the source; the result
/// is narrowed to `f32` once, at the end of the rotation.
const GAL_TO_EQ_M00: f64 = -0.054_875_560_4;
const GAL_TO_EQ_M01: f64 = 0.494_109_427_9;
const GAL_TO_EQ_M10: f64 = -0.873_437_090_2;
const GAL_TO_EQ_M11: f64 = -0.444_829_63;
const GAL_TO_EQ_M20: f64 = -0.483_835_015_5;
const GAL_TO_EQ_M21: f64 = 0.746_982_244_5;

/// Stroke styling applied to one traced polyline.
struct PolylineStyle<'a> {
    stroke: &'a str,
    width: &'a str,
    opacity: &'a str,
}

// ---------------------------------------------------------------------------
// Pure geometry: one point per source angle, no SVG involved.
//
// These are covered by the cross-language golden test at the bottom of this file,
// which pins them against `assets/golden/reference-geometry.json` — the same file
// the TypeScript canvas renderer is tested against.
// ---------------------------------------------------------------------------

/// Unit vector on the celestial equator (Dec = 0) at the given right ascension.
pub(crate) fn equator_point(ra_rad: f32) -> (f32, f32, f32) {
    ra_dec_to_unit_vector(ra_rad, 0.0)
}

/// Unit vector on the ecliptic at the given ecliptic longitude, in the equatorial frame.
pub(crate) fn ecliptic_point(lambda_rad: f32) -> (f32, f32, f32) {
    let epsilon = OBLIQUITY_DEG.to_radians();
    let sin_lambda = lambda_rad.sin();
    (
        lambda_rad.cos(),
        sin_lambda * epsilon.cos(),
        sin_lambda * epsilon.sin(),
    )
}

/// Unit vector on the galactic equator (b = 0) at galactic longitude `l`, in the
/// equatorial frame.
pub(crate) fn galactic_equator_point(l_rad: f32) -> (f32, f32, f32) {
    let l = l_rad as f64;
    let cos_l = l.cos();
    let sin_l = l.sin();
    (
        (GAL_TO_EQ_M00 * cos_l + GAL_TO_EQ_M01 * sin_l) as f32,
        (GAL_TO_EQ_M10 * cos_l + GAL_TO_EQ_M11 * sin_l) as f32,
        (GAL_TO_EQ_M20 * cos_l + GAL_TO_EQ_M21 * sin_l) as f32,
    )
}

/// Angles, in radians, of the `CIRCLE_STEPS + 1` samples of a full circle.
fn circle_angles() -> impl Iterator<Item = f32> {
    (0..=CIRCLE_STEPS).map(|i| ((i as f32) * CIRCLE_STEP_DEG).to_radians())
}

// ---------------------------------------------------------------------------
// Shared polyline tracing.
// ---------------------------------------------------------------------------

/// Projects each point and joins the visible runs into a single SVG path `d` value.
///
/// A point that fails to project (behind the camera, outside the frame, ...) breaks
/// the polyline, so the next visible point starts a fresh `M` sub-path.
fn trace_polyline<F>(points: impl Iterator<Item = (f32, f32, f32)>, project_point: &F) -> String
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let mut path = String::with_capacity(4096);
    let mut first = true;

    for (x, y, z) in points {
        match project_point(x, y, z) {
            Some((px, py)) => {
                if first {
                    let _ = write!(path, "M {} {}", px, py);
                    first = false;
                } else {
                    let _ = write!(path, " L {} {}", px, py);
                }
            }
            None => first = true,
        }
    }

    path
}

/// Traces `points` and, if anything was visible, appends the styled `<path>` element.
fn draw_polyline<F>(
    svg: &mut String,
    points: impl Iterator<Item = (f32, f32, f32)>,
    project_point: &F,
    style: &PolylineStyle<'_>,
) where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let path = trace_polyline(points, project_point);
    if !path.is_empty() {
        let _ = write!(
            svg,
            r##"<path d="{}" fill="none" stroke="{}" stroke-width="{}" opacity="{}" />"##,
            path, style.stroke, style.width, style.opacity
        );
    }
}

// ---------------------------------------------------------------------------
// Drawing entry points.
// ---------------------------------------------------------------------------

pub(super) fn draw_coordinate_grids<F>(
    svg: &mut String,
    config: &RenderConfig,
    grid_color: &str,
    project_point: &F,
) where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    if config.layers.equatorial_grid {
        draw_equatorial_grid(svg, grid_color, project_point);
    }

    if config.layers.equator {
        draw_celestial_equator(svg, grid_color, project_point);
    }

    if config.layers.ecliptic {
        draw_ecliptic(svg, project_point);
    }

    if config.layers.galactic_equator {
        draw_galactic_equator(svg, project_point);
    }
}

pub(super) fn draw_equatorial_grid<F>(svg: &mut String, grid_color: &str, project_point: &F)
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let style = PolylineStyle {
        stroke: grid_color,
        width: "0.5",
        opacity: "0.25",
    };

    // Parallels of declination every 15°, each traced in 5° steps of right ascension.
    let decs = [
        -75.0f32, -60.0, -45.0, -30.0, -15.0, 0.0, 15.0, 30.0, 45.0, 60.0, 75.0,
    ];
    for &dec_deg in &decs {
        let dec_rad = dec_deg.to_radians();
        let points = circle_angles().map(|ra_rad| ra_dec_to_unit_vector(ra_rad, dec_rad));
        draw_polyline(svg, points, project_point, &style);
    }

    // Meridians of right ascension every hour, each traced pole to pole in 5° steps.
    for h in 0..24 {
        let ra_rad = ((h as f32) * 15.0).to_radians();
        let points = (0..=36).map(|i| {
            let dec_rad = (-90.0 + (i as f32) * 5.0).to_radians();
            ra_dec_to_unit_vector(ra_rad, dec_rad)
        });
        draw_polyline(svg, points, project_point, &style);
    }
}

pub(super) fn draw_celestial_equator<F>(svg: &mut String, grid_color: &str, project_point: &F)
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let style = PolylineStyle {
        stroke: grid_color,
        width: "0.8",
        opacity: "0.85",
    };
    draw_polyline(
        svg,
        circle_angles().map(equator_point),
        project_point,
        &style,
    );
}

pub(super) fn draw_ecliptic<F>(svg: &mut String, project_point: &F)
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let style = PolylineStyle {
        stroke: "#DC2626",
        width: "0.8",
        opacity: "0.95",
    };
    draw_polyline(
        svg,
        circle_angles().map(ecliptic_point),
        project_point,
        &style,
    );
}

pub(super) fn draw_galactic_equator<F>(svg: &mut String, project_point: &F)
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let style = PolylineStyle {
        stroke: "#B58CFF",
        width: "0.8",
        opacity: "0.9",
    };
    draw_polyline(
        svg,
        circle_angles().map(galactic_equator_point),
        project_point,
        &style,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// Cross-language golden file. The TypeScript canvas renderer is tested against
    /// this exact same JSON, so the on-screen preview and the SVG/PDF export cannot
    /// silently drift apart. If the astronomy has to change, both sides change together.
    const GOLDEN_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/assets/golden/reference-geometry.json"
    );

    fn load_golden() -> Value {
        let raw = std::fs::read_to_string(GOLDEN_PATH)
            .unwrap_or_else(|e| panic!("cannot read golden file {}: {}", GOLDEN_PATH, e));
        serde_json::from_str(&raw).expect("golden reference-geometry.json must be valid JSON")
    }

    fn expected_vector(sample: &Value, key: &str) -> [f64; 3] {
        let array = sample[key]
            .as_array()
            .unwrap_or_else(|| panic!("sample is missing the `{}` array", key));
        assert_eq!(array.len(), 3, "`{}` must hold exactly 3 components", key);
        std::array::from_fn(|i| {
            array[i]
                .as_f64()
                .unwrap_or_else(|| panic!("`{}[{}]` must be a number", key, i))
        })
    }

    fn assert_matches(actual: (f32, f32, f32), expected: [f64; 3], tol: f64, what: &str, deg: f64) {
        let actual = [actual.0 as f64, actual.1 as f64, actual.2 as f64];
        for axis in 0..3 {
            let delta = (actual[axis] - expected[axis]).abs();
            assert!(
                delta <= tol,
                "{} at {}°: component {} drifted by {:e} (expected {:?}, got {:?}, tolerance {:e})",
                what,
                deg,
                ["x", "y", "z"][axis],
                delta,
                expected,
                actual,
                tol
            );
        }
    }

    #[test]
    fn golden_obliquity_matches_backend_constant() {
        let golden = load_golden();
        let obliquity = golden["obliquity_deg"]
            .as_f64()
            .expect("golden file must declare `obliquity_deg`");
        assert!(
            (obliquity - OBLIQUITY_DEG as f64).abs() < 1e-6,
            "golden obliquity {} disagrees with backend constant {}",
            obliquity,
            OBLIQUITY_DEG
        );
    }

    #[test]
    fn golden_reference_geometry_matches_backend_generators() {
        let golden = load_golden();
        let tol = golden["tolerance"]
            .as_f64()
            .expect("golden file must declare `tolerance`");
        let samples = golden["samples"]
            .as_array()
            .expect("golden file must declare a `samples` array");
        assert!(!samples.is_empty(), "golden file has no samples");

        for sample in samples {
            let deg = sample["deg"]
                .as_f64()
                .expect("every sample must declare `deg`");
            let angle = (deg as f32).to_radians();

            assert_matches(
                equator_point(angle),
                expected_vector(sample, "equator"),
                tol,
                "celestial equator",
                deg,
            );
            assert_matches(
                ecliptic_point(angle),
                expected_vector(sample, "ecliptic"),
                tol,
                "ecliptic",
                deg,
            );
            assert_matches(
                galactic_equator_point(angle),
                expected_vector(sample, "galactic_equator"),
                tol,
                "galactic equator",
                deg,
            );
        }
    }

    #[test]
    fn generated_points_are_unit_vectors() {
        for angle in circle_angles() {
            for (what, (x, y, z)) in [
                ("equator", equator_point(angle)),
                ("ecliptic", ecliptic_point(angle)),
                ("galactic equator", galactic_equator_point(angle)),
            ] {
                let norm = ((x * x + y * y + z * z) as f64).sqrt();
                assert!(
                    (norm - 1.0).abs() < 1e-6,
                    "{} point at {} rad has norm {}",
                    what,
                    angle,
                    norm
                );
            }
        }
    }

    #[test]
    fn trace_polyline_breaks_the_path_on_invisible_points() {
        // Hide the middle point: the polyline must restart with a fresh `M`.
        let project = |x: f32, y: f32, _z: f32| -> Option<(f32, f32)> {
            if x == 2.0 { None } else { Some((x, y)) }
        };
        let points = [
            (1.0, 1.0, 0.0),
            (2.0, 2.0, 0.0),
            (3.0, 3.0, 0.0),
            (4.0, 4.0, 0.0),
        ];
        let path = trace_polyline(points.into_iter(), &project);
        assert_eq!(path, "M 1 1M 3 3 L 4 4");
    }

    #[test]
    fn nothing_visible_emits_no_path_element() {
        let project = |_x: f32, _y: f32, _z: f32| -> Option<(f32, f32)> { None };
        let mut svg = String::new();
        draw_galactic_equator(&mut svg, &project);
        assert!(svg.is_empty(), "no visible points must emit no <path>");
    }
}
