use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PinholeProjectionResult {
    pub x_pix: f32,
    pub y_pix: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CameraConfig {
    pub width: u32,
    pub height: u32,
    pub focal_length: f64,
}

impl CameraConfig {
    pub fn new(width: u32, height: u32, focal_length: f64) -> Self {
        Self {
            width,
            height,
            focal_length,
        }
    }

    pub fn from_fov_and_aspect(fov_deg: f64, aspect_ratio: f64, height_pix: u32) -> Self {
        let width_pix = (height_pix as f64 * aspect_ratio) as u32;
        let fov_rad = fov_deg.to_radians();
        let diagonal = ((width_pix as f64).powi(2) + (height_pix as f64).powi(2)).sqrt();
        let focal_length_pix = (diagonal / 2.0) / (fov_rad / 2.0).tan();
        Self {
            width: width_pix,
            height: height_pix,
            focal_length: focal_length_pix,
        }
    }
}

pub struct PinholeProjection;

impl PinholeProjection {
    /// Проецирует ECI координаты (star_x, star_y, star_z) звезды на плоскость кадра (экран)
    /// с учетом направления центра камеры center_direction [x, y, z],
    /// угла наклона камеры tilt_deg, фокусного расстояния, ширины и высоты кадра.
    /// Возвращает None, если звезда находится сзади камеры или выходит за границы экрана с учетом 1/16 gap.
    pub fn project(
        star_x: f32,
        star_y: f32,
        star_z: f32,
        center_direction: [f64; 3],
        tilt_deg: f64,
        camera_config: &CameraConfig,
    ) -> Option<PinholeProjectionResult> {
        let star = [star_x as f64, star_y as f64, star_z as f64];

        // 1. Z-axis: -center_direction normalized
        let z_norm = (center_direction[0].powi(2)
            + center_direction[1].powi(2)
            + center_direction[2].powi(2))
        .sqrt();
        if z_norm == 0.0 {
            return None;
        }
        let mut z_axis = [
            -center_direction[0] / z_norm,
            -center_direction[1] / z_norm,
            -center_direction[2] / z_norm,
        ];

        let z_axis_norm = (z_axis[0].powi(2) + z_axis[1].powi(2) + z_axis[2].powi(2)).sqrt();
        z_axis = [
            z_axis[0] / z_axis_norm,
            z_axis[1] / z_axis_norm,
            z_axis[2] / z_axis_norm,
        ];

        // Define ECI z-axis
        let mut up_vec = [0.0, 0.0, 1.0];
        // If view is close to zenith choose y-axis
        if (z_axis[2].abs() - 1.0).abs() < 1e-7 {
            up_vec = [0.0, 1.0, 0.0];
        }

        // x-axis: cross(up_vec, z_axis) normalized
        let mut x_axis = [
            up_vec[1] * z_axis[2] - up_vec[2] * z_axis[1],
            up_vec[2] * z_axis[0] - up_vec[0] * z_axis[2],
            up_vec[0] * z_axis[1] - up_vec[1] * z_axis[0],
        ];
        let x_norm = (x_axis[0].powi(2) + x_axis[1].powi(2) + x_axis[2].powi(2)).sqrt();
        if x_norm == 0.0 {
            return None;
        }
        x_axis = [x_axis[0] / x_norm, x_axis[1] / x_norm, x_axis[2] / x_norm];

        // y-axis: cross(z_axis, x_axis) normalized
        let mut y_axis = [
            z_axis[1] * x_axis[2] - z_axis[2] * x_axis[1],
            z_axis[2] * x_axis[0] - z_axis[0] * x_axis[2],
            z_axis[0] * x_axis[1] - z_axis[1] * x_axis[0],
        ];
        let y_norm = (y_axis[0].powi(2) + y_axis[1].powi(2) + y_axis[2].powi(2)).sqrt();
        if y_norm == 0.0 {
            return None;
        }
        y_axis = [y_axis[0] / y_norm, y_axis[1] / y_norm, y_axis[2] / y_norm];

        // Apply tilt rotation around Z-axis
        let tilt_rad = tilt_deg.to_radians();
        let cos_tilt = tilt_rad.cos();
        let sin_tilt = tilt_rad.sin();

        let x_axis_rot = [
            cos_tilt * x_axis[0] + sin_tilt * y_axis[0],
            cos_tilt * x_axis[1] + sin_tilt * y_axis[1],
            cos_tilt * x_axis[2] + sin_tilt * y_axis[2],
        ];

        let y_axis_rot = [
            -sin_tilt * x_axis[0] + cos_tilt * y_axis[0],
            -sin_tilt * x_axis[1] + cos_tilt * y_axis[1],
            -sin_tilt * x_axis[2] + cos_tilt * y_axis[2],
        ];

        // Project star ECI onto camera frame coordinates
        let x_cam = x_axis_rot[0] * star[0] + x_axis_rot[1] * star[1] + x_axis_rot[2] * star[2];
        let y_cam = y_axis_rot[0] * star[0] + y_axis_rot[1] * star[1] + y_axis_rot[2] * star[2];
        let z_cam = z_axis[0] * star[0] + z_axis[1] * star[1] + z_axis[2] * star[2];

        // Star must be in front of the camera (z_cam < 0.0)
        if z_cam >= 0.0 {
            return None;
        }

        // Perspective projection
        let x_proj = -camera_config.focal_length * x_cam / z_cam;
        let y_proj = -camera_config.focal_length * y_cam / z_cam;

        // Convert to pixel coordinates
        let x_pix = x_proj + camera_config.width as f64 / 2.0;
        let y_pix = camera_config.height as f64 / 2.0 - y_proj;

        // Check if points are within image bounds (with 1/16 gap)
        let gap = 1.0 / 16.0;
        let width = camera_config.width as f64;
        let height = camera_config.height as f64;

        if x_pix >= -width * gap
            && x_pix <= width * (1.0 + gap)
            && y_pix >= -height * gap
            && y_pix <= height * (1.0 + gap)
        {
            Some(PinholeProjectionResult {
                x_pix: x_pix as f32,
                y_pix: y_pix as f32,
            })
        } else {
            None
        }
    }
}
