use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Star {
    pub hip_id: i32,
    pub v_mag: f32,
    pub ra: f32,  // в радианах
    pub dec: f32, // в радианах
    pub x: f32,   // ECI X coordinate
    pub y: f32,   // ECI Y coordinate
    pub z: f32,   // ECI Z coordinate
}

pub struct HipCatalog {
    stars: Vec<Star>,
}

impl HipCatalog {
    pub fn new() -> Self {
        let binary_data = include_bytes!("hip_data.bin");
        let stars: Vec<Star> = bincode::deserialize(binary_data).unwrap();
        Self { stars }
    }

    pub fn get_stars(&self, max_mag: f32, min_mag: Option<f32>) -> Vec<Star> {
        self.stars
            .iter()
            .filter(|s| s.v_mag <= max_mag && min_mag.map_or(true, |min| s.v_mag >= min))
            .cloned()
            .collect()
    }

    /// Iterates over stars matching the magnitude filter without allocating.
    /// Returns `&Star` references into the embedded catalog.
    pub fn iter_stars(&self, max_mag: f32, min_mag: Option<f32>) -> impl Iterator<Item = &Star> {
        self.stars
            .iter()
            .filter(move |s| s.v_mag <= max_mag && min_mag.map_or(true, |min| s.v_mag >= min))
    }
}

#[cfg(test)]
mod tests {
    use super::{HipCatalog, Star};

    fn assert_star_eq(a: &Star, b: &Star) {
        assert_eq!(a.hip_id, b.hip_id);
        assert_eq!(a.v_mag, b.v_mag);
        assert_eq!(a.ra, b.ra);
        assert_eq!(a.dec, b.dec);
        assert_eq!(a.x, b.x);
        assert_eq!(a.y, b.y);
        assert_eq!(a.z, b.z);
    }

    #[test]
    fn iter_stars_matches_get_stars() {
        let catalog = HipCatalog::new();
        let owned: Vec<Star> = catalog.get_stars(4.0, Some(1.0));
        let iterated: Vec<Star> = catalog.iter_stars(4.0, Some(1.0)).cloned().collect();

        assert_eq!(owned.len(), iterated.len());
        for (a, b) in owned.iter().zip(iterated.iter()) {
            assert_star_eq(a, b);
        }
    }
}
