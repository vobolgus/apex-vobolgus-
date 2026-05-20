use std::collections::HashMap;

use crate::models::RenderConfig;
use rust_core::Star;

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

                if let (Some(s1), Some(s2)) = (star_map.get(&id1), star_map.get(&id2))
                    && let (Some((p1_x, p1_y)), Some((p2_x, p2_y))) = (
                        project_point(s1.x, s1.y, s1.z),
                        project_point(s2.x, s2.y, s2.z),
                    )
                {
                    svg.push_str(&format!(
                        r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="0.8" opacity="0.6" />"##,
                        p1_x, p1_y, p2_x, p2_y, const_color
                    ));
                }
            }
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
