use super::{NAMED_STARS, QuestionData, QuestionFactory, STAR_FACTS, localize_star};
use crate::models::{LayersConfig, QuestionResponse, RenderConfig, StyleConfig};
use crate::svg_generator::SvgGenerator;
use anyhow::Result;
use rand::{Rng, seq::SliceRandom};
use rust_core::catalog::{HipCatalog, MessierCatalog};
use std::collections::HashSet;

const GAME_QUESTION_PLANETS_ENABLED: bool = false;

pub(super) fn generate(
    difficulty: &str,
    used_objects: &mut HashSet<String>,
    hip_catalog: &HipCatalog,
    messier_catalog: &MessierCatalog,
) -> Result<(QuestionResponse, QuestionData)> {
    let mut rng = rand::thread_rng();
    let mag_limit = QuestionFactory::get_magnitude_limit(difficulty);
    let stars = hip_catalog.get_stars(mag_limit, None);
    let star_ids: HashSet<i32> = stars.iter().map(|s| s.hip_id).collect();

    let available_stars: Vec<(i32, String)> = NAMED_STARS
        .iter()
        .filter(|&&(hip, _)| star_ids.contains(&hip) && !used_objects.contains(&hip.to_string()))
        .map(|&(hip, name)| (hip, name.to_string()))
        .collect();

    let mut pool = available_stars;
    if pool.is_empty() {
        used_objects.clear();
        pool = NAMED_STARS
            .iter()
            .filter(|&&(hip, _)| star_ids.contains(&hip))
            .map(|&(hip, name)| (hip, name.to_string()))
            .collect();
    }

    if pool.is_empty() {
        pool = NAMED_STARS
            .iter()
            .map(|&(hip, name)| (hip, name.to_string()))
            .collect();
    }

    let (correct_hip, correct_name_en) = pool
        .choose(&mut rng)
        .cloned()
        .unwrap_or((32349, "Sirius".to_string()));
    used_objects.insert(correct_hip.to_string());

    let correct_name_ru = localize_star(&correct_name_en);

    let all_stars = hip_catalog.get_stars(7.5, None);
    let star_ref = all_stars.iter().find(|s| s.hip_id == correct_hip);

    let (ra_deg, dec_deg) = if let Some(s) = star_ref {
        ((s.ra.to_degrees()) % 360.0, s.dec.to_degrees())
    } else {
        (100.0, 16.0)
    };

    let random_tilt = difficulty == "hard";
    let tilt_angle = if random_tilt {
        Some(rng.gen_range(0.0..360.0))
    } else {
        Some(0.0)
    };

    let config = RenderConfig {
        projection: "pinhole".to_string(),
        datetime: None,
        latitude: 45.0,
        longitude: 19.0,
        magnitude_limit: Some(mag_limit),
        fov_deg: Some(60.0),
        aspect_ratio: Some(1.0),
        constellation: None,
        center_direction: None,
        tilt_angle,
        layers: LayersConfig {
            ecliptic: false,
            equator: false,
            galactic_equator: false,
            // intentional: game question images render without planets for deterministic visuals
            planets: GAME_QUESTION_PLANETS_ENABLED,
            horizontal_grid: false,
            equatorial_grid: false,
            constellations: true,
            constellation_names: false,
            zenith: false,
            poles: false,
        },
        style: StyleConfig {
            star_color: "#FFFFFF".to_string(),
            constellation_line_color: "#808080".to_string(),
            grid_color: "#404040".to_string(),
            background_color: "#05050A".to_string(),
            font_family: "sans-serif".to_string(),
            magnitude_scale: 1.0,
        },
        print_info: Some(false),
        footer_text: None,
    };

    let image_svg = SvgGenerator::render_map(
        &config,
        hip_catalog,
        messier_catalog,
        Some(correct_hip),
        None,
    );

    let mut other_names: Vec<String> = NAMED_STARS
        .iter()
        .filter(|&&(hip, _)| hip != correct_hip)
        .map(|&(_, name)| localize_star(name))
        .collect();
    other_names.shuffle(&mut rng);

    let mut options = vec![correct_name_ru.clone()];
    options.extend(other_names.into_iter().take(3));
    options.shuffle(&mut rng);

    let question_text = match difficulty {
        "easy" => "Как называется звезда, отмеченная красным?".to_string(),
        "medium" => "Введите название звезды, отмеченной красным".to_string(),
        _ => {
            "Введите название звезды и её экваториальные координаты с точностью до ±10°".to_string()
        }
    };

    let hint = match difficulty {
        "easy" => format!("Это {}", correct_name_ru),
        "medium" => format!(
            "Название этой звезды состоит из {} символов и начинается на «{}»",
            correct_name_ru.chars().count(),
            correct_name_ru.chars().next().unwrap_or(' ')
        ),
        _ => {
            let ra_h = ra_deg / 15.0;
            format!("RA ≈ {:.0}° ({:.1}ч), Dec ≈ {:.0}°", ra_deg, ra_h, dec_deg)
        }
    };

    let fact = STAR_FACTS
        .iter()
        .find(|&&(name, _)| name == correct_name_en)
        .map(|&(_, f)| f.to_string())
        .unwrap_or_else(|| {
            format!(
                "{} — именная звезда каталога Hipparcos (HIP {}).",
                correct_name_ru, correct_hip
            )
        });

    let correct_answer = correct_name_ru;

    let q_data = QuestionData {
        question_type: "star".to_string(),
        question_text: match difficulty {
            "easy" => "Как называется звезда, отмеченная красным?".to_string(),
            "medium" => "Введите название звезды, отмеченной красным".to_string(),
            _ => "Введите название звезды и её экваториальные координаты с точностью до ±10°"
                .to_string(),
        },
        options: if difficulty == "easy" {
            Some(options.clone())
        } else {
            None
        },
        correct_answer,
        hint,
        fun_fact: fact,
        hint_used: false,
        correct_abbr: None,
        correct_hip: Some(correct_hip),
        correct_ra_deg: Some(ra_deg),
        correct_dec_deg: Some(dec_deg),
        correct_m_num: None,
        ref_edges: None,
        predrawn_edges: None,
        used_objects: std::mem::take(used_objects),
    };

    let q_resp = QuestionResponse {
        session_id: "".to_string(),
        current_round: 1,
        total_rounds: 10,
        question_type: "star".to_string(),
        question_text,
        options: if difficulty == "easy" {
            Some(options)
        } else {
            None
        },
        image_svg: Some(image_svg),
        draw_stars: None,
        has_hint: true,
    };

    Ok((q_resp, q_data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::catalog::{HipCatalog, MessierCatalog};
    use std::collections::HashSet;

    #[test]
    fn easy_generate_returns_star_question_with_options_and_correct_answer_inside() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (resp, data) = generate("easy", &mut used, &hip_catalog, &messier_catalog)
            .expect("must generate star question");

        assert_eq!(resp.question_type, "star");
        assert_eq!(data.question_type, "star");
        let options = resp.options.expect("easy star mode should return options");
        assert_eq!(options.len(), 4, "star easy mode should provide 4 options");
        assert!(
            options.contains(&data.correct_answer),
            "correct star name must be in options"
        );
    }

    #[test]
    fn generate_tracks_used_hip_id_in_question_data() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (_, data) = generate("medium", &mut used, &hip_catalog, &messier_catalog)
            .expect("must generate star question");

        let hip = data
            .correct_hip
            .expect("star question should include HIP id");
        assert!(
            data.used_objects.contains(&hip.to_string()),
            "used_objects should include used HIP id"
        );
    }

    #[test]
    fn hard_generate_provides_equatorial_coordinates() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (_, data) = generate("hard", &mut used, &hip_catalog, &messier_catalog)
            .expect("hard mode should generate star question");

        let ra = data.correct_ra_deg.expect("hard mode should include RA");
        let dec = data.correct_dec_deg.expect("hard mode should include Dec");
        assert!(
            (0.0..=360.0).contains(&ra),
            "RA should be within [0, 360], got {ra}"
        );
        assert!(
            (-90.0..=90.0).contains(&dec),
            "Dec should be within [-90, 90], got {dec}"
        );
    }
}
