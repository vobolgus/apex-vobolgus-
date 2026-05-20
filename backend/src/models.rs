use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderConfig {
    pub projection: String, // "stereo" | "pinhole"
    pub datetime: Option<String>,
    pub latitude: f32,
    pub longitude: f32,
    pub magnitude_limit: Option<f32>,
    pub fov_deg: Option<f32>,
    pub aspect_ratio: Option<f32>,
    pub constellation: Option<String>,
    pub center_direction: Option<[f32; 3]>,
    pub tilt_angle: Option<f32>,
    pub layers: LayersConfig,
    pub style: StyleConfig,
    pub print_info: Option<bool>,
    pub footer_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayersConfig {
    pub ecliptic: bool,
    pub equator: bool,
    pub galactic_equator: bool,
    pub planets: bool,
    pub horizontal_grid: bool,
    pub equatorial_grid: bool,
    pub constellations: bool,
    pub constellation_names: bool,
    pub zenith: bool,
    pub poles: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleConfig {
    pub star_color: String,
    pub constellation_line_color: String,
    pub grid_color: String,
    pub background_color: String,
    pub font_family: String,
    pub magnitude_scale: f32,
}

// --- ИГРОВЫЕ СТРУКТУРЫ (Sky Quiz) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartGameRequest {
    pub mode: String, // "constellation" | "star" | "messier" | "draw" | "trivia"
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
    pub options: Option<Vec<String>>, // для 4 вариантов
    pub image_svg: Option<String>,    // карта звездного неба в SVG (для визуальных вопросов)
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
