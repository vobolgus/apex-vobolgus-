use std::collections::HashMap;

use crate::models::RenderConfig;
use rust_core::Star;
use rust_core::coords::ra_dec_to_unit_vector;

use super::grids::{PolylineStyle, draw_polyline, great_circle_points};
use super::{ConstellationJson, localize_constellation};

pub(super) fn draw_constellation_lines<F>(
    svg: &mut String,
    config: &RenderConfig,
    constellations: &HashMap<String, ConstellationJson>,
    target_constellation: Option<&String>,
    star_map: &HashMap<i32, &Star>,
    const_color: &str,
    project_point: &F,
) where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    if !config.layers.constellations {
        return;
    }

    // The preview's CONSTELLATION_LINE_STYLE.
    let style = PolylineStyle {
        stroke: const_color,
        width: "0.6",
        opacity: "0.35",
    };

    for (abbr, const_data) in constellations {
        if let Some(target) = target_constellation
            && target != abbr
        {
            continue;
        }

        for line in &const_data.lines {
            for i in 0..(line.len() - 1) {
                let id1 = line[i];
                let id2 = line[i + 1];

                if let (Some(s1), Some(s2)) = (star_map.get(&id1), star_map.get(&id2)) {
                    // A great-circle arc, cut where it leaves the chart, as in the preview.
                    draw_polyline(
                        svg,
                        great_circle_points((s1.x, s1.y, s1.z), (s2.x, s2.y, s2.z)),
                        project_point,
                        &style,
                    );
                }
            }
        }
    }
}

/// IAU boundaries, each polygon edge traced as a great-circle arc like the preview's.
/// `boundaries` maps an abbreviation to polygons of `[ra_deg, dec_deg]` vertices.
pub(super) fn draw_constellation_boundaries<F>(
    svg: &mut String,
    config: &RenderConfig,
    boundaries: &HashMap<String, Vec<Vec<[f32; 2]>>>,
    target_constellation: Option<&String>,
    line_color: &str,
    project_point: &F,
) where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    if !config.layers.constellation_boundaries {
        return;
    }

    // The preview's CONSTELLATION_BOUNDARY_STYLE.
    let style = PolylineStyle {
        stroke: line_color,
        width: "0.4",
        opacity: "0.15",
    };

    for (abbr, polygons) in boundaries {
        if let Some(target) = target_constellation
            && target != abbr
        {
            continue;
        }
        for polygon in polygons {
            let vertices: Vec<(f32, f32, f32)> = polygon
                .iter()
                .map(|&[ra_deg, dec_deg]| {
                    ra_dec_to_unit_vector(ra_deg.to_radians(), dec_deg.to_radians())
                })
                .collect();
            // One path per polygon: the arcs share their end points, so skip each repeat.
            let points = vertices.windows(2).enumerate().flat_map(|(i, edge)| {
                great_circle_points(edge[0], edge[1]).skip(usize::from(i > 0))
            });
            draw_polyline(svg, points, project_point, &style);
        }
    }
}

pub(super) fn draw_constellation_names<F>(
    svg: &mut String,
    config: &RenderConfig,
    constellations: &HashMap<String, ConstellationJson>,
    target_constellation: Option<&String>,
    font_family: &str,
    project_point: &F,
) where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    if !config.layers.constellation_names {
        return;
    }

    for (abbr, const_data) in constellations {
        if let Some(target) = target_constellation
            && target != abbr
        {
            continue;
        }

        let cx = const_data.center[0];
        let cy = const_data.center[1];
        let cz = const_data.center[2];

        if let Some((px, py)) = project_point(cx, cy, cz) {
            let ru_name = localize_constellation(abbr, &const_data.name);
            svg.push_str(&format!(
                r##"<text x="{:.2}" y="{:.2}" fill="#FFFFFF" font-family="{}" font-size="10" opacity="0.75" text-anchor="middle" dominant-baseline="middle">{}</text>"##,
                px, py + 12.0, font_family, ru_name
            ));
        }
    }
}
