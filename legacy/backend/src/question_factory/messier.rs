use super::{MESSIER_FACTS, QuestionData, QuestionFactory};
use crate::models::{LayersConfig, QuestionResponse, RenderConfig, StyleConfig};
use crate::svg_generator::SvgGenerator;
use anyhow::{Result, anyhow};
use rand::seq::SliceRandom;
use rust_core::catalog::{HipCatalog, MessierCatalog, MessierObject};
use std::collections::HashSet;

const GAME_QUESTION_PLANETS_ENABLED: bool = false;

pub(super) fn generate(
    difficulty: &str,
    used_objects: &mut HashSet<String>,
    hip_catalog: &HipCatalog,
    messier_catalog: &MessierCatalog,
) -> Result<(QuestionResponse, QuestionData)> {
    let mut rng = rand::thread_rng();
    let all_objects = messier_catalog.get_all_objects();
    let mut available: Vec<MessierObject> = all_objects
        .iter()
        .filter(|o| !used_objects.contains(&o.m_number.to_string()))
        .cloned()
        .collect();

    if available.is_empty() {
        used_objects.clear();
        available = all_objects.clone();
    }

    let correct_obj = available
        .choose(&mut rng)
        .cloned()
        .ok_or_else(|| anyhow!("available pool is empty for messier object"))?;
    let m_num = correct_obj.m_number;
    used_objects.insert(m_num.to_string());

    let mag_limit = QuestionFactory::get_magnitude_limit(difficulty);

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
        tilt_angle: Some(0.0),
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

    let image_svg =
        SvgGenerator::render_map(&config, hip_catalog, messier_catalog, None, Some(m_num));

    let _type_name = correct_obj.type_name();
    let ru_type = match correct_obj.obj_type {
        1 => "Галактика",
        2 => "Шаровое скопление",
        3 => "Рассеянное скопление",
        4 => "Туманность",
        5 => "Остаток сверхновой",
        6 => "Звёздное облако",
        7 => "Двойная звезда",
        _ => "Объект",
    };

    let mut distractors = all_objects
        .iter()
        .filter(|o| o.m_number != m_num)
        .collect::<Vec<_>>();
    distractors.shuffle(&mut rng);

    let mut selected_distractors = vec![];
    let mut same_const: Vec<_> = distractors
        .iter()
        .filter(|o| o.constellation == correct_obj.constellation)
        .collect();
    same_const.shuffle(&mut rng);
    selected_distractors.extend(same_const.into_iter().take(2));

    let mut i = 0;
    while selected_distractors.len() < 3 && i < distractors.len() {
        let d = distractors[i];
        if !selected_distractors.contains(&d) {
            selected_distractors.push(d);
        }
        i += 1;
    }

    let correct_answer = format!("M{}", m_num);
    let mut options = vec![correct_answer.clone()];
    for d in selected_distractors {
        options.push(format!("M{}", d.m_number));
    }
    options.shuffle(&mut rng);

    let fact = MESSIER_FACTS
        .iter()
        .find(|&&(num, _)| num == m_num)
        .map(|&(_, f)| f.to_string())
        .unwrap_or_else(|| {
            format!(
                "M{} — {} в созвездии {}.",
                m_num, ru_type, correct_obj.constellation
            )
        });

    let question_text = format!(
        "Объект типа «{}» в созвездии {}. Что это за объект Мессье?",
        ru_type, correct_obj.constellation
    );

    let q_data = QuestionData {
        question_type: "messier".to_string(),
        question_text: format!(
            "Объект типа «{}» в созвездии {}. Что это за объект Мессье?",
            ru_type, correct_obj.constellation
        ),
        options: Some(options.clone()),
        correct_answer,
        hint: format!(
            "Это {} с видимой звёздной величиной {:.1}m",
            ru_type.to_lowercase(),
            correct_obj.v_mag
        ),
        fun_fact: fact,
        hint_used: false,
        correct_abbr: None,
        correct_hip: None,
        correct_ra_deg: None,
        correct_dec_deg: None,
        correct_m_num: Some(m_num),
        ref_edges: None,
        predrawn_edges: None,
        used_objects: std::mem::take(used_objects),
    };

    let q_resp = QuestionResponse {
        session_id: "".to_string(),
        current_round: 1,
        total_rounds: 10,
        question_type: "messier".to_string(),
        question_text,
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
    fn easy_generate_returns_messier_question_with_4_options() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (resp, data) = generate("easy", &mut used, &hip_catalog, &messier_catalog)
            .expect("must generate messier question");

        assert_eq!(resp.question_type, "messier");
        assert_eq!(data.question_type, "messier");
        let options = resp.options.expect("messier should have options");
        assert_eq!(options.len(), 4, "messier mode should provide 4 options");
        assert!(
            options.contains(&data.correct_answer),
            "correct messier answer must be in options"
        );
    }

    #[test]
    fn generate_tracks_used_m_number_in_question_data() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (_, data) = generate("medium", &mut used, &hip_catalog, &messier_catalog)
            .expect("must generate messier question");

        let m_num = data
            .correct_m_num
            .expect("messier question should include m number");
        assert!(
            data.used_objects.contains(&m_num.to_string()),
            "used_objects should include used Messier number"
        );
    }

    #[test]
    fn generated_messier_number_is_within_catalog_range() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (_, data) = generate("hard", &mut used, &hip_catalog, &messier_catalog)
            .expect("must generate messier question");

        let m_num = data
            .correct_m_num
            .expect("messier question should include m number");
        assert!(
            (1..=110).contains(&m_num),
            "Messier number should be in [1,110], got {m_num}"
        );
    }
}
