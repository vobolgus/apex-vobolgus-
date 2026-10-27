use crate::models::RenderConfig;
use chrono::{Datelike, Timelike};
use rust_core::{
    CameraConfig, DateTime, PinholeProjection, Star, StereoProjection, ViewKind, ViewProjection,
    catalog::HipCatalog,
    julian_date,
    planets::{Body, PlanetPosition, all_positions},
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

mod constellation_renderer;
mod grids;

use self::constellation_renderer::{
    draw_constellation_boundaries, draw_constellation_lines, draw_constellation_names,
};
use self::grids::draw_coordinate_grids;

#[derive(Debug, Deserialize)]
pub struct ConstellationJson {
    pub name: String,
    pub lines: Vec<Vec<i32>>,
    pub center: [f32; 3],
}

// Загружаем созвездия из JSON один раз
pub fn get_constellations_data() -> &'static HashMap<String, ConstellationJson> {
    static CONSTELLATIONS: OnceLock<HashMap<String, ConstellationJson>> = OnceLock::new();
    CONSTELLATIONS.get_or_init(|| {
        let json_str = include_str!("../../assets/constellations/constellations_data.json");
        serde_json::from_str(json_str)
            .expect("invariant violation: embedded backend/assets/constellations/constellations_data.json is malformed; this indicates checked-in data corruption")
    })
}

pub fn get_constellation_boundaries_data() -> &'static HashMap<String, Vec<Vec<[f32; 2]>>> {
    static BOUNDARIES: OnceLock<HashMap<String, Vec<Vec<[f32; 2]>>>> = OnceLock::new();
    BOUNDARIES.get_or_init(|| {
        let json_str = include_str!("../../assets/constellations/constellation_boundaries.json");
        serde_json::from_str(json_str)
            .expect("invariant violation: embedded backend/assets/constellations/constellation_boundaries.json is malformed; this indicates checked-in data corruption")
    })
}

// Словарь русских названий созвездий для локализации
pub static CONSTELLATION_NAMES_RU: &[(&str, &str)] = &[
    ("AND", "Андромеда"),
    ("AQL", "Орёл"),
    ("AQR", "Водолей"),
    ("ARI", "Овен"),
    ("AUR", "Возничий"),
    ("BOO", "Волопас"),
    ("CAM", "Жираф"),
    ("CAP", "Козерог"),
    ("CAS", "Кассиопея"),
    ("CEP", "Цефей"),
    ("CET", "Кит"),
    ("CMA", "Большой Пёс"),
    ("CMI", "Малый Пёс"),
    ("CNC", "Рак"),
    ("COL", "Голубь"),
    ("COM", "Волосы Вероники"),
    ("COR", "Южная Корона"),
    ("CRA", "Южная Корона"),
    ("CRB", "Северная Корона"),
    ("CRU", "Южный Крест"),
    ("CRV", "Ворон"),
    ("CRT", "Чаша"),
    ("CVN", "Гончие Псы"),
    ("CYG", "Лебедь"),
    ("DEL", "Дельфин"),
    ("DRA", "Дракон"),
    ("EQU", "Малый Конь"),
    ("ERI", "Эридан"),
    ("GEM", "Близнецы"),
    ("GRU", "Журавль"),
    ("HER", "Геркулес"),
    ("HYA", "Гидра"),
    ("LEO", "Лев"),
    ("LIB", "Весы"),
    ("LYR", "Лира"),
    ("OPH", "Змееносец"),
    ("ORI", "Орион"),
    ("PEG", "Пегас"),
    ("PER", "Персей"),
    ("PSC", "Рыбы"),
    ("SCO", "Скорпион"),
    ("SCT", "Щит"),
    ("SER", "Змея"),
    ("SGR", "Стрелец"),
    ("TAU", "Телец"),
    ("TRI", "Треугольник"),
    ("UMA", "Большая Медведица"),
    ("UMI", "Малая Медведица"),
    ("VIR", "Дева"),
    ("VUL", "Лисичка"),
    ("SAG", "Стрелец"),
];

pub fn localize_constellation(abbr: &str, default_name: &str) -> String {
    for &(key, val) in CONSTELLATION_NAMES_RU {
        if key == abbr {
            return val.to_string();
        }
    }
    default_name.to_string()
}

pub struct SvgGenerator;

fn planet_name(body: Body) -> &'static str {
    match body {
        Body::Sun => "sun",
        Body::Mercury => "mercury",
        Body::Venus => "venus",
        Body::Earth => "earth",
        Body::Moon => "moon",
        Body::Mars => "mars",
        Body::Jupiter => "jupiter",
        Body::Saturn => "saturn",
        Body::Uranus => "uranus",
        Body::Neptune => "neptune",
    }
}

fn planet_label(body: Body) -> &'static str {
    match body {
        Body::Sun => "Sun",
        Body::Mercury => "Mercury",
        Body::Venus => "Venus",
        Body::Earth => "Earth",
        Body::Moon => "Moon",
        Body::Mars => "Mars",
        Body::Jupiter => "Jupiter",
        Body::Saturn => "Saturn",
        Body::Uranus => "Uranus",
        Body::Neptune => "Neptune",
    }
}

fn planet_color(body: Body) -> &'static str {
    match body {
        Body::Sun => "#FFD166",
        Body::Mercury => "#B4B0AA",
        Body::Venus => "#F4E0A0",
        Body::Earth => "#4A78D0",
        Body::Moon => "#E8E8E8",
        Body::Mars => "#E27D60",
        Body::Jupiter => "#D9A45C",
        Body::Saturn => "#C9B27B",
        Body::Uranus => "#7FD8D8",
        Body::Neptune => "#6E8FE0",
    }
}

fn planet_radius(position: &PlanetPosition, magnitude_scale: f32) -> f32 {
    let base = (magnitude_scale * 1.3 * 10.0f32.powf(-0.16 * position.magnitude as f32)).max(0.6);
    match position.body {
        Body::Sun => base.min(12.0),
        Body::Moon => base.min(10.0),
        _ => base.min(12.0),
    }
}

