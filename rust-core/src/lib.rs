pub mod catalog;
pub mod mechanics;
pub mod projections;
pub mod scoring;
pub mod time;

pub use catalog::{Star, HipCatalog, MessierObject, MessierCatalog};
pub use mechanics::{OrbitPoint, OrbitSolution, OrbitState, compute_orbit};
pub use projections::{CameraConfig, PinholeProjection, PinholeProjectionResult, StereoProjection, StereoProjectionResult};
pub use scoring::{Difficulty, GameMode, PlayerRank, ScoreCalculationResult, calculate_score};
pub use time::{DateTime, julian_date, get_sidereal_time, vequinox_hour_angle};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_julian_date() {
        // Проверяем известную юлианскую дату
        // 2000-01-01 12:00:00 UTC имеет JD = 2451545.0
        // Наша функция julian_date рассчитывает JD на начало дня (00:00:00),
        // поэтому julian_date(2000, 1, 1) вернет 2451544.5.
        let jd = julian_date(2000, 1, 1);
        assert_eq!(jd, 2451544.5);

        // Еще один тест: 1970-01-01
        let jd_epoch = julian_date(1970, 1, 1);
        assert_eq!(jd_epoch, 2440587.5);
    }

    #[test]
    fn test_sidereal_time_longitude_ignored() {
        // Убеждаемся, что LST возвращает одинаковое значение независимо от longitude,
        // сохраняя зафиксированный баг совместимости с Python.
        let dt = DateTime::new(2024, 5, 20, 22, 0, 0);
        let lst1 = get_sidereal_time(10.0, dt);
        let lst2 = get_sidereal_time(100.0, dt);
        assert_eq!(lst1, lst2);
        assert!(lst1 >= 0.0 && lst1 < 24.0);
    }

    #[test]
    fn test_hip_catalog_loading() {
        let catalog = HipCatalog::new();
        let stars = catalog.get_stars(6.5, None);
        // Должно быть загружено ~8870 звезд ярче 6.5 звездной величины
        assert!(!stars.is_empty());
        assert!(stars.len() > 8000 && stars.len() < 9000);

        // Проверяем фильтрацию по звездным величинам
        let bright_stars = catalog.get_stars(2.0, None);
        assert!(bright_stars.len() < stars.len());
        for star in bright_stars {
            assert!(star.v_mag <= 2.0);
        }

        // Проверяем диапазон min_mag .. max_mag
        let middle_stars = catalog.get_stars(5.0, Some(3.0));
        for star in middle_stars {
            assert!(star.v_mag >= 3.0 && star.v_mag <= 5.0);
        }
    }

    #[test]
    fn test_messier_catalog_loading() {
        let catalog = MessierCatalog::new();
        let all_objects = catalog.get_all_objects();
        assert_eq!(all_objects.len(), 110);

        // Проверяем конкретный объект (M31 - туманность Андромеды)
        let m31 = catalog.get_object_by_number(31).expect("M31 must exist");
        assert_eq!(m31.name, "Andromeda Galaxy");
        assert_eq!(m31.obj_type, 1); // Galaxy
        assert_eq!(m31.type_name(), "Galaxy");
        assert_eq!(m31.type_color(), "#FF6B9D");
        assert_eq!(m31.constellation, "And");

        // Фильтрация по типам
        let galaxies = catalog.get_objects_by_type(1);
        assert!(!galaxies.is_empty());
        assert!(galaxies.iter().all(|g| g.obj_type == 1));

        // Поиск по созвездию
        let ori_objects = catalog.get_objects_by_constellation("Ori");
        assert!(!ori_objects.is_empty());
        // Проверка регистронезависимости
        let ori_objects_lower = catalog.get_objects_by_constellation("ori");
        assert_eq!(ori_objects.len(), ori_objects_lower.len());

        // Фильтрация по звездной величине
        let bright_messier = catalog.get_objects_by_magnitude(0.0, 6.0);
        assert!(bright_messier.len() < 110);
        for obj in bright_messier {
            assert!(obj.v_mag >= 0.0 && obj.v_mag <= 6.0);
        }
    }

    #[test]
    fn test_stereo_projection() {
        // Полярная звезда имеет dec близкую к 90 градусам.
        // При наблюдении с Северного полюса (latitude = 90.0) в зените (zenith = 0.0),
        // она должна проецироваться близко к центру (0.0, 0.0).
        let dt = DateTime::new(2024, 1, 1, 0, 0, 0);
        
        // Примерная звезда рядом с Северным полюсом мира (ra=0, dec=89)
        // ECI: x = cos(89)*cos(0), y = cos(89)*sin(0), z = sin(89)
        let dec_rad = 89.0f32.to_radians();
        let star_x = dec_rad.cos();
        let star_y = 0.0;
        let star_z = dec_rad.sin();

        let proj = StereoProjection::project(
            star_x, star_y, star_z,
            90.0, // Наблюдатель на Северном Полюсе
            0.0,
            dt
        );

        assert!(proj.is_some());
        let res = proj.unwrap();
        // Зенит должен быть около 1 градуса (90 - 89) = 0.0175 рад
        assert!((res.zenith - 1.0f32.to_radians()).abs() < 1e-4);
        assert!(res.radius > 0.0);
        // Координаты на плоскости должны быть очень близки к центру
        assert!(res.x.abs() < 0.1);
        assert!(res.y.abs() < 0.1);

        // Звезда сзади наблюдателя (на Южном полюсе) при наблюдении с Севера
        let south_star_x = 0.0;
        let south_star_y = 0.0;
        let south_star_z = -1.0;
        let proj_invisible = StereoProjection::project(
            south_star_x, south_star_y, south_star_z,
            90.0,
            0.0,
            dt
        );
        // Должно быть отфильтровано ограничением zenith > pi / 1.9
        assert!(proj_invisible.is_none());
    }

    #[test]
    fn test_pinhole_projection_center() {
        // Идеальный случай: камера смотрит прямо на звезду (1, 0, 0).
        // Звезда должна проецироваться ровно в центр кадра.
        let camera_config = CameraConfig::from_fov_and_aspect(60.0, 1.5, 800);
        let center_direction = [1.0, 0.0, 0.0];
        let tilt_deg = 0.0;

        let proj = PinholeProjection::project(
            1.0, 0.0, 0.0,
            center_direction,
            tilt_deg,
            &camera_config
        );

        assert!(proj.is_some());
        let res = proj.unwrap();
        
        let expected_x = camera_config.width as f32 / 2.0;
        let expected_y = camera_config.height as f32 / 2.0;

        assert!((res.x_pix - expected_x).abs() < 1e-4);
        assert!((res.y_pix - expected_y).abs() < 1e-4);
    }

    #[test]
    fn test_pinhole_projection_bounds() {
        let camera_config = CameraConfig::from_fov_and_aspect(60.0, 1.5, 800);
        let center_direction = [1.0, 0.0, 0.0];
        let tilt_deg = 0.0;

        // Звезда за спиной камеры (в ECI: [-1, 0, 0] при взгляде на [1, 0, 0])
        let proj_behind = PinholeProjection::project(
            -1.0, 0.0, 0.0,
            center_direction,
            tilt_deg,
            &camera_config
        );
        assert!(proj_behind.is_none());

        // Звезда слишком сильно в стороне (вне границ с учетом 1/16 gap)
        let proj_far_side = PinholeProjection::project(
            0.0, 1.0, 0.0, // ECI перпендикулярно взгляду
            center_direction,
            tilt_deg,
            &camera_config
        );
        assert!(proj_far_side.is_none());
    }

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
        assert_eq!(PlayerRank::GalacticExplorer.display_name(), "🌌 Galactic Explorer");
    }
}
