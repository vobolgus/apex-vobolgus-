use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Difficulty {
    Easy,
    Medium,
    Hard,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum GameMode {
    Constellation,
    Trivia,
    StarEasy,
    StarMedium,
    StarHard,
    Messier,
    Draw,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct ScoreCalculationResult {
    pub final_score: u32,
    pub base_score: u32,
    pub streak_multiplier: f32,
    pub speed_multiplier: f32,
    pub hint_multiplier: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PlayerRank {
    Beginner,
    NightApprentice,
    SkyWatcher,
    StarNavigator,
    GalacticExplorer,
}

impl PlayerRank {
    pub fn from_score(score: u32) -> Self {
        if score >= 5000 {
            PlayerRank::GalacticExplorer
        } else if score >= 3000 {
            PlayerRank::StarNavigator
        } else if score >= 1500 {
            PlayerRank::SkyWatcher
        } else if score >= 500 {
            PlayerRank::NightApprentice
        } else {
            PlayerRank::Beginner
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            PlayerRank::Beginner => "🌑 Beginner",
            PlayerRank::NightApprentice => "🌙 Night Apprentice",
            PlayerRank::SkyWatcher => "🔭 Sky Watcher",
            PlayerRank::StarNavigator => "⭐ Star Navigator",
            PlayerRank::GalacticExplorer => "🌌 Galactic Explorer",
        }
    }
}

/// Рассчитывает игровые очки на основе сложности, режима игры, текущего стрика, времени ответа и использования подсказок.
pub fn calculate_score(
    difficulty: Difficulty,
    game_mode: GameMode,
    streak: u32,
    time_spent_secs: f32,
    used_hint: bool,
) -> ScoreCalculationResult {
    let base_score = match difficulty {
        Difficulty::Easy => 100,
        Difficulty::Medium => 200,
        Difficulty::Hard => 350,
    };

    let streak_multiplier = if streak >= 10 {
        3.0
    } else if streak >= 5 {
        2.0
    } else if streak >= 3 {
        1.5
    } else if streak >= 2 {
        1.2
    } else {
        1.0
    };

    let speed_multiplier = match game_mode {
        GameMode::Draw => {
            if time_spent_secs < 45.0 {
                1.2
            } else {
                1.0
            }
        }
        _ => {
            if time_spent_secs < 8.0 {
                1.2
            } else {
                1.0
            }
        }
    };

    let hint_multiplier = if used_hint {
        0.5
    } else {
        1.0
    };

    let final_score = (base_score as f32 * streak_multiplier * speed_multiplier * hint_multiplier).round() as u32;

    ScoreCalculationResult {
        final_score,
        base_score,
        streak_multiplier,
        speed_multiplier,
        hint_multiplier,
    }
}
