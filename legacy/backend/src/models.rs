// Extracted from backend/src/models.rs at 05becf9 — game (Sky Quiz) and orbit simulation (AstraEtudes) parts. Full original: git show 05becf9:backend/src/models.rs
// RenderConfig / LayersConfig / StyleConfig остались в живом backend/src/models.rs.

use serde::{Deserialize, Serialize};

// --- ИГРОВЫЕ СТРУКТУРЫ (Sky Quiz) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartGameRequest {
    pub mode: String,       // "constellation" | "star" | "messier" | "draw" | "trivia"
    pub difficulty: String, // "easy" | "medium" | "hard"
    pub total_rounds: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartGameResponse {
    pub session_id: String,
    pub mode: String,
    pub difficulty: String,
    pub current_round: i32,
    pub total_rounds: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionResponse {
    pub session_id: String,
    pub current_round: i32,
    pub total_rounds: i32,
    pub question_type: String,
    pub question_text: String,
    pub options: Option<Vec<String>>,      // для 4 вариантов
    pub image_svg: Option<String>,         // карта звездного неба в SVG (для визуальных вопросов)
    pub draw_stars: Option<Vec<DrawStar>>, // для режима Draw
    pub has_hint: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawStar {
    pub id: i32,
    pub x: f32,
    pub y: f32,
    pub r: f32,
    pub is_contour: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerRequest {
    pub session_id: String,
    pub answer: String,
    pub time_spent: f32, // в секундах
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerResponse {
    pub correct: bool,
    pub correct_answer: String,
    pub points_earned: i32,
    pub current_score: i32,
    pub streak: i32,
    pub rank: String,
    pub multiplier_breakdown: MultiplierBreakdown,
    pub is_finished: bool,
    pub fun_fact: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiplierBreakdown {
    pub base_score: i32,
    pub streak_mult: f32,
    pub speed_mult: f32,
    pub hint_mult: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HintResponse {
    pub session_id: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionScoreResponse {
    pub session_id: String,
    pub score: i32,
    pub streak: i32,
    pub current_round: i32,
    pub total_rounds: i32,
    pub is_finished: bool,
}

// --- ФИЗИЧЕСКИЕ СИМУЛЯЦИИ (AstraEtudes) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitComputeRequest {
    pub r_x: f64,
    pub r_y: f64,
    pub v_x: f64,
    pub v_y: f64,
    pub mu: f64,
    pub dt: f64,
    pub steps: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitComputeResponse {
    pub trajectory: Vec<OrbitPoint>,
    pub semi_major_axis: f64,
    pub eccentricity: f64,
    pub specific_energy: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitPoint {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub time: f64,
}
