pub mod catalog;
pub mod coords;
pub mod planets;
pub mod projections;
pub mod time;

pub use catalog::{HipCatalog, MessierCatalog, MessierObject, Star};
pub use coords::ra_dec_to_unit_vector;
pub use projections::{
    CameraConfig, PinholeProjection, ProjectionError, StereoPoint, StereoProjection, ViewKind,
    ViewProjection,
};
pub use time::{DateTime, julian_date, sidereal_time, vernal_equinox_hour_angle};

#[cfg(test)]
mod tests {
    use super::*;

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
}
