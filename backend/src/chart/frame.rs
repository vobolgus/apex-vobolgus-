//! What holds a chart together: the root element, the background, the sky's own
//! fill and clip, its outline, and the horizon of the observer's round chart.

use super::scene::Scene;
use super::{Placement, Projection};
use crate::svg::SvgWriter;

/// Opens the chart: its root `<svg>`, the background, the sky's fill and the group
/// everything on the sky is drawn in, clipped to the sky's edge.
pub(super) fn open(svg: &mut SvgWriter, scene: &Scene<'_>, placement: Option<Placement>) {
    let style = &scene.config.style;
    let (width, height) = (scene.width, scene.height);
    let sky_mask = format!("{}sky-mask", scene.id_prefix);

    match placement {
        None => write!(
            svg,
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%">"#
        ),
        // Nested: the parent declares the namespace and the box.
        Some(place) => write!(
            svg,
            r#"<svg x="{}" y="{}" width="{}" height="{}" viewBox="0 0 {} {}">"#,
            place.x, place.y, place.width, place.height, width, height
        ),
    }

    // Добавляем фон. "none" leaves it out: on a page the paper shows through.
    if !style.background_color.eq_ignore_ascii_case("none") {
        write!(
            svg,
            r#"<rect width="100%" height="100%" fill="{}" />"#,
            style.background_color
        );
    }

    match scene.projection {
        // Для стереографической проекции создаем clip-path
        Projection::Stereo => {
            let (center_x, center_y, sky_radius) =
                (scene.center_x, scene.center_y, scene.sky_radius);
            write!(
                svg,
                r#"<defs><clipPath id="{sky_mask}"><circle cx="{center_x}" cy="{center_y}" r="{sky_radius}" /></clipPath></defs>"#
            );
            if let Some(chart_color) = &style.chart_color {
                write!(
                    svg,
                    r#"<circle cx="{center_x}" cy="{center_y}" r="{sky_radius}" fill="{chart_color}" />"#
                );
            }
            write!(svg, r#"<g clip-path="url(#{sky_mask})">"#);
        }
        Projection::Pinhole => {
            if let Some(chart_color) = &style.chart_color {
                write!(
                    svg,
                    r#"<rect width="100%" height="100%" fill="{chart_color}" />"#
                );
            }
            if scene.has_view {
                // Lines run past the frame; keep them off the page around it in a PDF.
                write!(
                    svg,
                    r#"<defs><clipPath id="{sky_mask}"><rect width="{width}" height="{height}" /></clipPath></defs>"#
                );
                write!(svg, r#"<g clip-path="url(#{sky_mask})">"#);
            } else {
                svg.push_str("<g>");
            }
        }
    }
}

/// Closes the group of the sky.
pub(super) fn close_sky(svg: &mut SvgWriter) {
    svg.push_str("</g>");
}

/// Closes the chart.
pub(super) fn close(svg: &mut SvgWriter) {
    svg.push_str("</svg>");
}

/// The sky's edge, 1 preview px wide and inset by half of that, so the chart's own
/// viewport does not clip half of the stroke away.
pub(super) fn draw_outline(svg: &mut SvgWriter, scene: &Scene<'_>) {
    let Some(outline) = &scene.config.style.chart_outline else {
        return;
    };
    let stroke = scene.px;
    match scene.projection {
        Projection::Stereo => write!(
            svg,
            r#"<circle cx="{}" cy="{}" r="{}" fill="none" stroke="{}" stroke-width="{}" />"#,
            scene.center_x,
            scene.center_y,
            (scene.sky_radius - stroke / 2.0).max(0.0),
            outline,
            stroke
        ),
        Projection::Pinhole => write!(
            svg,
            r#"<rect x="{}" y="{}" width="{}" height="{}" fill="none" stroke="{}" stroke-width="{}" />"#,
            stroke / 2.0,
            stroke / 2.0,
            (scene.width - stroke).max(0.0),
            (scene.height - stroke).max(0.0),
            outline,
            stroke
        ),
    }
}

/// The cross at the zenith of the observer's horizon chart, when its layer is on.
pub(super) fn draw_zenith(svg: &mut SvgWriter, scene: &Scene<'_>) {
    if !scene.config.layers.zenith {
        return;
    }
    let (center_x, center_y) = (scene.center_x, scene.center_y);
    let grid_color = &scene.config.style.grid_color;
    write!(
        svg,
        r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="1.0" stroke-opacity="0.5" />"#,
        center_x - 8.0,
        center_y,
        center_x + 8.0,
        center_y,
        grid_color
    );
    write!(
        svg,
        r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="1.0" stroke-opacity="0.5" />"#,
        center_x,
        center_y - 8.0,
        center_x,
        center_y + 8.0,
        grid_color
    );
}

/// The horizon: the ring round the observer's sky.
pub(super) fn draw_horizon(svg: &mut SvgWriter, scene: &Scene<'_>) {
    write!(
        svg,
        r#"<circle cx="{}" cy="{}" r="{}" fill="none" stroke="{}" stroke-width="2.5" />"#,
        scene.center_x, scene.center_y, scene.sky_radius, scene.config.style.grid_color
    );
}
