//! Where the Sun, the Moon and the planets are, seen from the centre of the Earth.
//!
//! The ephemeris is deliberately low precision. Formulas follow Jean Meeus,
//! *Astronomical Algorithms* (2nd ed.):
//! - chapter 25 for the Sun (`sun`),
//! - chapter 31 low-precision Keplerian elements for the planets (the table in
//!   `elements`, the maths in `kepler`),
//! - chapter 47 truncated lunar series for the Moon (the table in `lunar_terms`,
//!   the maths in `moon`).
//!
//! That places a body to about a degree: enough for a star map, not for almanac work.
//! Every place is geocentric, for a Julian Date in UT, as a direction on the J2000
//! mean equator and equinox (`ecliptic` turns the ecliptic places onto it).

mod ecliptic;
mod elements;
mod kepler;
mod lunar_terms;
mod moon;
mod sun;
#[cfg(test)]
mod tests;

use std::f64::consts::TAU;

use self::elements::OrbitalElements;

/// The Julian Date of the epoch J2000.0.
const J2000: f64 = 2_451_545.0;
/// Days in a Julian century.
const JULIAN_CENTURY_DAYS: f64 = 36_525.0;

/// The solar-system bodies the ephemeris knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Body {
    /// The Sun.
    Sun,
    /// Mercury.
    Mercury,
    /// Venus.
    Venus,
    /// Earth is included for completeness, but [`Body::position`] gives it a
    /// geocentric placeholder with a zero vector because the observer is located
    /// at the Earth's center in this module.
    Earth,
    /// The Moon.
    Moon,
    /// Mars.
    Mars,
    /// Jupiter.
    Jupiter,
    /// Saturn.
    Saturn,
    /// Uranus.
    Uranus,
    /// Neptune.
    Neptune,
}

/// Low-precision geocentric equatorial coordinates for a solar-system body.
///
/// Right ascension and declination are in radians on the J2000 mean
/// equator/equinox. `unit_vector` is the corresponding unit Cartesian vector in
/// the same frame. `magnitude` is a fixed mean visual magnitude constant rather
/// than a phase-corrected instantaneous brightness.
#[derive(Debug, Clone, Copy)]
pub struct PlanetPosition {
    /// Body for which the position was computed.
    pub body: Body,
    /// Geocentric right ascension in radians, normalized to `[0, 2π)`.
    pub ra_radians: f64,
    /// Geocentric declination in radians.
    pub dec_radians: f64,
    /// Unit Cartesian direction vector on the J2000 mean equator/equinox: x towards
    /// the vernal equinox, z towards the north celestial pole.
    pub unit_vector: [f64; 3],
    /// Mean visual magnitude constant for the body.
    pub magnitude: f64,
}

/// The bodies a star map shows, in the order it draws them: all but the Earth,
/// whose geocentric coordinates are degenerate.
const CHARTED: [Body; 9] = [
    Body::Sun,
    Body::Mercury,
    Body::Venus,
    Body::Moon,
    Body::Mars,
    Body::Jupiter,
    Body::Saturn,
    Body::Uranus,
    Body::Neptune,
];

/// The geocentric positions of the bodies a star map shows, at a Julian Date in UT.
///
/// The returned vector contains 9 geocentric bodies in this order: Sun,
/// Mercury, Venus, Moon, Mars, Jupiter, Saturn, Uranus, Neptune. Earth is
/// intentionally excluded because geocentric Earth coordinates are degenerate.
#[must_use]
pub fn all_positions(jd_ut: f64) -> Vec<PlanetPosition> {
    CHARTED
        .into_iter()
        .map(|body| body.position(jd_ut))
        .collect()
}

