// Extracted from rust-core/src/lib.rs at 05becf9 — orbit mechanics and game scoring parts. Full original: git show 05becf9:rust-core/src/lib.rs
// Справочный фрагмент, не компилируется. Модули лежат рядом:
// legacy/rust-core/src/{mechanics.rs, scoring.rs}.

pub mod mechanics;
pub mod scoring;

pub use mechanics::{OrbitPoint, OrbitSolution, OrbitState, compute_orbit};
pub use scoring::{Difficulty, GameMode, PlayerRank, ScoreCalculationResult, calculate_score};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_score() {
        // Базовый тест: Easy, Trivia, без стрика, медленно, без подсказки
        let res = calculate_score(Difficulty::Easy, GameMode::Trivia, 0, 10.0, false);
        assert_eq!(res.final_score, 100);
        assert_eq!(res.base_score, 100);
        assert_eq!(res.streak_multiplier, 1.0);
        assert_eq!(res.speed_multiplier, 1.0);
        assert_eq!(res.hint_multiplier, 1.0);

        // Тест на стрик: стрик = 3 (множитель 1.5), Hard (балл 350)
        let res_streak = calculate_score(Difficulty::Hard, GameMode::Trivia, 3, 10.0, false);
        // 350 * 1.5 = 525
        assert_eq!(res_streak.final_score, 525);
        assert_eq!(res_streak.streak_multiplier, 1.5);

        // Тест на скорость: Medium (балл 200), ответ за 5 сек (множитель 1.2)
        let res_speed = calculate_score(Difficulty::Medium, GameMode::Trivia, 0, 5.0, false);
        // 200 * 1.2 = 240
        assert_eq!(res_speed.final_score, 240);
        assert_eq!(res_speed.speed_multiplier, 1.2);

        // Тест на скорость в режиме Draw: лимит 45 сек. Ответ за 30 сек.
        let res_draw_speed = calculate_score(Difficulty::Medium, GameMode::Draw, 0, 30.0, false);
        assert_eq!(res_draw_speed.speed_multiplier, 1.2);

        // Тест на подсказку: Hard (350), использована подсказка (множитель 0.5)
        let res_hint = calculate_score(Difficulty::Hard, GameMode::Trivia, 0, 10.0, true);
        // 350 * 0.5 = 175
        assert_eq!(res_hint.final_score, 175);
        assert_eq!(res_hint.hint_multiplier, 0.5);

        // Комплексный тест: Hard (350), стрик = 12 (3.0), скорость = 4.0 (1.2), подсказка = true (0.5)
        let res_complex = calculate_score(Difficulty::Hard, GameMode::Trivia, 12, 4.0, true);
        // 350 * 3.0 * 1.2 * 0.5 = 630
        assert_eq!(res_complex.final_score, 630);
    }

    #[test]
    fn test_player_ranks() {
        assert_eq!(PlayerRank::from_score(0), PlayerRank::Beginner);
        assert_eq!(PlayerRank::from_score(499), PlayerRank::Beginner);
        assert_eq!(PlayerRank::from_score(500), PlayerRank::NightApprentice);
        assert_eq!(PlayerRank::from_score(1499), PlayerRank::NightApprentice);
        assert_eq!(PlayerRank::from_score(1500), PlayerRank::SkyWatcher);
        assert_eq!(PlayerRank::from_score(2999), PlayerRank::SkyWatcher);
        assert_eq!(PlayerRank::from_score(3000), PlayerRank::StarNavigator);
        assert_eq!(PlayerRank::from_score(4999), PlayerRank::StarNavigator);
        assert_eq!(PlayerRank::from_score(5000), PlayerRank::GalacticExplorer);
        assert_eq!(PlayerRank::from_score(10000), PlayerRank::GalacticExplorer);

        assert_eq!(PlayerRank::Beginner.display_name(), "🌑 Beginner");
        assert_eq!(
            PlayerRank::GalacticExplorer.display_name(),
            "🌌 Galactic Explorer"
        );
    }
}
