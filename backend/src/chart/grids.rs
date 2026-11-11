//! The coordinate grid and the reference lines: the celestial equator, the ecliptic
//! and the galactic equator.

use rust_core::coords::ra_dec_to_unit_vector;

use super::polyline::{self, PolylineStyle, circle_angles};
use super::scene::{Scene, SkyPoint};
use crate::svg::SvgWriter;

/// Mean obliquity of the ecliptic at J2000, in degrees.
const OBLIQUITY_DEG: f32 = 23.439_291;

/// ICRS J2000 → galactic rotation matrix (standard ESA/Hipparcos values). We need
/// R^T (galactic → equatorial) applied to `(cos l, sin l, 0)` to trace the galactic
/// equator (b = 0) on the sky, so only the first two columns of R^T are used.
///
/// Declared as `f64` so the published precision survives in the source; the result
/// is narrowed to `f32` once, at the end of the rotation. One row a line.
const GAL_TO_EQ: [[f64; 2]; 3] = [
    [-0.054_875_560_4, 0.494_109_427_9],
    [-0.873_437_090_2, -0.444_829_63],
    [-0.483_835_015_5, 0.746_982_244_5],
];

// ---------------------------------------------------------------------------
// Pure geometry: one point per source angle, no SVG involved.
//
// These are covered by the cross-language golden test at the bottom of this file,
// which pins them against `assets/golden/reference-geometry.json` — the same file
// the TypeScript canvas renderer is tested against.
// ---------------------------------------------------------------------------

/// Unit vector on the celestial equator (Dec = 0) at the given right ascension.
fn equator_point(ra_rad: f32) -> SkyPoint {
    ra_dec_to_unit_vector(ra_rad, 0.0)
}

/// Unit vector on the ecliptic at the given ecliptic longitude, in the equatorial frame.
fn ecliptic_point(lambda_rad: f32) -> SkyPoint {
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
fn galactic_equator_point(l_rad: f32) -> SkyPoint {
    let l = f64::from(l_rad);
    let cos_l = l.cos();
    let sin_l = l.sin();
    let [x, y, z] = GAL_TO_EQ.map(|[m0, m1]| (m0 * cos_l + m1 * sin_l) as f32);
    (x, y, z)
}

// ---------------------------------------------------------------------------
// Drawing entry points.
// ---------------------------------------------------------------------------

/// The grid and the reference lines the chart's layers ask for, under everything else.
pub(super) fn draw(svg: &mut SvgWriter, scene: &Scene<'_>) {
    let layers = &scene.config.layers;
    let grid_color = &scene.config.style.grid_color;
    // Line widths are preview px.
    let px = scene.px;

    if layers.equatorial_grid {
        draw_equatorial_grid(svg, scene, grid_color, px);
    }

    if layers.equator {
        // Widths and opacities here and below are the preview's REFERENCE_LINE_STYLES.
        let style = PolylineStyle {
            stroke: grid_color,
            width: px,
            opacity: "1",
        };
        polyline::draw(svg, circle_angles().map(equator_point), scene, &style);
    }

    if layers.ecliptic {
        let style = PolylineStyle {
            stroke: "#DC2626",
            width: px,
            opacity: "0.95",
        };
        polyline::draw(svg, circle_angles().map(ecliptic_point), scene, &style);
    }

    if layers.galactic_equator {
        let style = PolylineStyle {
            stroke: "#B58CFF",
            width: px,
            opacity: "0.9",
        };
        polyline::draw(
            svg,
            circle_angles().map(galactic_equator_point),
            scene,
            &style,
        );
    }
}

fn draw_equatorial_grid(svg: &mut SvgWriter, scene: &Scene<'_>, grid_color: &str, px: f32) {
    let style = PolylineStyle {
        stroke: grid_color,
        width: 0.5 * px,
        opacity: "0.25",
    };

    // Parallels of declination every 15°, each traced in 5° steps of right ascension.
    let decs = [
        -75.0f32, -60.0, -45.0, -30.0, -15.0, 0.0, 15.0, 30.0, 45.0, 60.0, 75.0,
    ];
    for dec_deg in decs {
        let dec_rad = dec_deg.to_radians();
        let points = circle_angles().map(|ra_rad| ra_dec_to_unit_vector(ra_rad, dec_rad));
        polyline::draw(svg, points, scene, &style);
    }

    // Meridians of right ascension every hour, each traced pole to pole in 5° steps.
    for h in 0..24 {
        let ra_rad = ((h as f32) * 15.0).to_radians();
        let points = (0..=36).map(|i| {
            let dec_rad = (-90.0 + (i as f32) * 5.0).to_radians();
            ra_dec_to_unit_vector(ra_rad, dec_rad)
        });
        polyline::draw(svg, points, scene, &style);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    /// Cross-language golden file. The TypeScript canvas renderer is tested against
    /// this exact same JSON, so the on-screen preview and the SVG/PDF export cannot
    /// silently drift apart. If the astronomy has to change, both sides change together.
    const GOLDEN_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/assets/golden/reference-geometry.json"
    );

    fn load_golden() -> Value {
        let raw = std::fs::read_to_string(GOLDEN_PATH)
            .unwrap_or_else(|e| panic!("cannot read golden file {GOLDEN_PATH}: {e}"));
        serde_json::from_str(&raw).expect("golden reference-geometry.json must be valid JSON")
    }

    fn expected_vector(sample: &Value, key: &str) -> [f64; 3] {
        let array = sample[key]
            .as_array()
            .unwrap_or_else(|| panic!("sample is missing the `{key}` array"));
        assert_eq!(array.len(), 3, "`{key}` must hold exactly 3 components");
        std::array::from_fn(|i| {
            array[i]
                .as_f64()
                .unwrap_or_else(|| panic!("`{key}[{i}]` must be a number"))
        })
    }

    fn assert_matches(actual: SkyPoint, expected: [f64; 3], tol: f64, what: &str, deg: f64) {
        let actual = [
            f64::from(actual.0),
            f64::from(actual.1),
            f64::from(actual.2),
        ];
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
            (obliquity - f64::from(OBLIQUITY_DEG)).abs() < 1e-6,
            "golden obliquity {obliquity} disagrees with backend constant {OBLIQUITY_DEG}"
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
                let norm = f64::from(x * x + y * y + z * z).sqrt();
                assert!(
                    (norm - 1.0).abs() < 1e-6,
                    "{what} point at {angle} rad has norm {norm}"
                );
            }
        }
    }
}
