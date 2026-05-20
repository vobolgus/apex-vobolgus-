use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;
use sqlx::Row;

use crate::AppState;
use crate::models::{
    StartGameRequest, StartGameResponse, QuestionResponse, AnswerRequest, AnswerResponse,
    HintResponse, SessionScoreResponse, MultiplierBreakdown,
};
use crate::question_factory::{QuestionFactory, QuestionData};
use rust_core::{Difficulty, GameMode, PlayerRank, calculate_score};

#[derive(Debug, Serialize)]
pub struct GameModeInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub difficulties: Vec<&'static str>,
}

pub async fn get_game_modes() -> Json<Vec<GameModeInfo>> {
    let modes = vec![
        GameModeInfo {
            id: "constellation",
            name: "Constellation Quiz",
            description: "Угадайте созвездие по его изображению на звездной карте.",
            difficulties: vec!["easy", "medium", "hard"],
        },
        GameModeInfo {
            id: "star",
            name: "Star Quiz",
            description: "Определите название отмеченной звезды и её координаты.",
            difficulties: vec!["easy", "medium", "hard"],
        },
        GameModeInfo {
            id: "messier",
            name: "Messier Quiz",
            description: "Найдите и идентифицируйте глубокие объекты космоса из каталога Мессье.",
            difficulties: vec!["easy", "medium", "hard"],
        },
        GameModeInfo {
            id: "draw",
            name: "Constellation Draw",
            description: "Соедините звезды созвездия по памяти.",
            difficulties: vec!["easy", "medium", "hard"],
        },
        GameModeInfo {
            id: "trivia",
            name: "Astronomy Trivia",
            description: "Ответьте на интересные вопросы по астрономии.",
            difficulties: vec!["easy", "medium", "hard"],
        },
    ];
    Json(modes)
}