/// Star radius of the generator preview, in its px: `frontend/src/lib/constants.ts`
/// (STAR_BASE_RADIUS_PX, STAR_MAG_COEFF, STAR_MIN_RADIUS_PX). A `view` is sized in
/// those px, so the exported stars come out as large as on screen.
fn preview_star_radius(v_mag: f32) -> f32 {
    const BASE_RADIUS_PX: f32 = 4.0;
    const MAG_COEFF: f32 = 0.75;
    const MIN_RADIUS_PX: f32 = 0.5;
    (BASE_RADIUS_PX - MAG_COEFF * v_mag).max(MIN_RADIUS_PX)
}

/// Length of one preview px in chart units (`view.px`): everything sized in preview
/// px (star and planet radii, line widths, text) is multiplied by it. 1 without a view.
fn preview_px(config: &RenderConfig) -> f32 {
    config
        .view
        .as_ref()
        .and_then(|view| view.px)
        .map_or(1.0, |px| px as f32)
}

/// Where a chart nested in a larger SVG goes, in the parent's units.
#[derive(Debug, Clone, Copy)]
pub struct Placement {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// RFC 3339 (`2025-06-01T22:00:00Z`, as in SPEC), `YYYY-MM-DD HH:MM:SS` or a bare
/// date, read as UTC.
fn parse_datetime(text: &str) -> Option<DateTime> {
    let naive = if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(text) {
        parsed.naive_utc()
    } else if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S") {
        naive
    } else {
        chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
            .ok()?
            .and_hms_opt(0, 0, 0)?
    };
    Some(DateTime::new(
        naive.year(),
        naive.month(),
        naive.day(),
        naive.hour(),
        naive.minute(),
        naive.second(),
    ))
}

impl SvgGenerator {
    /// The preview camera of `config.view`, if it has a valid one.
    pub fn view_projection(config: &RenderConfig) -> Option<ViewProjection> {
        let view = config.view.as_ref()?;
        let kind = if config.projection == "stereo" {
            ViewKind::Stereo
        } else {
            ViewKind::Pinhole
        };
        let default_fov = match kind {
            ViewKind::Stereo => 180.0,
            ViewKind::Pinhole => 60.0,
        };
        ViewProjection::new(
            kind,
            view.right,
            view.up,
            view.forward,
            config.fov_deg.map_or(default_fov, f64::from),
            view.width,
            view.height,
        )
    }

    /// The chart as a standalone SVG document.
    pub fn render_map(config: &RenderConfig, hip_catalog: &HipCatalog) -> String {
        Self::render_chart(config, hip_catalog, "", None)
    }

    /// The chart for a document holding several: every `id` it emits starts with
    /// `id_prefix`, and with a `placement` its root `<svg>` sits in that box of the
    /// parent SVG (aspect kept) instead of filling the viewport.
    pub fn render_chart(
        config: &RenderConfig,
        hip_catalog: &HipCatalog,
        id_prefix: &str,
        placement: Option<Placement>,
    ) -> String {
        let is_stereo = config.projection == "stereo";
        let view = Self::view_projection(config);
        let px = preview_px(config);
        let sky_mask = format!("{id_prefix}sky-mask");

        // Определяем размеры холста
        let (width, height) = if is_stereo {
            (800, 800)
        } else {
            let h = 800;
            let aspect = config.aspect_ratio.unwrap_or(1.5);
            ((h as f32 * aspect) as u32, h)
        };
        // A view brings its own size, in preview px.
        let (canvas_width, canvas_height) = match &view {
            Some(view) => (view.width() as f32, view.height() as f32),
            None => (width as f32, height as f32),
        };

        let bg_color = &config.style.background_color;
        let star_color = &config.style.star_color;
        let const_color = &config.style.constellation_line_color;
        let grid_color = &config.style.grid_color;
        let font_family = &config.style.font_family;

        // Pre-allocate to avoid O(n²) reallocations during SVG build.
        // Empirically derived from full-sky maps ~200KB; round to power-of-2.
        let mut svg = String::with_capacity(256 * 1024);
        match placement {
            None => svg.push_str(&format!(
                r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}" width="100%" height="100%">"##,
                canvas_width, canvas_height
            )),
            // Nested: the parent declares the namespace and the box.
            Some(place) => svg.push_str(&format!(
                r##"<svg x="{}" y="{}" width="{}" height="{}" viewBox="0 0 {} {}">"##,
                place.x, place.y, place.width, place.height, canvas_width, canvas_height
            )),
        }

        // Добавляем фон. "none" leaves it out: on a page the paper shows through.
        if !bg_color.eq_ignore_ascii_case("none") {
            svg.push_str(&format!(
                r##"<rect width="100%" height="100%" fill="{}" />"##,
                bg_color
            ));
        }

        // Для стереографической проекции создаем clip-path
        let center_x = canvas_width / 2.0;
        let center_y = canvas_height / 2.0;
        let sky_radius = match &view {
            Some(view) => view.half_extent().0 as f32,
            None => 380.0,
        };

