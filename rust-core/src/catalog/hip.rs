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
}
