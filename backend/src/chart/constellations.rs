//! The constellations: their IAU boundaries, their stick figures and their names.

use std::collections::HashMap;

use rust_core::catalog::Star;
use rust_core::coords::{Direction, ra_dec_to_unit_vector};
use rust_core::projections::Project;

use super::polyline::{self, PolylineStyle, great_circle_points};
use super::scene::Scene;
use crate::constellations::{boundaries, figures, localized_name};
use crate::svg::SvgWriter;

/// The constellations of `table` a chart draws: the one it names, or all of them.
fn chosen<'t, T>(
    target: Option<&'t str>,
    table: &'t HashMap<String, T>,
) -> impl Iterator<Item = (&'t String, &'t T)> {
    table
        .iter()
        .filter(move |(abbr, _)| target.is_none_or(|target| target == abbr.as_str()))
}

/// IAU boundaries, each polygon edge traced as a great-circle arc like the preview's.
pub(super) fn draw_boundaries(svg: &mut SvgWriter, scene: &Scene<'_>) {
    if !scene.layers.constellation_boundaries {
        return;
    }

    // The preview's CONSTELLATION_BOUNDARY_STYLE.
    let style = PolylineStyle {
        stroke: &scene.style.constellation_line_color,
        width: 0.4 * scene.px,
        opacity: "0.15",
    };

    for (_, polygons) in chosen(scene.constellation, boundaries()) {
        for polygon in polygons {
            let vertices: Vec<Direction> = polygon
                .iter()
                .map(|&[ra_deg, dec_deg]| {
                    ra_dec_to_unit_vector(ra_deg.to_radians(), dec_deg.to_radians())
                })
                .collect();
            // One path per polygon: the arcs share their end points, so skip each repeat.
            let points = vertices.windows(2).enumerate().flat_map(|(i, edge)| {
                great_circle_points(edge[0], edge[1]).skip(usize::from(i > 0))
            });
            polyline::draw(svg, points, scene, &style);
        }
    }
}

/// The stick figures: a line between two stars is drawn when the chart has both, that
/// is when both are brighter than its magnitude limit.
pub(super) fn draw_figures(svg: &mut SvgWriter, scene: &Scene<'_>, stars: &[&Star]) {
    if !scene.layers.constellations {
        return;
    }
    let stars: HashMap<i32, &Star> = stars.iter().map(|star| (star.hip_id, *star)).collect();

    // The preview's CONSTELLATION_LINE_STYLE.
    let style = PolylineStyle {
        stroke: &scene.style.constellation_line_color,
        width: 0.6 * scene.px,
        opacity: "0.35",
    };

    for (_, figure) in chosen(scene.constellation, figures()) {
        for line in &figure.lines {
            for pair in line.windows(2) {
                if let (Some(&s1), Some(&s2)) = (stars.get(&pair[0]), stars.get(&pair[1])) {
                    // A great-circle arc, cut where it leaves the chart, as in the preview.
                    polyline::draw(
                        svg,
                        great_circle_points(s1.into(), s2.into()),
                        scene,
                        &style,
                    );
                }
            }
        }
    }
}

/// Each constellation's name under its centre, in Russian where there is one.
pub(super) fn draw_names(svg: &mut SvgWriter, scene: &Scene<'_>) {
    if !scene.layers.constellation_names {
        return;
    }
    let px = scene.px;
    let font_family = &scene.style.font_family;

    for (abbr, figure) in chosen(scene.constellation, figures()) {
        if let Some((x, y)) = scene.project(figure.center.into()) {
            let ru_name = localized_name(abbr, &figure.name);
            write!(
                svg,
                r##"<text x="{:.2}" y="{:.2}" fill="#FFFFFF" font-family="{}" font-size="{}" opacity="0.75" text-anchor="middle" dominant-baseline="middle">{}</text>"##,
                x,
                y + 12.0 * px,
                font_family,
                10.0 * px,
                ru_name
            );
        }
    }
}
