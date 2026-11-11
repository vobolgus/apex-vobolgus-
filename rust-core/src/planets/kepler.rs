//! A planet's place from its orbital elements (Meeus, chapter 31): the elements at
//! the instant, the eccentric anomaly from Kepler's equation, and the point on the
//! orbit turned into the ecliptic frame. No perturbations: the orbit is a fixed
//! ellipse whose elements drift linearly.

use std::f64::consts::PI;

use super::elements::OrbitalElements;
use super::{julian_centuries, normalize_radians};

/// Heliocentric position on the mean ecliptic and equinox of J2000.0, in AU, at a
/// Julian Date.
pub(super) fn heliocentric_ecliptic(elements: &OrbitalElements, jd: f64) -> [f64; 3] {
    let t = julian_centuries(jd);
    let a = elements.a_au + elements.a_rate_au * t;
    let e = elements.e + elements.e_rate * t;
    let i = (elements.i_deg + elements.i_rate_arcsec * t / 3600.0).to_radians();
    let l = (elements.l_deg + elements.l_rate_arcsec * t / 3600.0).to_radians();
    let long_peri =
        (elements.long_peri_deg + elements.long_peri_rate_arcsec * t / 3600.0).to_radians();
    let long_node =
        (elements.long_node_deg + elements.long_node_rate_arcsec * t / 3600.0).to_radians();

    let mean_anomaly = normalize_radians(l - long_peri);
    let arg_perihelion = normalize_radians(long_peri - long_node);
    let eccentric_anomaly = solve_kepler(mean_anomaly, e);

    let x_orbital = a * (eccentric_anomaly.cos() - e);
    let y_orbital = a * (1.0 - e * e).sqrt() * eccentric_anomaly.sin();
    let true_anomaly = y_orbital.atan2(x_orbital);
    let radius = (x_orbital * x_orbital + y_orbital * y_orbital).sqrt();
    let argument = true_anomaly + arg_perihelion;

    [
        radius * (long_node.cos() * argument.cos() - long_node.sin() * argument.sin() * i.cos()),
        radius * (long_node.sin() * argument.cos() + long_node.cos() * argument.sin() * i.cos()),
        radius * argument.sin() * i.sin(),
    ]
}

/// The eccentric anomaly `E` with `E - e·sin E = M`, by Newton's method, in radians.
fn solve_kepler(mean_anomaly: f64, eccentricity: f64) -> f64 {
    let mut eccentric_anomaly = if eccentricity < 0.8 { mean_anomaly } else { PI };
    for _ in 0..15 {
        let delta = (eccentric_anomaly - eccentricity * eccentric_anomaly.sin() - mean_anomaly)
            / (1.0 - eccentricity * eccentric_anomaly.cos());
        eccentric_anomaly -= delta;
        if delta.abs() < 1e-12 {
            break;
        }
    }
    eccentric_anomaly
}
