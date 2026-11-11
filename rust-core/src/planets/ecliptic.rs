//! From the ecliptic to the equator: a turn about the vernal equinox (the shared
//! x axis) by the obliquity of the ecliptic at J2000.0.

/// The mean obliquity of the ecliptic at J2000.0, 23°26′21.448″, in radians.
const J2000_OBLIQUITY_RADIANS: f64 = 23.439_291_111_f64.to_radians();

/// The equatorial unit vector of an ecliptic longitude and latitude, both in radians.
pub(super) fn spherical_to_equatorial(lambda: f64, beta: f64) -> [f64; 3] {
    let cos_beta = beta.cos();
    let ecliptic = [cos_beta * lambda.cos(), cos_beta * lambda.sin(), beta.sin()];
    vector_to_equatorial(ecliptic)
}

/// The equatorial unit vector along an ecliptic vector of any length.
pub(super) fn vector_to_equatorial(vector: [f64; 3]) -> [f64; 3] {
    let equatorial = [
        vector[0],
        vector[1] * J2000_OBLIQUITY_RADIANS.cos() - vector[2] * J2000_OBLIQUITY_RADIANS.sin(),
        vector[1] * J2000_OBLIQUITY_RADIANS.sin() + vector[2] * J2000_OBLIQUITY_RADIANS.cos(),
    ];
    normalize(equatorial)
}

fn normalize(vector: [f64; 3]) -> [f64; 3] {
    let norm = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    [vector[0] / norm, vector[1] / norm, vector[2] / norm]
}
