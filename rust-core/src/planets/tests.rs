use std::f64::consts::{PI, TAU};

use super::*;

const J2000_EPOCH: f64 = 2_451_545.0;
const JAN_2024_EPOCH: f64 = 2_460_310.5;

/// A published place: the body, the instant, RA (h, m, s), Dec (°, ′, ″) and how
/// far off, in degrees, the low-precision ephemeris may be.
type Reference = (Body, f64, (u32, u32, u32), (i32, u32, u32), f64);

// Source for all expected coordinates below:
// TheSkyLive J2000 coordinate panel for each object page,
// queried at the exact UTC dates embedded in each row.
//
// Meeus Ch. 47 truncated lunar terms are significantly better than degree-level,
// but our UT-based low-precision implementation is still compared against a live
// web almanac reference and can drift by several tenths of a degree, so Moon is
// validated with a slightly looser 0.8° bound.
#[rustfmt::skip]
const REFERENCES: [Reference; 18] = [
    (Body::Sun, J2000_EPOCH, (18, 45, 8), (-23, 2, 8), 0.5),
    (Body::Sun, JAN_2024_EPOCH, (18, 42, 14), (-23, 3, 24), 0.5),
    (Body::Mercury, J2000_EPOCH, (18, 8, 19), (-24, 25, 18), 1.0),
    (Body::Mercury, JAN_2024_EPOCH, (17, 25, 45), (-20, 9, 12), 1.0),
    (Body::Venus, J2000_EPOCH, (15, 59, 35), (-18, 27, 12), 1.0),
    (Body::Venus, JAN_2024_EPOCH, (16, 2, 26), (-18, 46, 10), 1.0),
    (Body::Moon, J2000_EPOCH, (14, 47, 52), (-11, 39, 22), 0.8),
    (Body::Moon, JAN_2024_EPOCH, (10, 37, 10), (12, 0, 2), 0.8),
    (Body::Mars, J2000_EPOCH, (22, 2, 5), (-13, 10, 53), 1.0),
    (Body::Mars, JAN_2024_EPOCH, (17, 46, 46), (-23, 57, 34), 1.0),
    (Body::Jupiter, J2000_EPOCH, (1, 35, 28), (8, 35, 43), 0.5),
    (Body::Jupiter, JAN_2024_EPOCH, (2, 13, 25), (12, 15, 43), 0.5),
    (Body::Saturn, J2000_EPOCH, (2, 35, 3), (12, 36, 56), 0.5),
    (Body::Saturn, JAN_2024_EPOCH, (22, 21, 50), (-11, 50, 10), 0.5),
    (Body::Uranus, J2000_EPOCH, (21, 9, 56), (-17, 1, 7), 0.5),
    (Body::Uranus, JAN_2024_EPOCH, (3, 6, 42), (17, 16, 36), 0.5),
    (Body::Neptune, J2000_EPOCH, (20, 21, 45), (-19, 12, 44), 0.5),
    (Body::Neptune, JAN_2024_EPOCH, (23, 42, 38), (-3, 5, 26), 0.5),
];

#[test]
fn reference_positions_match_published_values() {
    for (body, jd, expected_ra_hms, expected_dec_dms, tolerance_deg) in REFERENCES {
        let pos = body.position(jd);
        let expected_ra = hms_to_radians(expected_ra_hms.0, expected_ra_hms.1, expected_ra_hms.2);
        let expected_dec =
            dms_to_radians(expected_dec_dms.0, expected_dec_dms.1, expected_dec_dms.2);

        let ra_error = circular_degrees_difference(pos.ra_radians, expected_ra);
        let dec_error = (pos.dec_radians - expected_dec).abs().to_degrees();

        println!(
            "{body:?} JD {jd}: ra_error={ra_error:.3} dec_error={dec_error:.3} mag={:.2}",
            pos.magnitude
        );

        assert!(
            ra_error <= tolerance_deg,
            "{body:?} JD {jd}: RA error {ra_error:.3}° exceeds {tolerance_deg}°"
        );
        assert!(
            dec_error <= tolerance_deg,
            "{body:?} JD {jd}: Dec error {dec_error:.3}° exceeds {tolerance_deg}°"
        );
        assert!((pos.magnitude - body.mean_magnitude()).abs() <= 0.5);
        assert!((norm(pos.unit_vector) - 1.0).abs() <= 1e-9);
    }
}

#[test]
fn all_positions_return_nine_unit_vectors() {
    let positions = all_positions(JAN_2024_EPOCH);
    assert_eq!(positions.len(), 9);

    for pos in positions {
        let norm = norm(pos.unit_vector);
        assert!((norm - 1.0).abs() <= 1e-9, "{:?} norm={norm}", pos.body);
    }
}

#[test]
fn earth_position_is_geocentric_placeholder() {
    let earth = Body::Earth.position(J2000_EPOCH);
    assert_eq!(earth.body, Body::Earth);
    assert_eq!(earth.unit_vector, [0.0, 0.0, 0.0]);
    assert_eq!(earth.ra_radians, 0.0);
    assert_eq!(earth.dec_radians, 0.0);
}

fn norm(vector: [f64; 3]) -> f64 {
    (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt()
}

fn hms_to_radians(hours: u32, minutes: u32, seconds: u32) -> f64 {
    (f64::from(hours) + f64::from(minutes) / 60.0 + f64::from(seconds) / 3600.0) * PI / 12.0
}

fn dms_to_radians(degrees: i32, minutes: u32, seconds: u32) -> f64 {
    let sign = if degrees < 0 { -1.0 } else { 1.0 };
    sign * (f64::from(degrees.abs()) + f64::from(minutes) / 60.0 + f64::from(seconds) / 3600.0) * PI
        / 180.0
}

fn circular_degrees_difference(left: f64, right: f64) -> f64 {
    let delta = (left - right + PI).rem_euclid(TAU) - PI;
    delta.abs().to_degrees()
}
