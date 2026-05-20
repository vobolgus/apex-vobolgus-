use super::{QuestionData, QuestionFactory, TriviaQuestion, CONSTELLATION_FACTS, TRIVIA_QUESTIONS};
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
    let pool_set: HashSet<String> = pool.iter().cloned().collect();

    let mut available_trivia: Vec<&TriviaQuestion> = TRIVIA_QUESTIONS
        .iter()
        .filter(|q| pool_set.contains(q.answer) && !used_objects.contains(q.answer))
        .collect();

    if available_trivia.is_empty() {
        used_objects.clear();
        available_trivia = TRIVIA_QUESTIONS
            .iter()
            .filter(|q| pool_set.contains(q.answer))
            .collect();
    }

    if available_trivia.is_empty() {
        available_trivia = TRIVIA_QUESTIONS.iter().collect();
    }

    let trivia = available_trivia
        .choose(&mut rng)
        .cloned()
        .ok_or_else(|| anyhow!("available pool is empty for trivia"))?;
    let correct_abbr = trivia.answer.to_string();
    used_objects.insert(correct_abbr.clone());

    let const_json = get_constellations_data()
        .get(&correct_abbr)
        .ok_or_else(|| anyhow!("constellation '{}' not found in embedded data", correct_abbr))?;
    let correct_name = localize_constellation(&correct_abbr, &const_json.name);

    let mut distractors = pool
        .iter()
        .filter(|c| **c != correct_abbr)
        .cloned()
        .collect::<Vec<_>>();
    distractors.shuffle(&mut rng);
    let selected_distractors = &distractors[..3.min(distractors.len())];

    let mut options = vec![correct_name.clone()];
    for d in selected_distractors {
        let d_json = get_constellations_data()
            .get(d)
            .ok_or_else(|| anyhow!("constellation '{}' not found in embedded data", d))?;
        options.push(localize_constellation(d, &d_json.name));
    }
    options.shuffle(&mut rng);

    let mag_limit = QuestionFactory::get_magnitude_limit(difficulty);
    let tilt_angle = Some(rng.gen_range(0.0..360.0));

    let config = RenderConfig {
        projection: "pinhole".to_string(),
        datetime: None,
        latitude: 45.0,
        longitude: 19.0,
        magnitude_limit: Some(mag_limit),
        fov_deg: Some(110.0),
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

    let image_svg = SvgGenerator::render_map(&config, hip_catalog, messier_catalog, None, None);

    let fact = CONSTELLATION_FACTS
        .iter()
        .find(|&&(abbr, _)| abbr == correct_abbr)
        .map(|&(_, f)| f.to_string())
        .unwrap_or_else(|| format!("Созвездие {}.", correct_name));

    let correct_answer = correct_name;

    let q_data = QuestionData {
        question_type: "trivia".to_string(),
        question_text: trivia.question.to_string(),
        options: Some(options.clone()),
        correct_answer,
        hint: trivia.hint.to_string(),
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
        question_type: "trivia".to_string(),
        question_text: trivia.question.to_string(),
        options: Some(options),
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
    fn easy_generate_returns_trivia_question_with_4_options() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (resp, data) =
            generate("easy", &mut used, &hip_catalog, &messier_catalog).expect("must generate trivia question");

        assert_eq!(resp.question_type, "trivia");
        assert_eq!(data.question_type, "trivia");
        let options = resp.options.expect("trivia should provide options");
        assert_eq!(options.len(), 4, "trivia mode should provide 4 options");
        assert!(
            options.contains(&data.correct_answer),
            "correct answer must be one of options"
        );
    }

    #[test]
    fn generate_tracks_used_constellation_answer_for_trivia() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (_, data) =
            generate("medium", &mut used, &hip_catalog, &messier_catalog).expect("must generate trivia question");

        let abbr = data.correct_abbr.clone().expect("trivia question should include constellation abbr");
        assert!(
            data.used_objects.contains(&abbr),
            "used_objects should include selected trivia answer constellation"
        );
    }

    #[test]
    fn fully_used_easy_pool_is_reset_and_generation_still_succeeds() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used: HashSet<String> = super::super::EASY_CONSTELLATIONS
            .iter()
            .map(|s| s.to_string())
            .collect();

        let result = generate("easy", &mut used, &hip_catalog, &messier_catalog);

        assert!(result.is_ok(), "fully used trivia pool should reset and generate");
    }
}
