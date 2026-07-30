//! Shared celestial coordinate conversions.
//!
//! These live in `rust-core` because both the interactive engine and the SVG/PDF
//! exporter in `backend` need the exact same geometry: if the two drifted apart the
//! canvas preview and the printed map would no longer agree.

/// Converts equatorial coordinates to a unit vector in the equatorial (ICRS) frame.
///
/// `ra_rad` is the right ascension and `dec_rad` the declination, both in radians.
/// In the returned frame `x` points at (RA 0h, Dec 0°), `y` at (RA 6h, Dec 0°) and
/// `z` at the north celestial pole.
pub fn ra_dec_to_unit_vector(ra_rad: f32, dec_rad: f32) -> (f32, f32, f32) {
    let cos_dec = dec_rad.cos();
    (
        cos_dec * ra_rad.cos(),
        cos_dec * ra_rad.sin(),
        dec_rad.sin(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(actual: (f32, f32, f32), expected: (f32, f32, f32)) {
        assert!(
            (actual.0 - expected.0).abs() < 1e-6
                && (actual.1 - expected.1).abs() < 1e-6
                && (actual.2 - expected.2).abs() < 1e-6,
            "expected {:?}, got {:?}",
            expected,
            actual
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
                let (x, y, z) = ra_dec_to_unit_vector(
                    (ra_deg as f32).to_radians(),
                    (dec_deg as f32).to_radians(),
                );
                let norm = (x * x + y * y + z * z).sqrt();
                assert!(
                    (norm - 1.0).abs() < 1e-6,
                    "ra={} dec={} produced norm {}",
                    ra_deg,
                    dec_deg,
                    norm
                );
            }
        }
    }
}
