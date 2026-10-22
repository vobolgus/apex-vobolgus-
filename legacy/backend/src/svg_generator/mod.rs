// Extracted from backend/src/svg_generator/mod.rs at 05becf9 — game-only parts (Messier catalog + highlight_star_hip / highlight_messier). Full original: git show 05becf9:backend/src/svg_generator/mod.rs
//
// Эти параметры и ветки использовали только генераторы вопросов Sky Quiz
// (legacy/backend/src/question_factory/*, legacy/backend/src/handlers/game/gameplay.rs).
// Экспорт (POST /api/export) всегда передавал `&state.messier_catalog, None, None`,
// поэтому в живом генераторе сигнатура сокращена до
// `render_map(config: &RenderConfig, hip_catalog: &HipCatalog) -> String`.
// Справочный фрагмент, не компилируется.

use rust_core::catalog::{HipCatalog, MessierCatalog};

impl SvgGenerator {
    // Исходная сигнатура
    pub fn render_map(
        config: &RenderConfig,
        hip_catalog: &HipCatalog,
        messier_catalog: &MessierCatalog,
        highlight_star_hip: Option<i32>,
        highlight_messier: Option<i32>,
    ) -> String {
        // ...

        // Направление камеры для Pinhole
        let center_dir = if !is_stereo {
            // ... (center_direction / constellation — остались в живом коде)

            if let Some(hip_id) = highlight_star_hip
                && let Some(star) = hip_catalog
                    .get_stars(7.5, None)
                    .iter()
                    .find(|s| s.hip_id == hip_id)
            {
                dir = [star.x as f64, star.y as f64, star.z as f64];
            }

            if let Some(m_num) = highlight_messier
                && let Some(obj) = messier_catalog.get_object_by_number(m_num)
            {
                dir = [obj.x as f64, obj.y as f64, obj.z as f64];
            }

            dir
        } else {
            [0.0, 0.0, 0.0]
        };

        // ... (3.1 Планеты)

        // 4. Подсветка Звезды ( highlight_star_hip )
        if let Some(hip_id) = highlight_star_hip
            && let Some(star) = hip_catalog
                .get_stars(7.5, None)
                .iter()
                .find(|s| s.hip_id == hip_id)
            && let Some((px, py)) = project_point(star.x, star.y, star.z)
        {
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

        // 5. Подсветка Объекта Мессье ( highlight_messier )
        if let Some(m_num) = highlight_messier
            && let Some(obj) = messier_catalog.get_object_by_number(m_num)
            && let Some((px, py)) = project_point(obj.x, obj.y, obj.z)
        {
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
                width as f32 / 2.0,
                font_family,
                title_text
            ));
        }

        // ... (6. Названия созвездий и далее — остались в живом коде)
    }
}

#[cfg(test)]
mod tests {
    // Тестовый хелпер до удаления Мессье: каталоги подгружались парой.
    use rust_core::catalog::{HipCatalog, MessierCatalog};
    use std::sync::OnceLock;

    fn catalogs() -> (&'static HipCatalog, &'static MessierCatalog) {
        static HIP: OnceLock<HipCatalog> = OnceLock::new();
        static MESSIER: OnceLock<MessierCatalog> = OnceLock::new();
        (
            HIP.get_or_init(HipCatalog::new),
            MESSIER.get_or_init(MessierCatalog::new),
        )
    }

    fn render(cfg: &RenderConfig) -> String {
        let (hip, messier) = catalogs();
        SvgGenerator::render_map(cfg, hip, messier, None, None)
    }
}