impl Body {
    /// The body's geocentric position at a Julian Date in UT.
    ///
    /// The implementation is intentionally low precision: Sun from Meeus Ch. 25,
    /// planets from unperturbed Keplerian elements in Ch. 31, Moon from the main
    /// periodic terms in Ch. 47. This is suitable for star-map placement at about
    /// degree-level accuracy, not for precise almanac work.
    #[must_use]
    pub fn position(self, jd_ut: f64) -> PlanetPosition {
        let unit_vector = match self {
            Self::Earth => {
                return PlanetPosition {
                    body: self,
                    ra_radians: 0.0,
                    dec_radians: 0.0,
                    unit_vector: [0.0, 0.0, 0.0],
                    magnitude: 0.0,
                };
            }
            Self::Sun => {
                let (lambda, beta, _distance) = sun::geocentric_ecliptic(jd_ut);
                ecliptic::spherical_to_equatorial(lambda, beta)
            }
            Self::Moon => {
                let (lambda, beta, _distance_km) = moon::geocentric_ecliptic(jd_ut);
                ecliptic::spherical_to_equatorial(lambda, beta)
            }
            Self::Mercury => planet_direction(&elements::MERCURY, jd_ut),
            Self::Venus => planet_direction(&elements::VENUS, jd_ut),
            Self::Mars => planet_direction(&elements::MARS, jd_ut),
            Self::Jupiter => planet_direction(&elements::JUPITER, jd_ut),
            Self::Saturn => planet_direction(&elements::SATURN, jd_ut),
            Self::Uranus => planet_direction(&elements::URANUS, jd_ut),
            Self::Neptune => planet_direction(&elements::NEPTUNE, jd_ut),
        };
        let ra = unit_vector[1].atan2(unit_vector[0]).rem_euclid(TAU);
        let dec = unit_vector[2]
            .atan2((unit_vector[0] * unit_vector[0] + unit_vector[1] * unit_vector[1]).sqrt());
        PlanetPosition {
            body: self,
            ra_radians: ra,
            dec_radians: dec,
            unit_vector,
            magnitude: self.mean_magnitude(),
        }
    }

    /// Suggested fallback display color for the body as an `(r, g, b)` tuple.
    ///
    /// These colors are simple astronomy-oriented defaults for downstream renderers.
    /// They are intentionally not treated as authoritative UI design values.
    #[must_use]
    pub const fn color(self) -> (u8, u8, u8) {
        match self {
            Self::Sun => (255, 214, 102),
            Self::Mercury => (180, 180, 170),
            Self::Venus => (244, 230, 190),
            Self::Earth => (100, 149, 237),
            Self::Moon => (214, 214, 214),
            Self::Mars => (219, 98, 71),
            Self::Jupiter => (216, 180, 140),
            Self::Saturn => (210, 195, 142),
            Self::Uranus => (142, 212, 220),
            Self::Neptune => (92, 126, 220),
        }
    }

    /// A mean visual magnitude, the same at every phase and distance.
    const fn mean_magnitude(self) -> f64 {
        match self {
            Self::Sun => -26.7,
            Self::Mercury => -0.42,
            Self::Venus => -4.6,
            Self::Earth => 0.0,
            Self::Moon => -12.74,
            Self::Mars => -1.6,
            Self::Jupiter => -2.94,
            Self::Saturn => 0.46,
            Self::Uranus => 5.32,
            Self::Neptune => 7.78,
        }
    }
}

/// The geocentric equatorial unit vector of a planet: its heliocentric place less
/// the Earth's, turned from the ecliptic to the equator.
fn planet_direction(planet: &OrbitalElements, jd: f64) -> [f64; 3] {
    let earth = kepler::heliocentric_ecliptic(&elements::EARTH, jd);
    let planet = kepler::heliocentric_ecliptic(planet, jd);
    let geocentric_ecliptic = [
        planet[0] - earth[0],
        planet[1] - earth[1],
        planet[2] - earth[2],
    ];
    ecliptic::vector_to_equatorial(geocentric_ecliptic)
}

/// Julian centuries from J2000.0 to a Julian Date.
fn julian_centuries(jd: f64) -> f64 {
    (jd - J2000) / JULIAN_CENTURY_DAYS
}

/// An angle in radians brought into `[0, 2π)`.
fn normalize_radians(angle: f64) -> f64 {
    angle.rem_euclid(TAU)
}
