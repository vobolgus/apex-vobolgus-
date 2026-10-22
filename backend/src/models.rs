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
