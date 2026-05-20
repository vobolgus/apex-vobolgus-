use super::{QuestionData, QuestionFactory, CONSTELLATION_FACTS};
use crate::models::{LayersConfig, QuestionResponse, RenderConfig, StyleConfig};
use crate::svg_generator::{get_constellations_data, localize_constellation, SvgGenerator};
use anyhow::{anyhow, Result};
use rand::{seq::SliceRandom, Rng};
use rust_core::catalog::{HipCatalog, MessierCatalog};
use std::collections::HashSet;

pub(super) fn generate(
    difficulty: &str,
    used_objects: &mut HashSet<String>,
    hip_catalog: &HipCatalog,
    messier_catalog: &MessierCatalog,
) -> Result<(QuestionResponse, QuestionData)> {
    let mut rng = rand::thread_rng();
    let pool = QuestionFactory::get_constellations_pool(difficulty);
    let mut available: Vec<String> = pool
        .iter()
        .filter(|c| !used_objects.contains(*c))
        .cloned()
        .collect();

    if available.is_empty() {
        used_objects.clear();
        available = pool.clone();
    }

    let correct_abbr = available
        .choose(&mut rng)
        .cloned()
        .unwrap_or_else(|| "ORI".to_string());
    used_objects.insert(correct_abbr.clone());

    let const_json = get_constellations_data()
        .get(&correct_abbr)
        .ok_or_else(|| anyhow!("constellation '{}' not found in embedded data", correct_abbr))?;
    let correct_name_en = &const_json.name;
    let correct_name_ru = localize_constellation(&correct_abbr, correct_name_en);

    let mag_limit = QuestionFactory::get_magnitude_limit(difficulty);
    let show_const = difficulty == "easy";
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
        constellation: Some(correct_abbr.clone()),
        center_direction: None,
        tilt_angle,
        layers: LayersConfig {
            ecliptic: false,
            equator: false,
            galactic_equator: false,
            planets: false,
            horizontal_grid: false,
            equatorial_grid: false,
            constellations: show_const,
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

    let image_svg = SvgGenerator::render_map(&config, hip_catalog, messier_catalog, None, None);

    let mut distractors = pool
        .iter()
        .filter(|c| **c != correct_abbr)
        .cloned()
        .collect::<Vec<_>>();
    distractors.shuffle(&mut rng);
    let selected_distractors = &distractors[..3.min(distractors.len())];

    let fact = CONSTELLATION_FACTS
        .iter()
        .find(|&&(abbr, _)| abbr == correct_abbr)
        .map(|&(_, f)| f.to_string())
        .unwrap_or_else(|| format!("Созвездие {}.", correct_name_ru));

    let correct_answer = correct_name_ru;
    let mut options = vec![correct_answer.clone()];
    for d in selected_distractors {
        let d_json = get_constellations_data()
            .get(d)
            .ok_or_else(|| anyhow!("constellation '{}' not found in embedded data", d))?;
        options.push(localize_constellation(d, &d_json.name));
    }
    options.shuffle(&mut rng);

    let q_data = QuestionData {
        question_type: "constellation".to_string(),
        question_text: "Какое созвездие изображено на снимке?".to_string(),
        options: Some(options.clone()),
        correct_answer,
        hint: format!("Аббревиатура этого созвездия: {}", correct_abbr),
        fun_fact: fact,
        hint_used: false,
        correct_abbr: Some(correct_abbr),
        correct_hip: None,
        correct_ra_deg: None,
        correct_dec_deg: None,
        correct_m_num: None,
        ref_edges: None,
        predrawn_edges: None,
        used_objects: std::mem::take(used_objects),
    };

    let q_resp = QuestionResponse {
        session_id: "".to_string(),
        current_round: 1,
        total_rounds: 10,
        question_type: "constellation".to_string(),
        question_text: "Какое созвездие изображено на снимке?".to_string(),
        options: Some(options),
        image_svg: Some(image_svg),
        draw_stars: None,
        has_hint: true,
    };

    Ok((q_resp, q_data))
}
