//! The Sun, the Moon and the planets where they are at the chart's instant.

use rust_core::planets::{Body, PlanetPosition, all_positions};
use rust_core::projections::Project;
use rust_core::time::julian_date;

use super::scene::Scene;
use crate::svg::SvgWriter;

/// How a body is written into a chart.
struct Marker {
    /// Its name in the element's `id` and `data-planet`.
    slug: &'static str,
    /// Its name beside the disc.
    label: &'static str,
    /// The disc's fill, and the label's.
    color: &'static str,
}

/// The marker of `body`. The Earth has one for the match to be whole; no chart of
/// the sky shows it.
const fn marker(body: Body) -> Marker {
    let (slug, label, color) = match body {
        Body::Sun => ("sun", "Sun", "#FFD166"),
        Body::Mercury => ("mercury", "Mercury", "#B4B0AA"),
        Body::Venus => ("venus", "Venus", "#F4E0A0"),
        Body::Earth => ("earth", "Earth", "#4A78D0"),
        Body::Moon => ("moon", "Moon", "#E8E8E8"),
        Body::Mars => ("mars", "Mars", "#E27D60"),
        Body::Jupiter => ("jupiter", "Jupiter", "#D9A45C"),
        Body::Saturn => ("saturn", "Saturn", "#C9B27B"),
        Body::Uranus => ("uranus", "Uranus", "#7FD8D8"),
        Body::Neptune => ("neptune", "Neptune", "#6E8FE0"),
    };
    Marker { slug, label, color }
}

/// A body's disc: a star's radius for its magnitude, the Moon's capped lower than
/// the rest.
fn planet_radius(position: &PlanetPosition, magnitude_scale: f32) -> f32 {
    let base = (magnitude_scale * 1.3 * 10.0f32.powf(-0.16 * position.magnitude as f32)).max(0.6);
    let largest = if position.body == Body::Moon {
        10.0
    } else {
        12.0
    };
    base.min(largest)
}

/// The bodies brighter than the chart's limit, each with its name when the chart
/// names its constellations.
pub(super) fn draw(svg: &mut SvgWriter, scene: &Scene<'_>, mag_limit: f32) {
    if !scene.layers.planets {
        return;
    }
    let (px, time) = (scene.px, scene.time);
    let mag_scale = scene.style.magnitude_scale;

    let time_fraction =
        (f64::from(time.hour) + f64::from(time.minute) / 60.0 + f64::from(time.second) / 3600.0)
            / 24.0;
    let jd_ut = julian_date(time.year, time.month, time.day) + time_fraction;
    let effective_mag_limit = f64::from(mag_limit * mag_scale.max(0.1));

    for planet in all_positions(jd_ut) {
        if planet.magnitude > effective_mag_limit {
            continue;
        }

        if let Some((cx, cy)) = scene.project(planet.unit_vector.into()) {
            let Marker { slug, label, color } = marker(planet.body);
            let r = planet_radius(&planet, mag_scale) * px;
            if !scene.shows(cx, cy, r) {
                continue;
            }

            write!(
                svg,
                r##"<circle id="{}planet-{}" data-planet="{}" cx="{:.2}" cy="{:.2}" r="{:.2}" fill="{}" stroke="#0008" stroke-width="{}" />"##,
                scene.id_prefix,
                slug,
                slug,
                cx,
                cy,
                r,
                color,
                0.5 * px
            );

            if scene.layers.constellation_names {
                write!(
                    svg,
                    r#"<text data-planet-label="{}" x="{:.2}" y="{:.2}" fill="{}" font-family="{}" font-size="{}" text-anchor="start">{}</text>"#,
                    slug,
                    cx + r + 4.0 * px,
                    cy - r - 2.0 * px,
                    color,
                    scene.style.font_family,
                    10.0 * px,
                    label
                );
            }
        }
    }
}
