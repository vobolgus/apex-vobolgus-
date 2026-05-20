use crate::models::RenderConfig;
use rust_core::{
    Star, DateTime, StereoProjection, PinholeProjection, CameraConfig,
    catalog::{HipCatalog, MessierCatalog}
};
use std::collections::HashMap;
use std::sync::OnceLock;
use serde::Deserialize;
use chrono::{Datelike, Timelike};

mod grids;
mod constellation_renderer;

use self::constellation_renderer::{draw_constellation_lines, draw_constellation_names};
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
        let json_str = include_str!("../../../astrageek/catalogs/constellations/constellations_data.json");
        serde_json::from_str(json_str)
            .expect("invariant violation: embedded astrageek/catalogs/constellations/constellations_data.json is malformed; this indicates checked-in data corruption")
    })
}

// Словарь русских названий созвездий для локализации
pub static CONSTELLATION_NAMES_RU: &[(&str, &str)] = &[
    ("AND", "Андромеда"), ("AQL", "Орёл"), ("AQR", "Водолей"),
    ("ARI", "Овен"), ("AUR", "Возничий"), ("BOO", "Волопас"),
    ("CAM", "Жираф"), ("CAP", "Козерог"), ("CAS", "Кассиопея"),
    ("CEP", "Цефей"), ("CET", "Кит"), ("CMA", "Большой Пёс"),
    ("CMI", "Малый Пёс"), ("CNC", "Рак"), ("COL", "Голубь"),
    ("COM", "Волосы Вероники"), ("COR", "Южная Корона"), ("CRA", "Южная Корона"),
    ("CRB", "Северная Корона"), ("CRU", "Южный Крест"), ("CRV", "Ворон"),
    ("CRT", "Чаша"), ("CVN", "Гончие Псы"), ("CYG", "Лебедь"),
    ("DEL", "Дельфин"), ("DRA", "Дракон"), ("EQU", "Малый Конь"),
    ("ERI", "Эридан"), ("GEM", "Близнецы"), ("GRU", "Журавль"),
    ("HER", "Геркулес"), ("HYA", "Гидра"), ("LEO", "Лев"),
    ("LIB", "Весы"), ("LYR", "Лира"), ("OPH", "Змееносец"),
    ("ORI", "Орион"), ("PEG", "Пегас"), ("PER", "Персей"),
    ("PSC", "Рыбы"), ("SCO", "Скорпион"), ("SCT", "Щит"),
    ("SER", "Змея"), ("SGR", "Стрелец"), ("TAU", "Телец"),
    ("TRI", "Треугольник"), ("UMA", "Большая Медведица"), ("UMI", "Малая Медведица"),
    ("VIR", "Дева"), ("VUL", "Лисичка"), ("SAG", "Стрелец"),
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

impl SvgGenerator {
    pub fn render_map(
        config: &RenderConfig,
        hip_catalog: &HipCatalog,
        messier_catalog: &MessierCatalog,
        highlight_star_hip: Option<i32>,
        highlight_messier: Option<i32>,
    ) -> String {
        let is_stereo = config.projection == "stereo";
        
        // Определяем размеры холста
        let (width, height) = if is_stereo {
            (800, 800)
        } else {
            let h = 800;
            let aspect = config.aspect_ratio.unwrap_or(1.5);
            ((h as f32 * aspect) as u32, h)
        };

        let bg_color = &config.style.background_color;
        let star_color = &config.style.star_color;
        let const_color = &config.style.constellation_line_color;
        let grid_color = &config.style.grid_color;
        let font_family = &config.style.font_family;

        // Pre-allocate to avoid O(n²) reallocations during SVG build.
        // Empirically derived from full-sky maps ~200KB; round to power-of-2.
        let mut svg = String::with_capacity(256 * 1024);
        svg.push_str(&format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}" width="100%" height="100%">"##,
            width, height
        ));

        // Добавляем фон
        svg.push_str(&format!(
            r##"<rect width="100%" height="100%" fill="{}" />"##,
            bg_color
        ));

        // Для стереографической проекции создаем clip-path
        let center_x = width as f32 / 2.0;
        let center_y = height as f32 / 2.0;
        let sky_radius = 380.0;

        if is_stereo {
            svg.push_str(&format!(
                r##"<defs><clipPath id="sky-mask"><circle cx="{}" cy="{}" r="{}" /></clipPath></defs>"##,
                center_x, center_y, sky_radius
            ));
            svg.push_str(r##"<g clip-path="url(#sky-mask)">"##);
        } else {
            svg.push_str(r##"<g>"##);
        }

        // Парсим время
        let dt = if let Some(ref dt_str) = config.datetime {
            if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(dt_str, "%Y-%m-%d %H:%M:%S") {
                DateTime::new(naive.year(), naive.month(), naive.day(), naive.hour(), naive.minute(), naive.second())
            } else if let Ok(naive_date) = chrono::NaiveDate::parse_from_str(dt_str, "%Y-%m-%d") {
                DateTime::new(naive_date.year(), naive_date.month(), naive_date.day(), 0, 0, 0)
            } else {
                DateTime::new(2024, 6, 14, 6, 10, 0)
            }
        } else {
            DateTime::new(2024, 6, 14, 6, 10, 0)
        };

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
                let norm = ((custom_dir[0] as f64).powi(2) + (custom_dir[1] as f64).powi(2) + (custom_dir[2] as f64).powi(2)).sqrt();
                if norm > 1e-7 {
                    dir = [
                        custom_dir[0] as f64 / norm,
                        custom_dir[1] as f64 / norm,
                        custom_dir[2] as f64 / norm,
                    ];
                }
            }
            if config.center_direction.is_none() {
                if let Some(ref const_abbr) = config.constellation {
                    if let Some(c_data) = get_constellations_data().get(const_abbr) {
                        dir = [c_data.center[0] as f64, c_data.center[1] as f64, c_data.center[2] as f64];
                    }
                }
            }
            // Если мы подсвечиваем звезду, камера должна смотреть ровно на неё!
            if let Some(hip_id) = highlight_star_hip {
                let temp_stars = hip_catalog.get_stars(7.5, None);
                if let Some(star) = temp_stars.iter().find(|s| s.hip_id == hip_id) {
                    dir = [star.x as f64, star.y as f64, star.z as f64];
                }
            }
            // Аналогично для Мессье
            if let Some(m_num) = highlight_messier {
                if let Some(obj) = messier_catalog.get_object_by_number(m_num) {
                    dir = [obj.x as f64, obj.y as f64, obj.z as f64];
                }
            }
            dir
        } else {
            [0.0, 0.0, 0.0]
        };

        let tilt_angle = config.tilt_angle.unwrap_or(0.0) as f64;

        // Вспомогательная функция для проецирования звезды/точки ECI
        let project_point = |x: f32, y: f32, z: f32| -> Option<(f32, f32)> {
            if is_stereo {
                let res = StereoProjection::project(x, y, z, config.latitude, config.longitude, dt)?;
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

        // 1. Отрисовка координатных сеток
        draw_coordinate_grids(&mut svg, config, grid_color, &project_point);

        // 2. Линии созвездий
        let constellations = get_constellations_data();
        let target_constellation = config.constellation.as_ref();

        let mag_limit = config.magnitude_limit.unwrap_or(6.5);
        let stars = hip_catalog.get_stars(mag_limit, None);
        let star_map: HashMap<i32, &Star> = stars.iter().map(|s| (s.hip_id, s)).collect();

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
            if let Some((px, py)) = project_point(star.x, star.y, star.z) {
                let r = (mag_scale * 1.3 * 10.0f32.powf(-0.16 * star.v_mag)).clamp(0.6, 12.0);
                svg.push_str(&format!(
                    r##"<circle cx="{:.2}" cy="{:.2}" r="{:.2}" fill="{}" />"##,
                    px, py, r, star_color
                ));
            }
        }

        // 4. Подсветка Звезды ( highlight_star_hip )
        if let Some(hip_id) = highlight_star_hip {
            let temp_stars = hip_catalog.get_stars(7.5, None);
            if let Some(star) = temp_stars.iter().find(|s| s.hip_id == hip_id) {
                if let Some((px, py)) = project_point(star.x, star.y, star.z) {
                    svg.push_str(&format!(
                        r##"<circle cx="{:.2}" cy="{:.2}" r="15" fill="none" stroke="#FF6B6B" stroke-width="2.0" opacity="0.9" />"##,
                        px, py
                    ));
                    svg.push_str(&format!(
                        r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}" stroke="#FF6B6B" stroke-width="1.0" opacity="0.8" />"##,
                        px - 20.0, py, px + 20.0, py
                    ));
                    svg.push_str(&format!(
                        r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}" stroke="#FF6B6B" stroke-width="1.0" opacity="0.8" />"##,
                        px, py - 20.0, px, py + 20.0
                    ));
                }
            }
        }

        // 5. Подсветка Объекта Мессье ( highlight_messier )
        if let Some(m_num) = highlight_messier {
            if let Some(obj) = messier_catalog.get_object_by_number(m_num) {
                if let Some((px, py)) = project_point(obj.x, obj.y, obj.z) {
                    let type_names = [
                        (1, "Галактика"),
                        (2, "Шаровое скопление"),
                        (3, "Рассеянное скопление"),
                        (4, "Туманность"),
                        (5, "Остаток сверхновой"),
                        (6, "Звёздное облако"),
                        (7, "Двойная звезда"),
                    ];
                    let mut type_name = "Объект";
                    for &(t_id, t_name) in &type_names {
                        if t_id == obj.obj_type {
                            type_name = t_name;
                            break;
                        }
                    }

                    let color = obj.type_color();
                    let size_px = (obj.size * 3.0).clamp(15.0, 150.0);

                    // Отрисовываем красивый маркер
                    svg.push_str(&format!(
                        r##"<circle cx="{:.2}" cy="{:.2}" r="{:.2}" fill="none" stroke="{}" stroke-width="2.5" opacity="0.9" />"##,
                        px, py, size_px, color
                    ));
                    svg.push_str(&format!(
                        r##"<circle cx="{:.2}" cy="{:.2}" r="3" fill="{}" opacity="1.0" />"##,
                        px, py, color
                    ));

                    // Красивый информационный заголовок сверху
                    let title_text = format!(
                        "Тип: {}  |  Зв. вел.: {:.1}m  |  Угл. р-р: {:.1}'",
                        type_name, obj.v_mag, obj.size
                    );
                    svg.push_str(&format!(
                        r##"<text x="{}" y="30" fill="#FFFFFF" font-family="{}" font-size="12" font-weight="500" text-anchor="middle">{}</text>"##,
                        width as f32 / 2.0, font_family, title_text
                    ));
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

        // 7. Оформление рамки для круглой стереографической карты
        if is_stereo {
            if config.layers.zenith {
                svg.push_str(&format!(
                    r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="1.0" opacity="0.5" />"##,
                    center_x - 8.0, center_y, center_x + 8.0, center_y, grid_color
                ));
                svg.push_str(&format!(
                    r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="1.0" opacity="0.5" />"##,
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
        if config.print_info.unwrap_or(false) {
            let lat_deg = config.latitude;
            let lon_deg = config.longitude;
            let lat_str = format!("{:.2}° {}", lat_deg.abs(), if lat_deg >= 0.0 { "N" } else { "S" });
            let lon_str = format!("{:.2}° {}", lon_deg.abs(), if lon_deg >= 0.0 { "E" } else { "W" });
            let info_y = height as f32 - 40.0;

            svg.push_str(&format!(
                r##"<text x="25" y="{}" fill="#A0A0A0" font-family="{}" font-size="11" opacity="0.8">Lat: {} | Lon: {}</text>"##,
                info_y, font_family, lat_str, lon_str
            ));
            
            let dt_display = format!("{}", config.datetime.as_deref().unwrap_or("2024-06-14 06:10:00"));
            svg.push_str(&format!(
                r##"<text x="25" y="{}" fill="#A0A0A0" font-family="{}" font-size="11" opacity="0.8">Time: {} UTC</text>"##,
                info_y + 16.0, font_family, dt_display
            ));
        }

        // 9. Подвал
        if let Some(ref footer) = config.footer_text {
            svg.push_str(&format!(
                r##"<text x="{}" y="{}" fill="#606060" font-family="{}" font-size="10" text-anchor="middle">{}</text>"##,
                width as f32 / 2.0, height as f32 - 15.0, font_family, footer
            ));
        }

        svg.push_str("</svg>");
        svg
    }
}
