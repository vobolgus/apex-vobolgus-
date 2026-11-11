//! The words round a chart: the compass points of the observer's horizon, the
//! observer's place and time, the footer.

use super::scene::Scene;
use crate::svg::SvgWriter;

/// What the info line in a chart's corner says: the observer's place and the time.
#[derive(Debug, Clone)]
pub(super) struct Info {
    /// The observer's latitude, degrees north.
    pub(super) latitude: f32,
    /// The observer's longitude, degrees east.
    pub(super) longitude: f32,
    /// The time as the request gave it, or the default instant's text.
    pub(super) time: String,
}

/// N, S, W and E round the horizon of the observer's chart, north at the top and in red.
pub(super) fn draw_compass(svg: &mut SvgWriter, scene: &Scene<'_>) {
    let (center_x, center_y) = (scene.center_x, scene.center_y);
    let font_family = &scene.style.font_family;
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
    let Some(info) = scene.info else {
        return;
    };
    let (lat_deg, lon_deg) = (info.latitude, info.longitude);
    let px = scene.px;
    let font_family = &scene.style.font_family;

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

    let dt_display = &info.time;
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
    let Some(footer) = scene.footer else {
        return;
    };
    let px = scene.px;
    write!(
        svg,
        r##"<text x="{}" y="{}" fill="#606060" font-family="{}" font-size="{}" text-anchor="middle">{}</text>"##,
        scene.width / 2.0,
        scene.height - 15.0 * px,
        scene.style.font_family,
        10.0 * px,
        footer
    );
}
