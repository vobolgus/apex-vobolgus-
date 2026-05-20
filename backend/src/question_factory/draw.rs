use super::{localize_star, QuestionData, QuestionFactory, CONSTELLATION_FACTS, NAMED_STARS};
use crate::models::{DrawStar, QuestionResponse};
use crate::svg_generator::{get_constellations_data, localize_constellation};
use anyhow::{anyhow, Result};
use rand::{seq::SliceRandom, Rng};
use rust_core::catalog::{HipCatalog, MessierCatalog};
use std::collections::{HashMap, HashSet};

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
    let constellation_name = localize_constellation(&correct_abbr, &const_json.name);

    let center = [
        const_json.center[0] as f64,
        const_json.center[1] as f64,
        const_json.center[2] as f64,
    ];
    let ref_lines = &const_json.lines;

    let mut const_hip_ids = HashSet::new();
    for line in ref_lines {
        for &hip in line {
            const_hip_ids.insert(hip);
        }
    }

    let mag_limit = QuestionFactory::get_magnitude_limit(difficulty);
    let bg_mag = (mag_limit + 1.0).min(6.5);
    let all_stars = hip_catalog.get_stars(bg_mag, None);

    let z = [center[0], center[1], center[2]];
    let z_norm = (z[0].powi(2) + z[1].powi(2) + z[2].powi(2)).sqrt();
    let z_axis = [z[0] / z_norm, z[1] / z_norm, z[2] / z_norm];

    let arb = if z_axis[2].abs() < 0.9 {
        [0.0, 0.0, 1.0]
    } else {
        [1.0, 0.0, 0.0]
    };

    let mut x_ax = [
        arb[1] * z_axis[2] - arb[2] * z_axis[1],
        arb[2] * z_axis[0] - arb[0] * z_axis[2],
        arb[0] * z_axis[1] - arb[1] * z_axis[0],
    ];
    let x_norm = (x_ax[0].powi(2) + x_ax[1].powi(2) + x_ax[2].powi(2)).sqrt();
    x_ax = [x_ax[0] / x_norm, x_ax[1] / x_norm, x_ax[2] / x_norm];

    let y_ax = [
        z_axis[1] * x_ax[2] - z_axis[2] * x_ax[1],
        z_axis[2] * x_ax[0] - z_axis[0] * x_ax[2],
        z_axis[0] * x_ax[1] - z_axis[1] * x_ax[0],
    ];

    let mut const_projected = HashMap::new();
    for star in &all_stars {
        if const_hip_ids.contains(&star.hip_id) {
            let d = [star.x as f64, star.y as f64, star.z as f64];
            let cos_t = d[0] * z_axis[0] + d[1] * z_axis[1] + d[2] * z_axis[2];
            if cos_t < 0.05 {
                continue;
            }
            let px = (d[0] * x_ax[0] + d[1] * x_ax[1] + d[2] * x_ax[2]) / cos_t;
            let py = (d[0] * y_ax[0] + d[1] * y_ax[1] + d[2] * y_ax[2]) / cos_t;
            const_projected.insert(star.hip_id, (px, py, star.v_mag));
        }
    }

    if const_projected.len() < 2 {
        used_objects.remove(&correct_abbr);
        return QuestionFactory::make_question(
            "draw",
            difficulty,
            used_objects,
            hip_catalog,
            messier_catalog,
        );
    }

    let mut bg_projected = HashMap::new();
    for star in &all_stars {
        if const_hip_ids.contains(&star.hip_id) {
            continue;
        }
        let d = [star.x as f64, star.y as f64, star.z as f64];
        let cos_t = d[0] * z_axis[0] + d[1] * z_axis[1] + d[2] * z_axis[2];
        if cos_t < 0.7 {
            continue;
        }
        let px = (d[0] * x_ax[0] + d[1] * x_ax[1] + d[2] * x_ax[2]) / cos_t;
        let py = (d[0] * y_ax[0] + d[1] * y_ax[1] + d[2] * y_ax[2]) / cos_t;
        bg_projected.insert(star.hip_id, (px, py, star.v_mag));
    }

    let mut max_r = 1e-9;
    for &(px, py, _) in const_projected.values() {
        let r = px.abs().max(py.abs());
        if r > max_r {
            max_r = r;
        }
    }
    max_r *= 1.2;

    let mut stars_list = vec![];
    let named_map: HashMap<i32, &str> = NAMED_STARS.iter().cloned().collect();

    for (&hip_id, &(px, py, mag)) in &const_projected {
        let _name = named_map
            .get(&hip_id)
            .map(|s| localize_star(s))
            .unwrap_or_default();
        stars_list.push(DrawStar {
            id: hip_id,
            x: (px / max_r) as f32,
            y: (py / max_r) as f32,
            r: (mag_limit + 1.0 - mag).max(0.5) * 1.5,
            is_contour: true,
        });
    }

    for (&hip_id, &(px, py, mag)) in &bg_projected {
        let nx = px / max_r;
        let ny = py / max_r;
        if nx.abs() > 1.4 || ny.abs() > 1.4 {
            continue;
        }
        stars_list.push(DrawStar {
            id: hip_id,
            x: nx as f32,
            y: ny as f32,
            r: (mag_limit + 1.0 - mag).max(0.5) * 1.5,
            is_contour: false,
        });
    }

    let mut ref_edges = vec![];
    for line in ref_lines {
        for i in 0..(line.len() - 1) {
            let id1 = line[i];
            let id2 = line[i + 1];
            if const_projected.contains_key(&id1) && const_projected.contains_key(&id2) {
                ref_edges.push(vec![id1, id2]);
            }
        }
    }

    let mut predrawn_edges = vec![];
    let tilt_deg: f32 = if difficulty == "easy" {
        let n_pre = ((ref_edges.len() as f32) * 0.25).floor() as usize;
        if n_pre > 0 {
            let mut temp = ref_edges.clone();
            temp.shuffle(&mut rng);
            predrawn_edges.extend(temp.into_iter().take(n_pre));
        }
        0.0
    } else if difficulty == "medium" {
        0.0
    } else {
        rng.gen_range(0.0..360.0)
    };

    if tilt_deg != 0.0 {
        let rad = tilt_deg.to_radians();
        let cos_a = rad.cos();
        let sin_a = rad.sin();
        for star in &mut stars_list {
            let x = star.x;
            let y = star.y;
            star.x = cos_a * x - sin_a * y;
            star.y = sin_a * x + cos_a * y;
        }
    }

    let fact = CONSTELLATION_FACTS
        .iter()
        .find(|&&(abbr, _)| abbr == correct_abbr)
        .map(|&(_, f)| f.to_string())
        .unwrap_or_else(|| format!("Созвездие {}.", constellation_name));

    let correct_answer = constellation_name;
    let hint = format!("В рисунке этого созвездия {} линий", ref_edges.len());

    let q_data = QuestionData {
        question_type: "draw".to_string(),
        question_text:
            "Соедините звёзды созвездия линиями так, как они соединены на официальных картах.".to_string(),
        options: None,
        correct_answer,
        hint,
        fun_fact: fact,
        hint_used: false,
        correct_abbr: Some(correct_abbr),
        correct_hip: None,
        correct_ra_deg: None,
        correct_dec_deg: None,
        correct_m_num: None,
        ref_edges: Some(ref_edges),
        predrawn_edges: Some(predrawn_edges),
        used_objects: std::mem::take(used_objects),
    };

    let q_resp = QuestionResponse {
        session_id: "".to_string(),
        current_round: 1,
        total_rounds: 10,
        question_type: "draw".to_string(),
        question_text:
            "Соедините звёзды созвездия линиями так, как они соединены на официальных картах.".to_string(),
        options: None,
        image_svg: None,
        draw_stars: Some(stars_list),
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
    fn easy_generate_returns_draw_payload_with_stars_and_edges() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (resp, data) =
            generate("easy", &mut used, &hip_catalog, &messier_catalog).expect("must generate draw question");

        assert_eq!(resp.question_type, "draw");
        assert_eq!(data.question_type, "draw");
        assert!(resp.draw_stars.as_ref().is_some_and(|s| !s.is_empty()));
        assert!(data.ref_edges.as_ref().is_some_and(|e| !e.is_empty()));
    }

    #[test]
    fn generate_tracks_used_constellation_for_draw_mode() {
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();
        let mut used = HashSet::new();

        let (_, data) =
            generate("medium", &mut used, &hip_catalog, &messier_catalog).expect("must generate draw question");

        let abbr = data.correct_abbr.clone().expect("draw question should include constellation abbr");
        assert!(
            data.used_objects.contains(&abbr),
            "used_objects should include selected constellation"
        );
    }
}