        if is_stereo {
            svg.push_str(&format!(
                r##"<defs><clipPath id="{}"><circle cx="{}" cy="{}" r="{}" /></clipPath></defs>"##,
                sky_mask, center_x, center_y, sky_radius
            ));
            if let Some(ref chart_color) = config.style.chart_color {
                svg.push_str(&format!(
                    r##"<circle cx="{}" cy="{}" r="{}" fill="{}" />"##,
                    center_x, center_y, sky_radius, chart_color
                ));
            }
            svg.push_str(&format!(r##"<g clip-path="url(#{})">"##, sky_mask));
        } else {
            if let Some(ref chart_color) = config.style.chart_color {
                svg.push_str(&format!(
                    r##"<rect width="100%" height="100%" fill="{}" />"##,
                    chart_color
                ));
            }
            if view.is_some() {
                // Lines run past the frame; keep them off the page around it in a PDF.
                svg.push_str(&format!(
                    r##"<defs><clipPath id="{}"><rect width="{}" height="{}" /></clipPath></defs>"##,
                    sky_mask, canvas_width, canvas_height
                ));
                svg.push_str(&format!(r##"<g clip-path="url(#{})">"##, sky_mask));
            } else {
                svg.push_str(r##"<g>"##);
            }
        }

        // Парсим время
        let dt = config
            .datetime
            .as_deref()
            .and_then(parse_datetime)
            .unwrap_or_else(|| DateTime::new(2024, 6, 14, 6, 10, 0));

        // Настраиваем камеру для Pinhole
        let camera_config = if !is_stereo {
            let fov = config.fov_deg.unwrap_or(60.0) as f64;
            let aspect = config.aspect_ratio.unwrap_or(1.5) as f64;
            Some(CameraConfig::from_fov_and_aspect(fov, aspect, height))
        } else {
            None
        };

        // Направление камеры для Pinhole
        let center_dir = if !is_stereo {
            let mut dir = [1.0, 0.0, 0.0];
            if let Some(custom_dir) = config.center_direction {
                let norm = ((custom_dir[0] as f64).powi(2)
                    + (custom_dir[1] as f64).powi(2)
                    + (custom_dir[2] as f64).powi(2))
                .sqrt();
                if norm > 1e-7 {
                    dir = [
                        custom_dir[0] as f64 / norm,
                        custom_dir[1] as f64 / norm,
                        custom_dir[2] as f64 / norm,
                    ];
                }
            }
            if config.center_direction.is_none()
                && let Some(ref const_abbr) = config.constellation
                && let Some(c_data) = get_constellations_data().get(const_abbr)
            {
                dir = [
                    c_data.center[0] as f64,
                    c_data.center[1] as f64,
                    c_data.center[2] as f64,
                ];
            }

            dir
        } else {
            [0.0, 0.0, 0.0]
        };

        let tilt_angle = config.tilt_angle.unwrap_or(0.0) as f64;
        // The handler requires the observer when there is no view; the view ignores it.
        let latitude = config.latitude.unwrap_or(0.0);
        let longitude = config.longitude.unwrap_or(0.0);

        // Вспомогательная функция для проецирования звезды/точки ECI
        let project_point = |x: f32, y: f32, z: f32| -> Option<(f32, f32)> {
            if let Some(ref view) = view {
                view.project(x, y, z)
            } else if is_stereo {
                let res = StereoProjection::project(x, y, z, latitude, longitude, dt)?;
                let scale = 190.0;
                let svg_x = center_x + res.x * scale;
                let svg_y = center_y - res.y * scale;
                Some((svg_x, svg_y))
            } else {
                let camera = camera_config.as_ref()?;
                let res = PinholeProjection::project(x, y, z, center_dir, tilt_angle, camera)?;
                Some((res.x_pix, res.y_pix))
            }
        };
        // Stars and planets only go into the file when they reach the chart.
        let on_chart =
            |x: f32, y: f32, r: f32| view.as_ref().is_none_or(|view| view.touches_chart(x, y, r));

        // 1. Отрисовка координатных сеток
        draw_coordinate_grids(&mut svg, config, grid_color, &project_point);

        // 2. Линии созвездий
        let constellations = get_constellations_data();
        let target_constellation = config.constellation.as_ref();

        let mag_limit = config.magnitude_limit.unwrap_or(6.5);
        let stars = hip_catalog.get_stars(mag_limit, None);
        let star_map: HashMap<i32, &Star> = stars.iter().map(|s| (s.hip_id, s)).collect();

        draw_constellation_boundaries(
            &mut svg,
            config,
            get_constellation_boundaries_data(),
            target_constellation,
            const_color,
            &project_point,
        );

        draw_constellation_lines(
            &mut svg,
            config,
            constellations,
            target_constellation,
            &star_map,
            const_color,
            &project_point,
        );

        // 3. Звезды
        let mag_scale = config.style.magnitude_scale;
        for star in &stars {
            if let Some((cx, cy)) = project_point(star.x, star.y, star.z) {
                let r = if view.is_some() {
                    preview_star_radius(star.v_mag) * mag_scale
                } else {
                    (mag_scale * 1.3 * 10.0f32.powf(-0.16 * star.v_mag)).clamp(0.6, 12.0)
                } * px;
                if !on_chart(cx, cy, r) {
                    continue;
                }
                svg.push_str(&format!(
                    r##"<circle cx="{:.2}" cy="{:.2}" r="{:.2}" fill="{}" />"##,
                    cx, cy, r, star_color
                ));
            }
        }

        // 3.1 Планеты
        if config.layers.planets {
            let time_fraction =
                (dt.hour as f64 + dt.minute as f64 / 60.0 + dt.second as f64 / 3600.0) / 24.0;
            let jd_ut = julian_date(dt.year, dt.month, dt.day) + time_fraction;
            let effective_mag_limit = (mag_limit * mag_scale.max(0.1)) as f64;

            for planet in all_positions(jd_ut) {
                if planet.body == Body::Earth || planet.magnitude > effective_mag_limit {
                    continue;
                }

                let [x, y, z] = planet.unit_vector;
                if let Some((cx, cy)) = project_point(x as f32, y as f32, z as f32) {
                    let slug = planet_name(planet.body);
                    let label = planet_label(planet.body);
                    let r = planet_radius(&planet, mag_scale) * px;
                    if !on_chart(cx, cy, r) {
                        continue;
                    }
                    let color = planet_color(planet.body);

                    svg.push_str(&format!(
                        r##"<circle id="{}planet-{}" data-planet="{}" cx="{:.2}" cy="{:.2}" r="{:.2}" fill="{}" stroke="#0008" stroke-width="{}" />"##,
                        id_prefix,
                        slug,
                        slug,
                        cx,
                        cy,
                        r,
                        color,
                        0.5 * px
                    ));

                    if config.layers.constellation_names {
                        svg.push_str(&format!(
                            r##"<text data-planet-label="{}" x="{:.2}" y="{:.2}" fill="{}" font-family="{}" font-size="{}" text-anchor="start">{}</text>"##,
                            slug,
                            cx + r + 4.0 * px,
                            cy - r - 2.0 * px,
                            color,
                            font_family,
                            10.0 * px,
                            label
                        ));
                    }
                }
            }
        }

        // 6. Названия созвездий
        draw_constellation_names(
            &mut svg,
            config,
            constellations,
            target_constellation,
            font_family,
            &project_point,
        );

        svg.push_str("</g>");

        // 6.1 The sky's edge, 1 preview px wide and inset by half of that, so the
        // chart's own viewport does not clip half of the stroke away.
        if let Some(ref outline) = config.style.chart_outline {
            let stroke = px;
            if is_stereo {
                svg.push_str(&format!(
                    r##"<circle cx="{}" cy="{}" r="{}" fill="none" stroke="{}" stroke-width="{}" />"##,
                    center_x,
                    center_y,
                    (sky_radius - stroke / 2.0).max(0.0),
                    outline,
                    stroke
                ));
            } else {
                svg.push_str(&format!(
                    r##"<rect x="{}" y="{}" width="{}" height="{}" fill="none" stroke="{}" stroke-width="{}" />"##,
                    stroke / 2.0,
                    stroke / 2.0,
                    (canvas_width - stroke).max(0.0),
                    (canvas_height - stroke).max(0.0),
                    outline,
                    stroke
                ));
            }
        }

        // 7. Оформление рамки для круглой стереографической карты.
        // Only for the observer's horizon chart: a view has no horizon to label.
        if is_stereo && view.is_none() {
            if config.layers.zenith {
                svg.push_str(&format!(
                    r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="1.0" stroke-opacity="0.5" />"##,
                    center_x - 8.0, center_y, center_x + 8.0, center_y, grid_color
                ));
                svg.push_str(&format!(
                    r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="1.0" stroke-opacity="0.5" />"##,
                    center_x, center_y - 8.0, center_x, center_y + 8.0, grid_color
                ));
            }

            let label_r = sky_radius + 12.0;
            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#FF6B6B" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle">N</text>"##,
                center_x, center_y - label_r + 4.0, font_family
            ));
            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#FFFFFF" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle">S</text>"##,
                center_x, center_y + label_r + 6.0, font_family
            ));
            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#FFFFFF" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle" dominant-baseline="middle">W</text>"##,
                center_x - label_r - 4.0, center_y, font_family
            ));
            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#FFFFFF" font-family="{}" font-size="12" font-weight="bold" text-anchor="middle" dominant-baseline="middle">E</text>"##,
                center_x + label_r + 4.0, center_y, font_family
            ));

            svg.push_str(&format!(
                r##"<circle cx="{}" cy="{}" r="{}" fill="none" stroke="{}" stroke-width="2.5" />"##,
                center_x, center_y, sky_radius, grid_color
            ));
        }

        // 8. Печать информации на карте
        if config.print_info.unwrap_or(false)
            && let (Some(lat_deg), Some(lon_deg)) = (config.latitude, config.longitude)
        {
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
            let info_y = canvas_height - 40.0 * px;

            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#A0A0A0" font-family="{}" font-size="{}" opacity="0.8">Lat: {} | Lon: {}</text>"##,
                25.0 * px,
                info_y,
                font_family,
                11.0 * px,
                lat_str,
                lon_str
            ));

            let dt_display = config
                .datetime
                .as_deref()
                .unwrap_or("2024-06-14 06:10:00")
                .to_string();
            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#A0A0A0" font-family="{}" font-size="{}" opacity="0.8">Time: {} UTC</text>"##,
                25.0 * px,
                info_y + 16.0 * px,
                font_family,
                11.0 * px,
                dt_display
            ));
        }

        // 9. Подвал
        if let Some(ref footer) = config.footer_text {
            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#606060" font-family="{}" font-size="{}" text-anchor="middle">{}</text>"##,
                canvas_width / 2.0,
                canvas_height - 15.0 * px,
                font_family,
                10.0 * px,
                footer
            ));
        }

        svg.push_str("</svg>");
        svg
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LayersConfig, RenderConfig, StyleConfig, ViewConfig};
    use rust_core::{
        ViewKind, ViewProjection,
        catalog::HipCatalog,
        julian_date,
        planets::{Body, all_positions},
    };
    use std::sync::OnceLock;

    fn baseline_config() -> RenderConfig {
        RenderConfig {
            projection: "stereo".to_string(),
            datetime: Some("2024-06-14 06:10:00".to_string()),
            latitude: Some(55.75),
            longitude: Some(37.62),
            magnitude_limit: Some(6.0),
            fov_deg: Some(60.0),
            aspect_ratio: Some(1.5),
            constellation: None,
            center_direction: None,
            tilt_angle: Some(0.0),
            view: None,
            layers: LayersConfig {
                ecliptic: false,
                equator: false,
                galactic_equator: false,
                planets: false, // intentional baseline fixture: layer disabled by default in generator tests
                horizontal_grid: false,
                equatorial_grid: false,
                constellations: false,
                constellation_boundaries: false,
                constellation_names: false,
                zenith: false,
                poles: false,
            },
            style: StyleConfig {
                star_color: "#FFFFFF".to_string(),
                constellation_line_color: "#808080".to_string(),
                grid_color: "#404040".to_string(),
                background_color: "#05050A".to_string(),
                chart_color: None,
                chart_outline: None,
                font_family: "sans-serif".to_string(),
                magnitude_scale: 1.0,
            },
            print_info: Some(false),
            footer_text: None,
        }
    }

    fn hip_catalog() -> &'static HipCatalog {
        static HIP: OnceLock<HipCatalog> = OnceLock::new();
        HIP.get_or_init(HipCatalog::new)
    }

    fn render(cfg: &RenderConfig) -> String {
        SvgGenerator::render_map(cfg, hip_catalog())
    }

    fn count_occurrences(haystack: &str, needle: &str) -> usize {
        haystack.match_indices(needle).count()
    }

    #[test]
    fn render_stereo_produces_svg_envelope() {
        let cfg = baseline_config();
        let svg = render(&cfg);

        assert!(svg.contains("<svg"), "must contain <svg>");
        assert!(svg.contains("</svg>"), "must contain </svg>");
    }

    #[test]
    fn render_stereo_adds_clip_mask_and_border_elements() {
        let cfg = baseline_config();
        let svg = render(&cfg);

        assert!(svg.contains("clipPath id=\"sky-mask\""));
        assert!(svg.contains("<circle cx=\"400\" cy=\"400\" r=\"380\""));
        assert!(svg.contains(">N</text>"));
        assert!(svg.contains(">S</text>"));
    }

    #[test]
    fn render_pinhole_produces_svg_without_stereo_mask() {
        let mut cfg = baseline_config();
        cfg.projection = "pinhole".to_string();
        cfg.fov_deg = Some(60.0);
        cfg.aspect_ratio = Some(1.5);
        cfg.constellation = Some("ORI".to_string());

        let svg = render(&cfg);

        assert!(svg.contains("<svg"));
        assert!(!svg.contains("sky-mask"));
    }

    #[test]
    fn render_respects_magnitude_limit() {
        let mut cfg = baseline_config();

        cfg.magnitude_limit = Some(0.0);
        let svg_bright = render(&cfg);

        cfg.magnitude_limit = Some(6.0);
        let svg_full = render(&cfg);

        let bright_circles = count_occurrences(&svg_bright, "<circle cx=");
        let full_circles = count_occurrences(&svg_full, "<circle cx=");
        assert!(
            full_circles > bright_circles,
            "magnitude 6.0 should render more stars than 0.0"
        );
    }

    #[test]
    fn render_with_equatorial_grid_layer_adds_paths() {
        let mut cfg = baseline_config();
        cfg.layers.equatorial_grid = true;

        let svg = render(&cfg);

        assert!(svg.contains("stroke-width=\"0.5\" stroke-opacity=\"0.25\""));
        assert!(count_occurrences(&svg, "<path d=") > 0);
    }

    #[test]
    fn render_with_ecliptic_layer_adds_solid_path() {
        let mut cfg = baseline_config();
        cfg.layers.ecliptic = true;

        let svg = render(&cfg);

        assert!(svg.contains("stroke=\"#DC2626\""));
        assert!(!svg.contains("stroke=\"#DC2626\" stroke-width=\"2.4\" stroke-dasharray"));
    }

    #[test]
    fn render_with_galactic_equator_layer_adds_solid_path() {
        let mut cfg = baseline_config();
        cfg.layers.galactic_equator = true;

        let svg = render(&cfg);

        assert!(
            svg.contains("stroke=\"#B58CFF\""),
            "expected galactic equator stroke color in SVG"
        );
        assert!(
            !svg.contains("stroke=\"#B58CFF\" stroke-width=\"2.4\" stroke-dasharray"),
            "galactic equator must be solid"
        );
    }

    #[test]
    fn render_without_galactic_equator_omits_path() {
        let cfg = baseline_config();
        let svg = render(&cfg);
        assert!(!svg.contains("stroke=\"#B58CFF\""));
    }

    #[test]
    fn render_with_constellation_layers_draws_lines_and_names() {
        let mut cfg = baseline_config();
        cfg.projection = "pinhole".to_string();
        cfg.constellation = Some("ORI".to_string());
        cfg.layers.constellations = true;
        cfg.layers.constellation_names = true;

        let svg = render(&cfg);

        // Lines are great-circle arcs in the constellation line style.
        assert!(svg.contains(r##"stroke="#808080" stroke-width="0.6" stroke-opacity="0.35""##));
        assert!(svg.contains("Орион"));
    }

    /// The generator preview's camera looking at Orion, east to the right as on screen.
    fn view_config(projection: &str) -> RenderConfig {
        let mut cfg = baseline_config();
        cfg.projection = projection.to_string();
        cfg.latitude = None;
        cfg.longitude = None;
        let ra = 5.6f64.to_radians() * 15.0;
        cfg.view = Some(ViewConfig {
            right: [-ra.sin(), ra.cos(), 0.0],
            up: [0.0, 0.0, 1.0],
            forward: [ra.cos(), ra.sin(), 0.0],
            width: if projection == "stereo" {
                1104.0
            } else {
                1200.0
            },
            height: if projection == "stereo" {
                1104.0
            } else {
                650.0
            },
            px: None,
        });
        cfg.fov_deg = Some(if projection == "stereo" { 120.0 } else { 80.0 });
        cfg.style.background_color = "#0a0a0b".to_string();
        cfg.style.chart_color = Some("#ffffff".to_string());
        cfg.style.star_color = "#000000".to_string();
        cfg
    }

    #[test]
    fn view_sizes_the_chart_and_fills_the_disc() {
        let svg = render(&view_config("stereo"));
        assert!(svg.contains(r##"viewBox="0 0 1104 1104""##));
        assert!(svg.contains(r##"<circle cx="552" cy="552" r="552" fill="#ffffff" />"##));
        // No horizon in a view: no compass letters and no horizon ring.
        assert!(!svg.contains(">N</text>"));
        assert!(!svg.contains(r##"stroke-width="2.5""##));
    }

    #[test]
    fn view_keeps_only_the_stars_on_the_chart_at_the_preview_size() {
        let cfg = view_config("pinhole");
        let view = SvgGenerator::view_projection(&cfg).unwrap();
        let svg = render(&cfg);
        let stars: Vec<(f32, f32, f32)> = svg
            .split(r##"fill="#000000""##)
            .filter_map(|chunk| {
                let start = chunk.rfind("<circle ")?;
                let attr = |name: &str| -> Option<f32> {
                    let at = chunk[start..].find(&format!("{name}=\""))? + start + name.len() + 2;
                    chunk[at..].split('"').next()?.parse().ok()
                };
                Some((attr("cx")?, attr("cy")?, attr("r")?))
            })
            .collect();
        assert!(stars.len() > 50, "Orion at 80° shows plenty of stars");
        for (x, y, r) in &stars {
            assert!(view.touches_chart(*x, *y, *r));
            assert!(
                *r >= 0.5 && *r <= 4.0 + 0.75 * 1.5,
                "preview radii, got {r}"
            );
        }
    }

    #[test]
    fn view_follows_the_basis_it_is_given() {
        // Betelgeuse (HIP 27989) is east of Rigel (HIP 24436): right of it with this basis.
        let catalog = hip_catalog();
        let stars = catalog.get_stars(1.0, None);
        let find = |hip: i32| stars.iter().find(|s| s.hip_id == hip).unwrap();
        let (betelgeuse, rigel) = (find(27989), find(24436));
        let cfg = view_config("pinhole");
        let view = SvgGenerator::view_projection(&cfg).unwrap();
        let b = view
            .project(betelgeuse.x, betelgeuse.y, betelgeuse.z)
            .unwrap();
        let r = view.project(rigel.x, rigel.y, rigel.z).unwrap();
        assert!(b.0 > r.0 && b.1 < r.1, "Betelgeuse upper right of Rigel");

        let mut mirrored = cfg.clone();
        let basis = mirrored.view.as_mut().unwrap();
        basis.right = basis.right.map(|c| -c);
        let view = SvgGenerator::view_projection(&mirrored).unwrap();
        let b = view
            .project(betelgeuse.x, betelgeuse.y, betelgeuse.z)
            .unwrap();
        let r = view.project(rigel.x, rigel.y, rigel.z).unwrap();
        assert!(b.0 < r.0, "a flipped right flips the chart");
    }

    #[test]
    fn view_draws_constellation_boundaries_when_asked() {
        let mut cfg = view_config("stereo");
        cfg.style.constellation_line_color = "#000000".to_string();
        let boundary = r##"stroke="#000000" stroke-width="0.4" stroke-opacity="0.15""##;
        assert!(!render(&cfg).contains(boundary));
        cfg.layers.constellation_boundaries = true;
        assert!(render(&cfg).contains(boundary));
    }

    /// The elements of an SVG, each without its leading `<`.
    fn elements(svg: &str) -> Vec<&str> {
        svg.split('<').filter(|e| !e.is_empty()).collect()
    }

    fn attr_text<'a>(element: &'a str, name: &str) -> Option<&'a str> {
        let at = element.find(&format!(" {name}=\""))? + name.len() + 3;
        element[at..].split('"').next()
    }

    fn attr(element: &str, name: &str) -> Option<f32> {
        attr_text(element, name)?.parse().ok()
    }

    fn without_attrs(element: &str, names: &[&str]) -> String {
        let mut element = element.to_string();
        for name in names {
            if let Some(at) = element.find(&format!(" {name}=\"")) {
                let value_end =
                    at + name.len() + 3 + element[at + name.len() + 3..].find('"').unwrap();
                element.replace_range(at..=value_end, "");
            }
        }
        element
    }

    #[test]
    fn view_px_scales_star_radii_and_line_widths_in_place() {
        let mut cfg = view_config("stereo");
        cfg.layers.constellations = true;
        cfg.layers.constellation_boundaries = true;
        cfg.layers.ecliptic = true;
        cfg.layers.equator = true;
        // Mid-June the Sun, Mercury, Venus and Jupiter are around Orion.
        cfg.layers.planets = true;
        let with_px = |px: Option<f64>| {
            let mut cfg = cfg.clone();
            cfg.view.as_mut().unwrap().px = px;
            render(&cfg)
        };
        let base = with_px(None);
        assert_eq!(base, with_px(Some(1.0)), "px defaults to 1");
        let doubled = with_px(Some(2.0));
        let (base, doubled) = (elements(&base), elements(&doubled));

        let is_star = |e: &&str| e.starts_with("circle ") && e.contains(r##"fill="#000000""##);
        let is_planet = |e: &&str| e.contains("data-planet=");
        let stars = |svg: &[&str]| -> HashMap<(String, String), f32> {
            svg.iter()
                .filter(|e| is_star(e))
                .map(|e| {
                    let at = |name| attr_text(e, name).unwrap().to_string();
                    ((at("cx"), at("cy")), attr(e, "r").unwrap())
                })
                .collect()
        };

        // Stars stay where they are at twice the radius. A star just off the chart
        // may reach into it with the bigger radius, and only such a star is new.
        let (base_stars, doubled_stars) = (stars(&base), stars(&doubled));
        assert!(base_stars.len() > 100);
        let view = SvgGenerator::view_projection(&cfg).unwrap();
        for (position, r) in &doubled_stars {
            match base_stars.get(position) {
                // Radii are printed to 0.01.
                Some(base_r) => assert!((r - 2.0 * base_r).abs() <= 0.015, "{position:?}"),
                None => {
                    let x: f32 = position.0.parse().unwrap();
                    let y: f32 = position.1.parse().unwrap();
                    assert!(!view.touches_chart(x, y, r / 2.0 - 0.02), "{position:?}");
                }
            }
        }
        assert!(base_stars.keys().all(|p| doubled_stars.contains_key(p)));

        // Planets too, with their outline.
        let planets = |svg: &[&str]| -> Vec<(String, f32, f32)> {
            svg.iter()
                .filter(|e| is_planet(e))
                .map(|e| {
                    let slug = attr_text(e, "data-planet").unwrap().to_string();
                    (
                        slug,
                        attr(e, "r").unwrap(),
                        attr(e, "stroke-width").unwrap(),
                    )
                })
                .collect()
        };
        let (base_planets, doubled_planets) = (planets(&base), planets(&doubled));
        assert!(base_planets.iter().any(|(slug, _, _)| slug == "sun"));
        assert_eq!(base_planets.len(), doubled_planets.len());
        for ((slug, r, width), (doubled_slug, doubled_r, doubled_width)) in
            base_planets.iter().zip(&doubled_planets)
        {
            assert_eq!(slug, doubled_slug);
            assert!((doubled_r - 2.0 * r).abs() <= 0.015, "{slug}");
            assert_eq!(*doubled_width, 2.0 * width, "{slug}");
        }

        // Every other element is the same, but for its stroke width, which doubles.
        // (This view draws no text; `view_px_scales_text_sizes_and_label_offsets`.)
        let is_rest = |e: &&str| !is_star(e) && !is_planet(e);
        let base_rest: Vec<&str> = base.into_iter().filter(is_rest).collect();
        let doubled_rest: Vec<&str> = doubled.into_iter().filter(is_rest).collect();
        assert_eq!(base_rest.len(), doubled_rest.len());
        let mut lines = 0;
        for (element, doubled) in base_rest.iter().zip(&doubled_rest) {
            assert_eq!(
                without_attrs(element, &["stroke-width"]),
                without_attrs(doubled, &["stroke-width"])
            );
            if let Some(width) = attr(element, "stroke-width") {
                assert_eq!(attr(doubled, "stroke-width"), Some(2.0 * width));
                lines += 1;
            }
        }
        assert!(lines > 50, "lines of every kind were compared, got {lines}");
    }

    #[test]
    fn view_px_scales_text_sizes_and_label_offsets() {
        let mut cfg = view_config("stereo");
        cfg.layers.constellations = true;
        cfg.layers.constellation_names = true;
        cfg.layers.planets = true;
        cfg.latitude = Some(55.75);
        cfg.longitude = Some(37.62);
        cfg.print_info = Some(true);
        cfg.footer_text = Some("Skycharts".to_string());
        let with_px = |px: Option<f64>| {
            let mut cfg = cfg.clone();
            cfg.view.as_mut().unwrap().px = px;
            render(&cfg)
        };
        let (base, doubled) = (with_px(None), with_px(Some(2.0)));
        let (base, doubled) = (elements(&base), elements(&doubled));
        fn texts<'a>(svg: &[&'a str]) -> Vec<&'a str> {
            svg.iter()
                .copied()
                .filter(|e| e.starts_with("text "))
                .collect()
        }
        let planet = |svg: &[&str], slug: &str| -> (f32, f32) {
            let circle = svg
                .iter()
                .find(|e| attr_text(e, "data-planet") == Some(slug))
                .unwrap();
            (attr(circle, "cx").unwrap(), attr(circle, "cy").unwrap())
        };
        let (base_texts, doubled_texts) = (texts(&base), texts(&doubled));
        assert_eq!(base_texts.len(), doubled_texts.len());
        let close = |a: f32, b: f32| (a - b).abs() <= 0.02;
        let (mut names, mut labels, mut info) = (0, 0, 0);
        for (text, twice) in base_texts.iter().zip(&doubled_texts) {
            let size = attr(text, "font-size").unwrap();
            assert_eq!(attr(twice, "font-size"), Some(2.0 * size), "{text}");
            let (x, y) = (attr(text, "x").unwrap(), attr(text, "y").unwrap());
            let (x2, y2) = (attr(twice, "x").unwrap(), attr(twice, "y").unwrap());
            if let Some(slug) = attr_text(text, "data-planet-label") {
                // Off the planet's disc, which grows too: the offset from its centre doubles.
                let (cx, cy) = planet(&base, slug);
                let (cx2, cy2) = planet(&doubled, slug);
                assert!(close(x2 - cx2, 2.0 * (x - cx)), "{text}");
                assert!(close(cy2 - y2, 2.0 * (cy - y)), "{text}");
                labels += 1;
            } else if text.contains(r##"fill="#A0A0A0""##) || text.contains(r##"fill="#606060""##) {
                // The info lines and the footer: their distance from the bottom edge doubles.
                assert!(close(1104.0 - y2, 2.0 * (1104.0 - y)), "{text}");
                let centred = text.contains(r##"text-anchor="middle""##);
                assert!(close(x2, if centred { x } else { 2.0 * x }), "{text}");
                info += 1;
            } else {
                // A constellation name: 12 preview px under its centre, which stays.
                assert!(close(x2, x) && close(y2 - y, 12.0), "{text}");
                names += 1;
            }
        }
        assert!(
            names > 0 && labels > 0,
            "names {names}, planet labels {labels}"
        );
        assert_eq!(info, 3, "two info lines and the footer");
    }

    #[test]
    fn chart_outline_strokes_the_sky_edge_one_preview_px_wide_inside_it() {
        let mut cfg = view_config("stereo");
        assert!(!render(&cfg).contains("#c9ced6"));
        cfg.style.chart_outline = Some("#c9ced6".to_string());
        cfg.view.as_mut().unwrap().px = Some(0.5);
        assert!(render(&cfg).contains(
            r##"<circle cx="552" cy="552" r="551.75" fill="none" stroke="#c9ced6" stroke-width="0.5" />"##
        ));

        let mut cfg = view_config("pinhole");
        cfg.style.chart_outline = Some("#c9ced6".to_string());
        cfg.view.as_mut().unwrap().px = Some(2.0);
        assert!(render(&cfg).contains(
            r##"<rect x="1" y="1" width="1198" height="648" fill="none" stroke="#c9ced6" stroke-width="2" />"##
        ));

        // Without a view, 1 px around the 800 px chart's disc.
        let mut cfg = baseline_config();
        cfg.style.chart_outline = Some("#c9ced6".to_string());
        assert!(render(&cfg).contains(
            r##"<circle cx="400" cy="400" r="379.5" fill="none" stroke="#c9ced6" stroke-width="1" />"##
        ));
    }

    #[test]
    fn background_none_paints_nothing_behind_the_chart() {
        let mut cfg = view_config("pinhole");
        cfg.style.background_color = "none".to_string();
        let svg = render(&cfg);
        assert!(!svg.contains("fill=\"none\" />"), "no background rect");
        assert_eq!(
            svg.matches(r##"<rect width="100%" height="100%""##).count(),
            1,
            "only the sky's own fill"
        );
        assert!(svg.contains(r##"<rect width="100%" height="100%" fill="#ffffff" />"##));
        svg2pdf::usvg::Tree::from_str(&svg, &svg2pdf::usvg::Options::default())
            .expect("a chart without a background is still valid SVG");
    }

    #[test]
    fn render_chart_prefixes_every_id_and_nests_at_the_placement() {
        let mut cfg = view_config("stereo");
        cfg.layers.planets = true;
        let standalone = render(&cfg);
        assert_eq!(
            standalone,
            SvgGenerator::render_chart(&cfg, hip_catalog(), "", None)
        );
        let nested = SvgGenerator::render_chart(
            &cfg,
            hip_catalog(),
            "p1c2-",
            Some(Placement {
                x: 12.0,
                y: 20.5,
                width: 90.0,
                height: 90.0,
            }),
        );
        assert!(nested.starts_with(
            r##"<svg x="12" y="20.5" width="90" height="90" viewBox="0 0 1104 1104">"##
        ));

        let ids = |svg: &str| -> Vec<String> {
            svg.split(" id=\"")
                .skip(1)
                .map(|rest| rest.split('"').next().unwrap().to_string())
                .collect()
        };
        let standalone_ids = ids(&standalone);
        assert!(standalone_ids.contains(&"sky-mask".to_string()));
        assert!(standalone_ids.iter().any(|id| id.starts_with("planet-")));
        let prefixed: Vec<String> = standalone_ids
            .iter()
            .map(|id| format!("p1c2-{id}"))
            .collect();
        assert_eq!(ids(&nested), prefixed);
        assert!(nested.contains(r##"clip-path="url(#p1c2-sky-mask)""##));
        assert!(!nested.contains("url(#sky-mask)"));
    }

    /// Cross-language golden, as for the reference lines: the TypeScript preview is
    /// tested against this exact JSON, so a view exports where the preview draws it.
    #[test]
    fn golden_view_projection_matches_the_preview() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/assets/golden/view-projection.json"
        );
        let raw = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("cannot read golden file {path}: {e}"));
        let golden: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let tolerance = golden["tolerance_px"].as_f64().unwrap();
        let vec3 =
            |v: &serde_json::Value| -> [f64; 3] { std::array::from_fn(|i| v[i].as_f64().unwrap()) };
        let cases = golden["cases"].as_array().unwrap();
        assert!(cases.len() >= 4);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let kind = if case["projection"] == "stereo" {
                ViewKind::Stereo
            } else {
                ViewKind::Pinhole
            };
            let view = ViewProjection::new(
                kind,
                vec3(&case["right"]),
                vec3(&case["up"]),
                vec3(&case["forward"]),
                case["fov_deg"].as_f64().unwrap(),
                case["width"].as_f64().unwrap(),
                case["height"].as_f64().unwrap(),
            )
            .unwrap_or_else(|| panic!("{name}: the golden camera must be valid"));
            let (half_w, half_h) = view.half_extent();
            for point in case["points"].as_array().unwrap() {
                let [x, y, z] = vec3(&point["sky"]);
                let expected = [
                    point["px"][0].as_f64().unwrap(),
                    point["px"][1].as_f64().unwrap(),
                ];
                let (nx, ny) = view
                    .normalized(x, y, z)
                    .unwrap_or_else(|| panic!("{name}: {:?} must project", point["sky"]));
                let actual = [
                    view.width() * 0.5 + nx * half_w,
                    view.height() * 0.5 - ny * half_h,
                ];
                for axis in 0..2 {
                    assert!(
                        (actual[axis] - expected[axis]).abs() <= tolerance,
                        "RUST AND TYPESCRIPT HAVE DRIFTED: {name}, point {:?}, {} is {} in the export and {} in the preview",
                        point["sky"],
                        ["x", "y"][axis],
                        actual[axis],
                        expected[axis]
                    );
                }
            }
        }
    }

    #[test]
    fn reads_rfc3339_datetimes() {
        let dt = parse_datetime("2025-06-01T22:00:00Z").unwrap();
        assert_eq!((dt.year, dt.month, dt.day, dt.hour), (2025, 6, 1, 22));
        let dt = parse_datetime("2025-06-02T01:30:00+03:00").unwrap();
        assert_eq!((dt.day, dt.hour, dt.minute), (1, 22, 30));
        assert!(parse_datetime("2025-06-01 22:00:00").is_some());
        assert!(parse_datetime("yesterday").is_none());
    }

    #[test]
    fn render_with_info_and_footer_prints_labels() {
        let mut cfg = baseline_config();
        cfg.print_info = Some(true);
        cfg.footer_text = Some("Unit test footer".to_string());

        let svg = render(&cfg);

        assert!(svg.contains("Lat:"));
        assert!(svg.contains("Lon:"));
        assert!(svg.contains("Time:"));
        assert!(svg.contains("Unit test footer"));
    }

    #[test]
    fn test_planets_layer_off_no_circles() {
        let mut cfg = baseline_config();
        cfg.layers.planets = false;

        let svg = render(&cfg);
        assert!(
            !svg.contains("data-planet="),
            "no planet markers should be emitted when layer is off"
        );
    }

    #[test]
    fn test_planets_layer_on_renders_visible() {
        let mut cfg = baseline_config();
        cfg.projection = "pinhole".to_string();
        cfg.fov_deg = Some(170.0);
        cfg.aspect_ratio = Some(1.0);
        cfg.center_direction = Some([1.0, 0.0, 0.0]);
        cfg.layers.planets = true;
        cfg.layers.constellation_names = true;
        cfg.datetime = Some("2024-01-01 00:00:00".to_string());
        cfg.magnitude_limit = Some(8.0);

        let svg = render(&cfg);
        let _ = std::fs::write("/tmp/svg_with_planets.svg", &svg);
        let count = count_occurrences(&svg, "data-planet=");
        assert!(
            count >= 4,
            "expected at least 4 visible planets, got {count}"
        );
    }

    #[test]
    fn test_planets_in_pinhole() {
        let jd = julian_date(2024, 1, 1);
        let jupiter = all_positions(jd)
            .into_iter()
            .find(|p| p.body == Body::Jupiter)
            .expect("Jupiter must exist in planet batch");

        let mut cfg = baseline_config();
        cfg.projection = "pinhole".to_string();
        cfg.fov_deg = Some(45.0);
        cfg.aspect_ratio = Some(1.0);
        cfg.datetime = Some("2024-01-01 00:00:00".to_string());
        cfg.center_direction = Some([
            jupiter.unit_vector[0] as f32,
            jupiter.unit_vector[1] as f32,
            jupiter.unit_vector[2] as f32,
        ]);
        cfg.layers.planets = true;

        let svg = render(&cfg);
        assert!(
            svg.contains("data-planet=\"jupiter\""),
            "expected Jupiter marker in pinhole projection"
        );
    }
}
