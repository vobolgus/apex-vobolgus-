//! The words round a chart: the compass points of the observer's horizon, the
//! observer's place and time, the footer.

use super::scene::Scene;
use super::time::DEFAULT_TIME_TEXT;
use crate::svg::SvgWriter;

/// N, S, W and E round the horizon of the observer's chart, north at the top and in red.
pub(super) fn draw_compass(svg: &mut SvgWriter, scene: &Scene<'_>) {
    let (center_x, center_y) = (scene.center_x, scene.center_y);
    let font_family = &scene.config.style.font_family;
    let label_r = scene.sky_radius + 12.0;
    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#FF6B6B" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle">N</text>"##,
        center_x,
        center_y - label_r + 4.0,
        font_family
    );
    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#FFFFFF" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle">S</text>"##,
        center_x,
        center_y + label_r + 6.0,
        font_family
    );
    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#FFFFFF" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle" dominant-baseline="middle">W</text>"##,
        center_x - label_r - 4.0,
        center_y,
        font_family
    );
    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#FFFFFF" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle" dominant-baseline="middle">E</text>"##,
        center_x + label_r + 4.0,
        center_y,
        font_family
    );
}

/// Where and when the chart is for, in its lower left corner: printed when asked for
/// and the observer is known.
// 8. Печать информации на карте
pub(super) fn draw_info(svg: &mut SvgWriter, scene: &Scene<'_>) {
    let config = scene.config;
    if !config.print_info.unwrap_or(false) {
        return;
    }
    let (Some(lat_deg), Some(lon_deg)) = (config.latitude, config.longitude) else {
        return;
    };
    let px = scene.px;
    let font_family = &config.style.font_family;

    let lat_str = format!(
        "{:.2}° {}",
        lat_deg.abs(),
        if lat_deg >= 0.0 { "N" } else { "S" }
    );
    let lon_str = format!(
        "{:.2}° {}",
        lon_deg.abs(),
        if lon_deg >= 0.0 { "E" } else { "W" }
    );
    let info_y = scene.height - 40.0 * px;

    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#A0A0A0" font-family="{}" font-size="{}" opacity="0.8">Lat: {} | Lon: {}</text>"##,
        25.0 * px,
        info_y,
        font_family,
        11.0 * px,
        lat_str,
        lon_str
    );

    let dt_display = config.datetime.as_deref().unwrap_or(DEFAULT_TIME_TEXT);
    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#A0A0A0" font-family="{}" font-size="{}" opacity="0.8">Time: {} UTC</text>"##,
        25.0 * px,
        info_y + 16.0 * px,
        font_family,
        11.0 * px,
        dt_display
    );
}

/// The footer: a line of the client's own under the chart.
// 9. Подвал
pub(super) fn draw_footer(svg: &mut SvgWriter, scene: &Scene<'_>) {
    let Some(footer) = &scene.config.footer_text else {
        return;
    };
    let px = scene.px;
    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#606060" font-family="{}" font-size="{}" text-anchor="middle">{}</text>"##,
        scene.width / 2.0,
        scene.height - 15.0 * px,
        scene.config.style.font_family,
        10.0 * px,
        footer
    );
}