pub async fn start_game(
    State(state): State<AppState>,
    Json(req): Json<StartGameRequest>,
) -> Result<Json<StartGameResponse>, (StatusCode, String)> {
    let mode = req.mode.to_lowercase();
    let difficulty = req.difficulty.to_lowercase();
    let total_rounds = req.total_rounds.unwrap_or(10);

    let valid_modes = ["constellation", "star", "messier", "draw", "trivia"];
    let valid_diffs = ["easy", "medium", "hard"];

    if !valid_modes.contains(&mode.as_str()) {
        return Err((StatusCode::BAD_REQUEST, format!("Invalid game mode: {}", mode)));
    }
    if !valid_diffs.contains(&difficulty.as_str()) {
        return Err((StatusCode::BAD_REQUEST, format!("Invalid difficulty: {}", difficulty)));
    }
    if !(1..=50).contains(&total_rounds) {
        return Err((StatusCode::BAD_REQUEST, "total_rounds must be in 1..=50".to_string()));
    }

    let session_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO game_sessions (id, mode, difficulty, current_round, total_rounds, score, streak, is_finished)
         VALUES (?, ?, ?, 1, ?, 0, 0, 0)"
    )
    .bind(&session_id)
    .bind(&mode)
    .bind(&difficulty)
    .bind(total_rounds)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(StartGameResponse {
        session_id,
        mode,
        difficulty,
        current_round: 1,
        total_rounds,
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionQuery {
    pub session_id: String,
}

pub async fn get_question(
    State(state): State<AppState>,
    Query(query): Query<SessionQuery>,
) -> Result<Json<QuestionResponse>, (StatusCode, String)> {
    let row = sqlx::query(
        "SELECT mode, difficulty, current_round, total_rounds, is_finished, current_question_data
         FROM game_sessions WHERE id = ?"
    )
    .bind(&query.session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    let session_mode: String = row.try_get("mode").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_difficulty: String = row.try_get("difficulty").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_current_round: i32 = row.try_get("current_round").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_total_rounds: i32 = row.try_get("total_rounds").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_is_finished: i32 = row.try_get("is_finished").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_current_question_data: Option<String> = row.try_get("current_question_data").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if session_is_finished != 0 {
        return Err((StatusCode::BAD_REQUEST, "Game session is already finished".to_string()));
    }

    // Если вопрос для текущего раунда уже сгенерирован, возвращаем его
    if let Some(ref data_str) = session_current_question_data {
        if let Ok(q_data) = serde_json::from_str::<QuestionData>(data_str) {
            let q_resp = rebuild_question_response(
                &query.session_id,
                session_current_round,
                session_total_rounds,
                &q_data,
                &state,
            );
            return Ok(Json(q_resp));
        }
    }

    // Сбор использованных объектов из предыдущих вопросов
    let used_objects = if let Some(ref data_str) = session_current_question_data {
        if let Ok(q_data) = serde_json::from_str::<QuestionData>(data_str) {
            q_data.used_objects
        } else {
            HashSet::new()
        }
    } else {
        HashSet::new()
    };

    // Генерируем новый вопрос
    let (mut q_resp, q_data) = QuestionFactory::make_question(
        &session_mode,
        &session_difficulty,
        used_objects,
        &state.hip_catalog,
        &state.messier_catalog,
    );

    q_resp.session_id = query.session_id.clone();
    q_resp.current_round = session_current_round;
    q_resp.total_rounds = session_total_rounds;

    let q_data_str = serde_json::to_string(&q_data)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("JSON serialization error: {}", e)))?;

    sqlx::query(
        "UPDATE game_sessions
         SET current_question_answer = ?, current_question_data = ?
         WHERE id = ?"
    )
    .bind(&q_data.correct_answer)
    .bind(&q_data_str)
    .bind(&query.session_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(q_resp))
}

fn rebuild_question_response(
    session_id: &str,
    current_round: i32,
    total_rounds: i32,
    q_data: &QuestionData,
    state: &AppState,
) -> QuestionResponse {
    // В зависимости от типа вопроса нам может потребоваться сгенерировать SVG
    let image_svg = match q_data.question_type.as_str() {
        "constellation" => {
            let correct_abbr = q_data.correct_abbr.clone().unwrap_or_else(|| "ORI".to_string());
            let config = crate::models::RenderConfig {
                projection: "pinhole".to_string(),
                datetime: None,
                latitude: 45.0,
                longitude: 19.0,
                magnitude_limit: Some(5.5),
                fov_deg: Some(60.0),
                aspect_ratio: Some(1.0),
                constellation: Some(correct_abbr),
                center_direction: None,
                tilt_angle: Some(0.0),
                layers: crate::models::LayersConfig {
                    ecliptic: false,
                    equator: false,
                    galactic_equator: false,
                    planets: false,
                    horizontal_grid: false,
                    equatorial_grid: false,
                    constellations: true, // В легком режиме показываем линии
                    constellation_names: false,
                    zenith: false,
                    poles: false,
                },
                style: crate::models::StyleConfig {
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
            Some(crate::svg_generator::SvgGenerator::render_map(&config, &state.hip_catalog, &state.messier_catalog, None, None))
        }
        "star" => {
            let correct_hip = q_data.correct_hip.unwrap_or(32349);
            let config = crate::models::RenderConfig {
                projection: "pinhole".to_string(),
                datetime: None,
                latitude: 45.0,
                longitude: 19.0,
                magnitude_limit: Some(5.5),
                fov_deg: Some(60.0),
                aspect_ratio: Some(1.0),
                constellation: None,
                center_direction: None,
                tilt_angle: Some(0.0),
                layers: crate::models::LayersConfig {
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
                style: crate::models::StyleConfig {
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
            Some(crate::svg_generator::SvgGenerator::render_map(&config, &state.hip_catalog, &state.messier_catalog, Some(correct_hip), None))
        }
        "messier" => {
            let correct_m_num = q_data.correct_m_num.unwrap_or(31);
            let config = crate::models::RenderConfig {
                projection: "pinhole".to_string(),
                datetime: None,
                latitude: 45.0,
                longitude: 19.0,
                magnitude_limit: Some(5.5),
                fov_deg: Some(60.0),
                aspect_ratio: Some(1.0),
                constellation: None,
                center_direction: None,
                tilt_angle: Some(0.0),
                layers: crate::models::LayersConfig {
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
                style: crate::models::StyleConfig {
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
            Some(crate::svg_generator::SvgGenerator::render_map(&config, &state.hip_catalog, &state.messier_catalog, None, Some(correct_m_num)))
        }
        "trivia" => {
            let correct_abbr = q_data.correct_abbr.clone().unwrap_or_else(|| "ORI".to_string());
            let config = crate::models::RenderConfig {
                projection: "pinhole".to_string(),
                datetime: None,
                latitude: 45.0,
                longitude: 19.0,
                magnitude_limit: Some(5.5),
                fov_deg: Some(110.0),
                aspect_ratio: Some(1.0),
                constellation: Some(correct_abbr),
                center_direction: None,
                tilt_angle: Some(0.0),
                layers: crate::models::LayersConfig {
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
                style: crate::models::StyleConfig {
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
            Some(crate::svg_generator::SvgGenerator::render_map(&config, &state.hip_catalog, &state.messier_catalog, None, None))
        }
        _ => None,
    };


    let draw_stars_rebuilt = if q_data.question_type == "draw" {
        // Нам нужны звезды созвездия. Мы можем сгенерировать их заново через make_question!
        let (temp_resp, _) = QuestionFactory::make_question(
            "draw",
            "medium", // дефолтная сложность
            HashSet::new(),
            &state.hip_catalog,
            &state.messier_catalog,
        );
        temp_resp.draw_stars
    } else {
        None
    };

    QuestionResponse {
        session_id: session_id.to_string(),
        current_round,
        total_rounds,
        question_type: q_data.question_type.clone(),
        question_text: q_data.question_text.clone(),
        options: q_data.options.clone(),
        image_svg,
        draw_stars: draw_stars_rebuilt,
        has_hint: true,
    }
}

fn parse_coords(s: &str) -> Option<(f32, f32)> {
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() >= 2 {
        let dec_str = parts.last()?.trim();
        let ra_str = parts[parts.len() - 2].trim();
        let ra = ra_str.parse::<f32>().ok()?;
        let dec = dec_str.parse::<f32>().ok()?;
        Some((ra, dec))
    } else {
        None
    }
}

pub async fn submit_answer(
    State(state): State<AppState>,
    Json(req): Json<AnswerRequest>,
) -> Result<Json<AnswerResponse>, (StatusCode, String)> {
    let row = sqlx::query(
        "SELECT mode, difficulty, current_round, total_rounds, score, streak, is_finished, current_question_answer, current_question_data
         FROM game_sessions WHERE id = ?"
    )
    .bind(&req.session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    let session_mode: String = row.try_get("mode").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_difficulty: String = row.try_get("difficulty").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_current_round: i32 = row.try_get("current_round").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_total_rounds: i32 = row.try_get("total_rounds").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_score: i32 = row.try_get("score").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_streak: i32 = row.try_get("streak").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_is_finished: i32 = row.try_get("is_finished").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_current_question_data: Option<String> = row.try_get("current_question_data").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if session_is_finished != 0 {
        return Err((StatusCode::BAD_REQUEST, "Game session is already finished".to_string()));
    }

    let q_data_str = session_current_question_data.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "Question has not been generated yet".to_string())
    })?;
    let q_data: QuestionData = serde_json::from_str(&q_data_str)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("JSON parsing error: {}", e)))?;

    let is_correct = if q_data.question_type == "draw" {
        // Режим Draw: сверка ребер
        let user_edges: Vec<Vec<i32>> = serde_json::from_str(&req.answer).unwrap_or_default();
        let mut user_set = HashSet::new();
        for edge in user_edges {
            if edge.len() == 2 {
                let u = edge[0];
                let v = edge[1];
                user_set.insert((u.min(v), u.max(v)));
            }
        }

        let mut ref_set = HashSet::new();
        if let Some(ref_edges) = &q_data.ref_edges {
            for edge in ref_edges {
                if edge.len() == 2 {
                    let u = edge[0];
                    let v = edge[1];
                    ref_set.insert((u.min(v), u.max(v)));
                }
            }
        }
        user_set == ref_set
    } else if q_data.question_type == "star" && session_difficulty == "hard" {
        // Режим Star Hard: координаты
        let mut ok = false;
        if let Some(coords) = parse_coords(&req.answer) {
            let (user_ra, user_dec) = coords;
            let ref_ra = q_data.correct_ra_deg.unwrap_or(0.0);
            let ref_dec = q_data.correct_dec_deg.unwrap_or(0.0);
            let d_dec = user_dec - ref_dec;
            let mut d_ra = (user_ra - ref_ra).abs();
            if d_ra > 180.0 {
                d_ra = 360.0 - d_ra;
            }
            let dist = (d_ra * d_ra + d_dec * d_dec).sqrt();
            if dist <= 10.0 {
                ok = true;
            }
        }
        // Запасной вариант: сверка имени без учета регистра
        if !ok {
            let clean_user = req.answer.trim().to_lowercase().replace(" ", "");
            let clean_correct = q_data.correct_answer.trim().to_lowercase().replace(" ", "");
            if clean_user == clean_correct {
                ok = true;
            }
        }
        ok
    } else {
        // Обычные текстовые вопросы
        let clean_user = req.answer.trim().to_lowercase().replace(" ", "");
        let clean_correct = q_data.correct_answer.trim().to_lowercase().replace(" ", "");
        clean_user == clean_correct
    };

    // Начисление очков
    let diff_enum = match session_difficulty.as_str() {
        "easy" => Difficulty::Easy,
        "medium" => Difficulty::Medium,
        "hard" => Difficulty::Hard,
        _ => Difficulty::Medium,
    };

    let mode_enum = match session_mode.as_str() {
        "constellation" => GameMode::Constellation,
        "trivia" => GameMode::Trivia,
        "messier" => GameMode::Messier,
        "draw" => GameMode::Draw,
        "star" => match session_difficulty.as_str() {
            "easy" => GameMode::StarEasy,
            "medium" => GameMode::StarMedium,
            "hard" => GameMode::StarHard,
            _ => GameMode::StarMedium,
        },
        _ => GameMode::Trivia,
    };

    let next_streak = if is_correct {
        session_streak + 1
    } else {
        0
    };

    let score_res = if is_correct {
        calculate_score(diff_enum, mode_enum, next_streak as u32, req.time_spent, q_data.hint_used)
    } else {
        rust_core::scoring::ScoreCalculationResult {
            final_score: 0,
            base_score: 0,
            streak_multiplier: 1.0,
            speed_multiplier: 1.0,
            hint_multiplier: 1.0,
        }
    };

    let next_score = session_score + score_res.final_score as i32;
    let next_round = session_current_round + 1;
    let is_finished = next_round > session_total_rounds;

    // Обновляем сессию в БД
    sqlx::query(
        "UPDATE game_sessions
         SET score = ?, streak = ?, current_round = ?, is_finished = ?, current_question_answer = NULL, current_question_data = NULL
         WHERE id = ?"
    )
    .bind(next_score)
    .bind(next_streak)
    .bind(next_round)
    .bind(is_finished as i32)
    .bind(&req.session_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    let rank = PlayerRank::from_score(next_score as u32);

    Ok(Json(AnswerResponse {
        correct: is_correct,
        correct_answer: q_data.correct_answer.clone(),
        points_earned: score_res.final_score as i32,
        current_score: next_score,
        streak: next_streak,
        rank: rank.display_name().to_string(),
        multiplier_breakdown: MultiplierBreakdown {
            base_score: score_res.base_score as i32,
            streak_mult: score_res.streak_multiplier,
            speed_mult: score_res.speed_multiplier,
            hint_mult: score_res.hint_multiplier,
        },
        is_finished,
        fun_fact: Some(q_data.fun_fact.clone()),
    }))
}

pub async fn get_hint(
    State(state): State<AppState>,
    Query(query): Query<SessionQuery>,
) -> Result<Json<HintResponse>, (StatusCode, String)> {
    let row = sqlx::query(
        "SELECT current_question_data FROM game_sessions WHERE id = ?"
    )
    .bind(&query.session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    let session_current_question_data: Option<String> = row.try_get("current_question_data").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let q_data_str = session_current_question_data.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "Question has not been generated yet".to_string())
    })?;

    let mut q_data: QuestionData = serde_json::from_str(&q_data_str)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("JSON parsing error: {}", e)))?;

    // Помечаем, что подсказка использована
    q_data.hint_used = true;

    let updated_q_data_str = serde_json::to_string(&q_data)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("JSON serialization error: {}", e)))?;

    sqlx::query(
        "UPDATE game_sessions
         SET current_question_data = ?
         WHERE id = ?"
    )
    .bind(&updated_q_data_str)
    .bind(&query.session_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(HintResponse {
        session_id: query.session_id,
        hint: q_data.hint,
    }))
}

#[derive(Debug, Deserialize)]
pub struct FinishGameRequest {
    pub session_id: String,
}

pub async fn finish_game(
    State(state): State<AppState>,
    Json(req): Json<FinishGameRequest>,
) -> Result<Json<SessionScoreResponse>, (StatusCode, String)> {
    let row = sqlx::query(
        "SELECT current_round, total_rounds, score, streak FROM game_sessions WHERE id = ?"
    )
    .bind(&req.session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    let session_current_round: i32 = row.try_get("current_round").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_total_rounds: i32 = row.try_get("total_rounds").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_score: i32 = row.try_get("score").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let session_streak: i32 = row.try_get("streak").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "UPDATE game_sessions
         SET is_finished = 1
         WHERE id = ?"
    )
    .bind(&req.session_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(SessionScoreResponse {
        session_id: req.session_id,
        score: session_score,
        streak: session_streak,
        current_round: session_current_round,
        total_rounds: session_total_rounds,
        is_finished: true,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppState;
    use crate::db::init_db;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_game_modes_list() {
        let modes = get_game_modes().await;
        assert_eq!(modes.len(), 5);
        assert_eq!(modes[0].id, "constellation");
    }

    #[tokio::test]
    async fn test_full_game_flow() {
        // 1. Инициализируем in-memory базу данных
        let db = init_db("sqlite::memory:").await.unwrap();
        
        let state = AppState {
            db,
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
            messier_catalog: Arc::new(rust_core::catalog::MessierCatalog::new()),
        };

        // 2. Начинаем новую игру
        let start_req = StartGameRequest {
            mode: "constellation".to_string(),
            difficulty: "easy".to_string(),
            total_rounds: Some(3),
        };
        let start_res = start_game(State(state.clone()), Json(start_req)).await;
        assert!(start_res.is_ok());
        let start_data = start_res.unwrap().0;
        let session_id = start_data.session_id.clone();
        assert_eq!(start_data.mode, "constellation");
        assert_eq!(start_data.difficulty, "easy");
        assert_eq!(start_data.current_round, 1);
        assert_eq!(start_data.total_rounds, 3);

        // 3. Получаем первый вопрос
        let session_query = SessionQuery { session_id: session_id.clone() };
        let question_res = get_question(State(state.clone()), Query(session_query.clone())).await;
        assert!(question_res.is_ok());
        let question_data = question_res.unwrap().0;
        assert_eq!(question_data.session_id, session_id);
        assert_eq!(question_data.current_round, 1);
        assert!(question_data.options.is_some());
        let options = question_data.options.unwrap();
        assert_eq!(options.len(), 4);
        assert!(question_data.image_svg.is_some());

        // 4. Получаем подсказку к вопросу
        let hint_res = get_hint(State(state.clone()), Query(session_query.clone())).await;
        assert!(hint_res.is_ok());
        let hint_data = hint_res.unwrap().0;
        assert_eq!(hint_data.session_id, session_id);
        assert!(!hint_data.hint.is_empty());

        // 5. Отправляем ответ (берем правильный ответ прямо из базы для симуляции верного ответа)
        let row = sqlx::query("SELECT current_question_answer FROM game_sessions WHERE id = ?")
            .bind(&session_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
        let correct_ans: String = row.try_get("current_question_answer").unwrap();

        let ans_req = AnswerRequest {
            session_id: session_id.clone(),
            answer: correct_ans,
            time_spent: 5.0,
        };
        let ans_res = submit_answer(State(state.clone()), Json(ans_req)).await;
        assert!(ans_res.is_ok());
        let ans_data = ans_res.unwrap().0;
        assert!(ans_data.correct);
        assert!(ans_data.points_earned > 0);
        assert_eq!(ans_data.streak, 1);
        assert!(!ans_data.is_finished);

        // 6. Завершаем игру принудительно досрочно
        let finish_req = FinishGameRequest {
            session_id: session_id.clone(),
        };
        let finish_res = finish_game(State(state.clone()), Json(finish_req)).await;
        assert!(finish_res.is_ok());
        let finish_data = finish_res.unwrap().0;
        assert_eq!(finish_data.session_id, session_id);
        assert!(finish_data.is_finished);
    }
}
