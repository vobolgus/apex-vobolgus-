//! The Hipparcos stars to magnitude 6.5.

use serde::{Deserialize, Serialize};

use super::CatalogError;
use crate::coords::Direction;

/// The table compiled into the crate: 8870 stars to V 6.5, brightest first.
const EMBEDDED: &[u8] = include_bytes!("hip_data.bin");

/// A star of the Hipparcos catalogue.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Star {
    /// Its Hipparcos number.
    pub hip_id: i32,
    /// Visual magnitude, V.
    pub v_mag: f32,
    /// Right ascension, radians.
    pub ra: f32,
    /// Declination, radians.
    pub dec: f32,
    /// Unit vector towards the star in the equatorial (ECI) frame: x towards RA 0h.
    pub x: f32,
    /// Towards RA 6h.
    pub y: f32,
    /// Towards the north celestial pole.
    pub z: f32,
}

impl From<&Star> for Direction {
    /// The star's unit vector.
    fn from(star: &Star) -> Self {
        Self::new(star.x, star.y, star.z)
    }
}

/// The stars of the Hipparcos catalogue, in the order of their table.
pub struct HipCatalog {
    stars: Vec<Star>,
}

impl Default for HipCatalog {
    fn default() -> Self {
        Self::new()
    }
}

impl HipCatalog {
    /// The catalogue compiled into the crate: 8870 stars to V 6.5, brightest first.
    ///
    /// # Panics
    ///
    /// Never: the embedded table is a valid one, which the tests check.
    #[must_use]
    pub fn new() -> Self {
        Self::from_bincode(EMBEDDED).expect("the embedded Hipparcos table decodes")
    }

    /// A catalogue from a bincode list of [`Star`] records.
    ///
    /// # Errors
    ///
    /// [`CatalogError::Decode`] when the bytes are not such a list.
    pub fn from_bincode(bytes: &[u8]) -> Result<Self, CatalogError> {
        Ok(Self {
            stars: bincode::deserialize(bytes)?,
        })
    }

    /// The stars with `min_mag <= v_mag <= max_mag` (no lower bound with `None`),
    /// in the order of the table, without copying them.
    pub fn stars(&self, max_mag: f32, min_mag: Option<f32>) -> impl Iterator<Item = &Star> {
        self.stars
            .iter()
            .filter(move |s| s.v_mag <= max_mag && min_mag.is_none_or(|min| s.v_mag >= min))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hip_catalog_loading() {
        let catalog = HipCatalog::new();
        let stars: Vec<&Star> = catalog.stars(6.5, None).collect();
        // Должно быть загружено ~8870 звезд ярче 6.5 звездной величины
        assert!(!stars.is_empty());
        assert!(stars.len() > 8000 && stars.len() < 9000);

        // Проверяем фильтрацию по звездным величинам
        let bright_stars: Vec<&Star> = catalog.stars(2.0, None).collect();
        assert!(bright_stars.len() < stars.len());
        for star in bright_stars {
            assert!(star.v_mag <= 2.0);
        }

        // Проверяем диапазон min_mag .. max_mag
        for star in catalog.stars(5.0, Some(3.0)) {
            assert!(star.v_mag >= 3.0 && star.v_mag <= 5.0);
        }
    }

    #[test]
    fn a_table_that_is_not_bincode_is_an_error() {
        assert!(matches!(
            HipCatalog::from_bincode(&[1, 2, 3]),
            Err(CatalogError::Decode(_))
        ));
    }
}
