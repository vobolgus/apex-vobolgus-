//! The Sun's apparent place, after Meeus, chapter 25 (the low-accuracy method).

use super::{julian_centuries, normalize_radians};

/// Geocentric apparent ecliptic longitude and latitude of the Sun in radians, and
/// its distance in AU, at a Julian Date. The latitude is taken as zero.
pub(super) fn geocentric_ecliptic(jd: f64) -> (f64, f64, f64) {
    let t = julian_centuries(jd);
    let mean_longitude =
        normalize_radians((280.46646 + 36000.76983 * t + 0.0003032 * t * t).to_radians());
    let mean_anomaly =
        normalize_radians((357.52911 + 35999.05029 * t - 0.0001537 * t * t).to_radians());
    let eccentricity = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t;
    let equation_of_center = ((1.914602 - 0.004817 * t - 0.000014 * t * t) * mean_anomaly.sin()
        + (0.019993 - 0.000101 * t) * (2.0 * mean_anomaly).sin()
        + 0.000289 * (3.0 * mean_anomaly).sin())
    .to_radians();
    let true_longitude = mean_longitude + equation_of_center;
    let true_anomaly = mean_anomaly + equation_of_center;
    let radius = 1.000001018 * (1.0 - eccentricity * eccentricity)
        / (1.0 + eccentricity * true_anomaly.cos());
    let omega = (125.04 - 1934.136 * t).to_radians();
    let apparent_longitude = normalize_radians(
        true_longitude - 0.00569_f64.to_radians() - 0.00478_f64.to_radians() * omega.sin(),
    );
    (apparent_longitude, 0.0, radius)
}
