//! The Moon's place from the main periodic terms of Meeus, chapter 47.

use super::lunar_terms::{LATITUDE, LONGITUDE_AND_DISTANCE, Multiples};
use super::{julian_centuries, normalize_radians};

/// The fundamental arguments of the lunar theory at an instant, in radians.
struct Arguments {
    /// The Moon's mean elongation, D.
    d: f64,
    /// The Sun's mean anomaly, M.
    m: f64,
    /// The Moon's mean anomaly, M′.
    m_prime: f64,
    /// The Moon's argument of latitude, F.
    f: f64,
}

impl Multiples {
    /// The term's argument, `D·d + M·m + M′·m′ + F·f`.
    fn argument(&self, at: &Arguments) -> f64 {
        f64::from(self.d) * at.d
            + f64::from(self.m) * at.m
            + f64::from(self.m_prime) * at.m_prime
            + f64::from(self.f) * at.f
    }

    /// A term in M shrinks with the Earth's eccentricity: by `E` with M once, `E²` twice.
    fn eccentricity_factor(&self, e: f64, e2: f64) -> f64 {
        match self.m.unsigned_abs() {
            1 => e,
            2 => e2,
            _ => 1.0,
        }
    }
}

/// Geocentric ecliptic longitude and latitude of the Moon in radians, and its
/// distance in km, at a Julian Date.
pub(super) fn geocentric_ecliptic(jd: f64) -> (f64, f64, f64) {
    let t = julian_centuries(jd);
    let t2 = t * t;
    let t3 = t2 * t;
    let t4 = t3 * t;

    let l_prime = normalize_radians(
        (218.3164477 + 481267.88123421 * t - 0.0015786 * t2 + t3 / 538841.0 - t4 / 65194000.0)
            .to_radians(),
    );
    let at = Arguments {
        d: normalize_radians(
            (297.8501921 + 445267.1114034 * t - 0.0018819 * t2 + t3 / 545868.0 - t4 / 113065000.0)
                .to_radians(),
        ),
        m: normalize_radians(
            (357.5291092 + 35999.0502909 * t - 0.0001536 * t2 + t3 / 24490000.0).to_radians(),
        ),
        m_prime: normalize_radians(
            (134.9633964 + 477198.8675055 * t + 0.0087414 * t2 + t3 / 69699.0 - t4 / 14712000.0)
                .to_radians(),
        ),
        f: normalize_radians(
            (93.2720950 + 483202.0175233 * t - 0.0036539 * t2 - t3 / 3526000.0 + t4 / 863310000.0)
                .to_radians(),
        ),
    };

    let a1 = (119.75 + 131.849 * t).to_radians();
    let a2 = (53.09 + 479264.290 * t).to_radians();
    let a3 = (313.45 + 481266.484 * t).to_radians();
    let e = 1.0 - 0.002516 * t - 0.0000074 * t2;
    let e2 = e * e;

    let mut sigma_l = 0.0;
    let mut sigma_r = 0.0;
    for term in &LONGITUDE_AND_DISTANCE {
        let e_factor = term.multiples.eccentricity_factor(e, e2);
        let argument = term.multiples.argument(&at);
        sigma_l += f64::from(term.longitude) * e_factor * argument.sin();
        sigma_r += f64::from(term.distance) * e_factor * argument.cos();
    }

    let mut sigma_b = 0.0;
    for term in &LATITUDE {
        let e_factor = term.multiples.eccentricity_factor(e, e2);
        let argument = term.multiples.argument(&at);
        sigma_b += f64::from(term.latitude) * e_factor * argument.sin();
    }

    // The additive terms: Venus (A1), Jupiter (A2) and the flattening of the Earth.
    sigma_l += 3958.0 * a1.sin() + 1962.0 * (l_prime - at.f).sin() + 318.0 * a2.sin();
    sigma_b += -2235.0 * l_prime.sin()
        + 382.0 * a3.sin()
        + 175.0 * (a1 - at.f).sin()
        + 175.0 * (a1 + at.f).sin()
        + 127.0 * (l_prime - at.m_prime).sin()
        - 115.0 * (l_prime + at.m_prime).sin();

    let longitude = normalize_radians(l_prime + (sigma_l / 1_000_000.0).to_radians());
    let latitude = (sigma_b / 1_000_000.0).to_radians();
    let distance_km = 385000.56 + sigma_r / 1000.0;
    (longitude, latitude, distance_km)
}
