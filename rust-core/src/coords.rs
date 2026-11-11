//! Shared celestial coordinate conversions, and the direction on the sky they give.
//!
//! These live in `rust-core` because both the interactive engine and the SVG/PDF
//! exporter in `backend` need the exact same geometry: if the two drifted apart the
//! canvas preview and the printed map would no longer agree.

/// A direction on the sky: a vector of the equatorial (ICRS, J2000) frame, `x`
/// towards (RA 0h, Dec 0°), `y` towards (RA 6h, Dec 0°) and `z` towards the north
/// celestial pole.
///
/// The catalogues and [`ra_dec_to_unit_vector`] give unit vectors; the projections
/// take one of any length. Held in `f32`, as the catalogues hold their stars: a
/// place worked out in `f64` is narrowed once, on its way in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Direction {
    /// Towards RA 0h on the equator.
    pub x: f32,
    /// Towards RA 6h on the equator.
    pub y: f32,
    /// Towards the north celestial pole.
    pub z: f32,
}

impl Direction {
    /// The direction of the frame's vector `(x, y, z)`.
    #[must_use]
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
}

impl From<(f32, f32, f32)> for Direction {
    fn from((x, y, z): (f32, f32, f32)) -> Self {
        Self::new(x, y, z)
    }
}

impl From<[f32; 3]> for Direction {
    fn from([x, y, z]: [f32; 3]) -> Self {
        Self::new(x, y, z)
    }
}

impl From<[f64; 3]> for Direction {
    /// Each component narrowed to `f32`.
    fn from([x, y, z]: [f64; 3]) -> Self {
        Self::new(x as f32, y as f32, z as f32)
    }
}

/// Converts equatorial coordinates to a unit vector in the equatorial (ICRS) frame.
///
/// `ra_rad` is the right ascension and `dec_rad` the declination, both in radians.
#[must_use]
pub fn ra_dec_to_unit_vector(ra_rad: f32, dec_rad: f32) -> Direction {
    let cos_dec = dec_rad.cos();
    Direction::new(
        cos_dec * ra_rad.cos(),
        cos_dec * ra_rad.sin(),
        dec_rad.sin(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(actual: Direction, expected: (f32, f32, f32)) {
        assert!(
            (actual.x - expected.0).abs() < 1e-6
                && (actual.y - expected.1).abs() < 1e-6
                && (actual.z - expected.2).abs() < 1e-6,
            "expected {expected:?}, got {actual:?}"
        );
    }

    #[test]
    fn test_ra_dec_to_unit_vector_axes() {
        // RA 0h, Dec 0° is the +x axis (vernal equinox).
        assert_close(ra_dec_to_unit_vector(0.0, 0.0), (1.0, 0.0, 0.0));
        // RA 6h, Dec 0° is the +y axis.
        assert_close(
            ra_dec_to_unit_vector(90.0f32.to_radians(), 0.0),
            (0.0, 1.0, 0.0),
        );
        // Dec +90° is the north celestial pole, regardless of RA.
        assert_close(
            ra_dec_to_unit_vector(123.0f32.to_radians(), 90.0f32.to_radians()),
            (0.0, 0.0, 1.0),
        );
    }

    #[test]
    fn test_ra_dec_to_unit_vector_is_normalized() {
        for ra_deg in (0..360).step_by(17) {
            for dec_deg in (-90..=90).step_by(13) {
                let Direction { x, y, z } = ra_dec_to_unit_vector(
                    (ra_deg as f32).to_radians(),
                    (dec_deg as f32).to_radians(),
                );
                let norm = (x * x + y * y + z * z).sqrt();
                assert!(
                    (norm - 1.0).abs() < 1e-6,
                    "ra={ra_deg} dec={dec_deg} produced norm {norm}"
                );
            }
        }
    }
}
