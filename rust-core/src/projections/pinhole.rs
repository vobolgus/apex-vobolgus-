//! The pinhole camera of a chart drawn without the preview's view: a frame centred
//! on a direction of the sky, turned by a tilt, with its focal length in px.

use serde::{Deserialize, Serialize};

use super::{Project, ProjectionError};
use crate::coords::Direction;

/// The frame of a pinhole camera: its size and focal length in px.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CameraConfig {
    /// Frame width, px.
    pub width: u32,
    /// Frame height, px.
    pub height: u32,
    /// Distance from the pinhole to the frame, px.
    pub focal_length: f64,
}

impl CameraConfig {
    /// A frame of `width` × `height` px with a focal length in px.
    #[must_use]
    pub const fn new(width: u32, height: u32, focal_length: f64) -> Self {
        Self {
            width,
            height,
            focal_length,
        }
    }

    /// A frame `height_pix` px high and `aspect_ratio` times as wide (rounded down),
    /// whose diagonal spans `fov_deg` degrees.
    #[must_use]
    pub fn from_fov_and_aspect(fov_deg: f64, aspect_ratio: f64, height_pix: u32) -> Self {
        let width_pix = (f64::from(height_pix) * aspect_ratio) as u32;
        let fov_rad = fov_deg.to_radians();
        let diagonal = (f64::from(width_pix).powi(2) + f64::from(height_pix).powi(2)).sqrt();
        let focal_length_pix = (diagonal / 2.0) / (fov_rad / 2.0).tan();
        Self {
            width: width_pix,
            height: height_pix,
            focal_length: focal_length_pix,
        }
    }
}

/// A pinhole camera looking at a direction of the equatorial frame (`x` to RA 0h,
/// `z` to the north celestial pole), its frame turned by a tilt.
#[derive(Debug, Clone, Copy)]
pub struct PinholeProjection {
    /// The frame's right, after the tilt.
    x_axis: [f64; 3],
    /// The frame's up, after the tilt.
    y_axis: [f64; 3],
    /// Away from the view: the camera looks down `-z_axis`.
    z_axis: [f64; 3],
    camera: CameraConfig,
}

impl PinholeProjection {
    /// A camera looking towards `center_direction` (any length), its frame turned by
    /// `tilt_deg` degrees about the view, celestial north up when the tilt is 0.
    /// Looking at a celestial pole, the frame's up is the direction of RA 6h.
    ///
    /// # Errors
    ///
    /// [`ProjectionError::DegenerateDirection`] for a centre direction of zero length.
    pub fn new(
        center_direction: [f64; 3],
        tilt_deg: f64,
        camera: CameraConfig,
    ) -> Result<Self, ProjectionError> {
        // 1. Z-axis: -center_direction normalized
        let z_norm = (center_direction[0].powi(2)
            + center_direction[1].powi(2)
            + center_direction[2].powi(2))
        .sqrt();
        if z_norm == 0.0 {
            return Err(ProjectionError::DegenerateDirection);
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
            return Err(ProjectionError::DegenerateDirection);
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
            return Err(ProjectionError::DegenerateDirection);
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

        Ok(Self {
            x_axis: x_axis_rot,
            y_axis: y_axis_rot,
            z_axis,
            camera,
        })
    }
}

impl Project for PinholeProjection {
    /// Position in px of a direction of the equatorial frame, origin at the frame's
    /// top-left, y down. `None` behind the camera, or outside the frame grown by a
    /// sixteenth of its size on every side.
    fn project(&self, direction: Direction) -> Option<(f32, f32)> {
        let star = [
            f64::from(direction.x),
            f64::from(direction.y),
            f64::from(direction.z),
        ];
        let (x_axis_rot, y_axis_rot, z_axis) = (self.x_axis, self.y_axis, self.z_axis);
        let camera_config = &self.camera;

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
        let width = f64::from(camera_config.width);
        let height = f64::from(camera_config.height);
        let x_pix = x_proj + width / 2.0;
        let y_pix = height / 2.0 - y_proj;

        // Check if points are within image bounds (with 1/16 gap)
        let gap = 1.0 / 16.0;

        if x_pix >= -width * gap
            && x_pix <= width * (1.0 + gap)
            && y_pix >= -height * gap
            && y_pix <= height * (1.0 + gap)
        {
            Some((x_pix as f32, y_pix as f32))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pinhole_projection_center() {
        // Идеальный случай: камера смотрит прямо на звезду (1, 0, 0).
        // Звезда должна проецироваться ровно в центр кадра.
        let camera_config = CameraConfig::from_fov_and_aspect(60.0, 1.5, 800);
        let center_direction = [1.0, 0.0, 0.0];
        let tilt_deg = 0.0;
        let camera = PinholeProjection::new(center_direction, tilt_deg, camera_config).unwrap();

        let proj = camera.project(Direction::new(1.0, 0.0, 0.0));

        assert!(proj.is_some());
        let (x_pix, y_pix) = proj.unwrap();

        let expected_x = camera_config.width as f32 / 2.0;
        let expected_y = camera_config.height as f32 / 2.0;

        assert!((x_pix - expected_x).abs() < 1e-4);
        assert!((y_pix - expected_y).abs() < 1e-4);
    }

    #[test]
    fn test_pinhole_projection_bounds() {
        let camera_config = CameraConfig::from_fov_and_aspect(60.0, 1.5, 800);
        let center_direction = [1.0, 0.0, 0.0];
        let tilt_deg = 0.0;
        let camera = PinholeProjection::new(center_direction, tilt_deg, camera_config).unwrap();

        // Звезда за спиной камеры (в ECI: [-1, 0, 0] при взгляде на [1, 0, 0])
        let proj_behind = camera.project(Direction::new(-1.0, 0.0, 0.0));
        assert!(proj_behind.is_none());

        // Звезда слишком сильно в стороне (вне границ с учетом 1/16 gap)
        let proj_far_side = camera.project(Direction::new(0.0, 1.0, 0.0)); // ECI перпендикулярно взгляду
        assert!(proj_far_side.is_none());
    }

    #[test]
    fn a_centre_of_no_length_is_refused() {
        let camera_config = CameraConfig::from_fov_and_aspect(60.0, 1.5, 800);
        assert_eq!(
            PinholeProjection::new([0.0, 0.0, 0.0], 0.0, camera_config).unwrap_err(),
            ProjectionError::DegenerateDirection
        );
    }
}
