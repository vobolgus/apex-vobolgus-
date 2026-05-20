use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::models::{SessionScoreResponse, StartGameRequest, StartGameResponse};
use crate::AppState;

pub mod gameplay;
pub use gameplay::{get_hint, get_question, submit_answer};

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
    use axum::extract::Query;
    use crate::AppState;
    use crate::models::AnswerRequest;
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
