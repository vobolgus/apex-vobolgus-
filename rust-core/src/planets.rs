#![allow(clippy::excessive_precision)]

use std::f64::consts::{PI, TAU};

const J2000: f64 = 2_451_545.0;
const JULIAN_CENTURY_DAYS: f64 = 36_525.0;
const J2000_OBLIQUITY_RADIANS: f64 = 23.439_291_111_f64.to_radians();

const SUN_MAGNITUDE: f64 = -26.7;
const MERCURY_MAGNITUDE: f64 = -0.42;
const VENUS_MAGNITUDE: f64 = -4.6;
const MOON_MAGNITUDE: f64 = -12.74;
const MARS_MAGNITUDE: f64 = -1.6;
const JUPITER_MAGNITUDE: f64 = -2.94;
const SATURN_MAGNITUDE: f64 = 0.46;
const URANUS_MAGNITUDE: f64 = 5.32;
const NEPTUNE_MAGNITUDE: f64 = 7.78;

/// Solar-system body identifiers supported by the low-precision ephemeris.
///
/// Formulas follow Jean Meeus, *Astronomical Algorithms* (2nd ed.):
/// - Chapter 25 for the Sun,
/// - Chapter 31 low-precision Keplerian elements for planets,
/// - Chapter 47 truncated lunar series for the Moon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Body {
    Sun,
    Mercury,
    Venus,
    /// Earth is included for completeness, but `position(Body::Earth, ..)` is a
    /// geocentric placeholder with a zero vector because the observer is located
    /// at the Earth's center in this module.
    Earth,
    Moon,
    Mars,
    Jupiter,
    Saturn,
    Uranus,
    Neptune,
}

/// Low-precision geocentric equatorial coordinates for a solar-system body.
///
/// Right ascension and declination are returned in radians on the J2000 mean
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
    /// Unit Cartesian direction vector on the J2000 mean equator/equinox.
    pub unit_vector: [f64; 3],
    /// Mean visual magnitude constant for the body.
    pub magnitude: f64,
}

#[derive(Clone, Copy)]
struct PlanetCoefficients {
    a_au: f64,
    a_rate_au: f64,
    e: f64,
    e_rate: f64,
    i_deg: f64,
    i_rate_arcsec: f64,
    l_deg: f64,
    l_rate_arcsec: f64,
    long_peri_deg: f64,
    long_peri_rate_arcsec: f64,
    long_node_deg: f64,
    long_node_rate_arcsec: f64,
}

#[derive(Clone, Copy)]
struct MoonLongitudeTerm {
    d: i8,
    m: i8,
    m_prime: i8,
    f: i8,
    longitude: i32,
    radius: i32,
}

#[derive(Clone, Copy)]
struct MoonLatitudeTerm {
    d: i8,
    m: i8,
    m_prime: i8,
    f: i8,
    latitude: i32,
}

// Meeus, Astronomical Algorithms 2nd ed., Ch. 31 low-precision planetary elements
// referred to the mean ecliptic/equinox of J2000.0, with linear rates per century.
const MERCURY: PlanetCoefficients = PlanetCoefficients {
    a_au: 0.38709893,
    a_rate_au: 0.00000066,
    e: 0.20563069,
    e_rate: 0.00002527,
    i_deg: 7.00487,
    i_rate_arcsec: -23.51,
    l_deg: 252.25084,
    l_rate_arcsec: 538101628.29,
    long_peri_deg: 77.45645,
    long_peri_rate_arcsec: 573.57,
    long_node_deg: 48.33167,
    long_node_rate_arcsec: -446.30,
};

const VENUS: PlanetCoefficients = PlanetCoefficients {
    a_au: 0.72333199,
    a_rate_au: 0.00000092,
    e: 0.00677323,
    e_rate: -0.00004938,
    i_deg: 3.39471,
    i_rate_arcsec: -2.86,
    l_deg: 181.97973,
    l_rate_arcsec: 210664136.06,
    long_peri_deg: 131.53298,
    long_peri_rate_arcsec: -108.80,
    long_node_deg: 76.68069,
    long_node_rate_arcsec: -996.89,
};

const EARTH: PlanetCoefficients = PlanetCoefficients {
    a_au: 1.00000011,
    a_rate_au: -0.00000005,
    e: 0.01671022,
    e_rate: -0.00003804,
    i_deg: 0.00005,
    i_rate_arcsec: -46.94,
    l_deg: 100.46435,
    l_rate_arcsec: 129597740.63,
    long_peri_deg: 102.94719,
    long_peri_rate_arcsec: 1198.28,
    long_node_deg: -11.26064,
    long_node_rate_arcsec: -18228.25,
};

const MARS: PlanetCoefficients = PlanetCoefficients {
    a_au: 1.52366231,
    a_rate_au: -0.00007221,
    e: 0.09341233,
    e_rate: 0.00011902,
    i_deg: 1.85061,
    i_rate_arcsec: -25.47,
    l_deg: 355.45332,
    l_rate_arcsec: 68905103.78,
    long_peri_deg: 336.04084,
    long_peri_rate_arcsec: 1560.78,
    long_node_deg: 49.57854,
    long_node_rate_arcsec: -1020.19,
};

const JUPITER: PlanetCoefficients = PlanetCoefficients {
    a_au: 5.20336301,
    a_rate_au: 0.00060737,
    e: 0.04839266,
    e_rate: -0.00012880,
    i_deg: 1.30530,
    i_rate_arcsec: -4.15,
    l_deg: 34.40438,
    l_rate_arcsec: 10925078.35,
    long_peri_deg: 14.75385,
    long_peri_rate_arcsec: 839.93,
    long_node_deg: 100.55615,
    long_node_rate_arcsec: 1217.17,
};

const SATURN: PlanetCoefficients = PlanetCoefficients {
    a_au: 9.53707032,
    a_rate_au: -0.00301530,
    e: 0.05415060,
    e_rate: -0.00036762,
    i_deg: 2.48446,
    i_rate_arcsec: 6.11,
    l_deg: 49.94432,
    l_rate_arcsec: 4401052.95,
    long_peri_deg: 92.43194,
    long_peri_rate_arcsec: -1948.89,
    long_node_deg: 113.71504,
    long_node_rate_arcsec: -1591.05,
};

const URANUS: PlanetCoefficients = PlanetCoefficients {
    a_au: 19.19126393,
    a_rate_au: 0.00152025,
    e: 0.04716771,
    e_rate: -0.00019150,
    i_deg: 0.76986,
    i_rate_arcsec: -2.09,
    l_deg: 313.23218,
    l_rate_arcsec: 1542547.79,
    long_peri_deg: 170.96424,
    long_peri_rate_arcsec: 1312.56,
    long_node_deg: 74.22988,
    long_node_rate_arcsec: -1681.40,
};

const NEPTUNE: PlanetCoefficients = PlanetCoefficients {
    a_au: 30.06896348,
    a_rate_au: -0.00125196,
    e: 0.00858587,
    e_rate: 0.00002510,
    i_deg: 1.76917,
    i_rate_arcsec: -3.64,
    l_deg: 304.88003,
    l_rate_arcsec: 786449.21,
    long_peri_deg: 44.97135,
    long_peri_rate_arcsec: -844.43,
    long_node_deg: 131.72169,
    long_node_rate_arcsec: -151.25,
};

// Meeus, Astronomical Algorithms 2nd ed., Ch. 47, Tables 47.A and 47.B.
const MOON_LONGITUDE_TERMS: [MoonLongitudeTerm; 60] = [
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 1,
        f: 0,
        longitude: 6_288_774,
        radius: -20_905_355,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: -1,
        f: 0,
        longitude: 1_274_027,
        radius: -3_699_111,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: 0,
        f: 0,
        longitude: 658_314,
        radius: -2_955_968,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 2,
        f: 0,
        longitude: 213_618,
        radius: -569_925,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 1,
        m_prime: 0,
        f: 0,
        longitude: -185_116,
        radius: 48_888,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 0,
        f: 2,
        longitude: -114_332,
        radius: -3_149,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: -2,
        f: 0,
        longitude: 58_793,
        radius: 246_158,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -1,
        m_prime: -1,
        f: 0,
        longitude: 57_066,
        radius: -152_138,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: 1,
        f: 0,
        longitude: 53_322,
        radius: -170_733,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -1,
        m_prime: 0,
        f: 0,
        longitude: 45_758,
        radius: -204_586,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 1,
        m_prime: -1,
        f: 0,
        longitude: -40_923,
        radius: -129_620,
    },
    MoonLongitudeTerm {
        d: 1,
        m: 0,
        m_prime: 0,
        f: 0,
        longitude: -34_720,
        radius: 108_743,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 1,
        m_prime: 1,
        f: 0,
        longitude: -30_383,
        radius: 104_755,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: 0,
        f: -2,
        longitude: 15_327,
        radius: 10_321,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 1,
        f: 2,
        longitude: -12_528,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 1,
        f: -2,
        longitude: 10_980,
        radius: 79_661,
    },
    MoonLongitudeTerm {
        d: 4,
        m: 0,
        m_prime: -1,
        f: 0,
        longitude: 10_675,
        radius: -34_782,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 3,
        f: 0,
        longitude: 10_034,
        radius: -23_210,
    },
    MoonLongitudeTerm {
        d: 4,
        m: 0,
        m_prime: -2,
        f: 0,
        longitude: 8_548,
        radius: -21_636,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 1,
        m_prime: -1,
        f: 0,
        longitude: -7_888,
        radius: 24_208,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 1,
        m_prime: 0,
        f: 0,
        longitude: -6_766,
        radius: 30_824,
    },
    MoonLongitudeTerm {
        d: 1,
        m: 0,
        m_prime: -1,
        f: 0,
        longitude: -5_163,
        radius: -8_379,
    },
    MoonLongitudeTerm {
        d: 1,
        m: 1,
        m_prime: 0,
        f: 0,
        longitude: 4_987,
        radius: -16_675,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -1,
        m_prime: 1,
        f: 0,
        longitude: 4_036,
        radius: -12_831,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: 2,
        f: 0,
        longitude: 3_994,
        radius: -10_445,
    },
    MoonLongitudeTerm {
        d: 4,
        m: 0,
        m_prime: 0,
        f: 0,
        longitude: 3_861,
        radius: -11_650,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: -3,
        f: 0,
        longitude: 3_665,
        radius: 14_403,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 1,
        m_prime: -2,
        f: 0,
        longitude: -2_689,
        radius: -7_003,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: -1,
        f: 2,
        longitude: -2_602,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -1,
        m_prime: -2,
        f: 0,
        longitude: 2_390,
        radius: 10_056,
    },
    MoonLongitudeTerm {
        d: 1,
        m: 0,
        m_prime: 1,
        f: 0,
        longitude: -2_348,
        radius: 6_322,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -2,
        m_prime: 0,
        f: 0,
        longitude: 2_236,
        radius: -9_884,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 1,
        m_prime: 2,
        f: 0,
        longitude: -2_120,
        radius: 5_751,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 2,
        m_prime: 0,
        f: 0,
        longitude: -2_069,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -2,
        m_prime: -1,
        f: 0,
        longitude: 2_048,
        radius: -4_950,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: 1,
        f: -2,
        longitude: -1_773,
        radius: 4_130,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: 0,
        f: 2,
        longitude: -1_595,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 4,
        m: -1,
        m_prime: -1,
        f: 0,
        longitude: 1_215,
        radius: -3_958,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 2,
        f: 2,
        longitude: -1_110,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 3,
        m: 0,
        m_prime: -1,
        f: 0,
        longitude: -892,
        radius: 3_258,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 1,
        m_prime: 1,
        f: 0,
        longitude: -810,
        radius: 2_616,
    },
    MoonLongitudeTerm {
        d: 4,
        m: -1,
        m_prime: -2,
        f: 0,
        longitude: 759,
        radius: -1_897,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 2,
        m_prime: -1,
        f: 0,
        longitude: -713,
        radius: -2_117,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 2,
        m_prime: -1,
        f: 0,
        longitude: -700,
        radius: 2_354,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 1,
        m_prime: -2,
        f: 0,
        longitude: 691,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -1,
        m_prime: 0,
        f: -2,
        longitude: 596,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 4,
        m: 0,
        m_prime: 1,
        f: 0,
        longitude: 549,
        radius: -1_423,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 4,
        f: 0,
        longitude: 537,
        radius: -1_117,
    },
    MoonLongitudeTerm {
        d: 4,
        m: -1,
        m_prime: 0,
        f: 0,
        longitude: 520,
        radius: -1_571,
    },
    MoonLongitudeTerm {
        d: 1,
        m: 0,
        m_prime: -2,
        f: 0,
        longitude: -487,
        radius: -1_739,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 1,
        m_prime: 0,
        f: -2,
        longitude: -399,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 0,
        m_prime: 2,
        f: -2,
        longitude: -381,
        radius: -4_421,
    },
    MoonLongitudeTerm {
        d: 1,
        m: 1,
        m_prime: 1,
        f: 0,
        longitude: 351,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 3,
        m: 0,
        m_prime: -2,
        f: 0,
        longitude: -340,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 4,
        m: 0,
        m_prime: -3,
        f: 0,
        longitude: 330,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 2,
        m: -1,
        m_prime: 2,
        f: 0,
        longitude: 327,
        radius: 1_165,
    },
    MoonLongitudeTerm {
        d: 0,
        m: 2,
        m_prime: 1,
        f: 0,
        longitude: -323,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 1,
        m: 1,
        m_prime: -1,
        f: 0,
        longitude: 299,
        radius: 0,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: 3,
        f: 0,
        longitude: 294,
        radius: 8_752,
    },
    MoonLongitudeTerm {
        d: 2,
        m: 0,
        m_prime: -1,
        f: -2,
        longitude: 0,
        radius: 0,
    },
];

const MOON_LATITUDE_TERMS: [MoonLatitudeTerm; 60] = [
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 0,
        f: 1,
        latitude: 5_128_122,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 1,
        f: 1,
        latitude: 280_602,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 1,
        f: -1,
        latitude: 277_693,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: 0,
        f: -1,
        latitude: 173_237,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: -1,
        f: 1,
        latitude: 55_413,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: -1,
        f: -1,
        latitude: 46_271,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: 0,
        f: 1,
        latitude: 32_573,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 2,
        f: 1,
        latitude: 17_198,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: 1,
        f: -1,
        latitude: 9_266,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 2,
        f: -1,
        latitude: 8_822,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -1,
        m_prime: 0,
        f: -1,
        latitude: 8_216,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: -2,
        f: -1,
        latitude: 4_324,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: 1,
        f: 1,
        latitude: 4_200,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 1,
        m_prime: 0,
        f: -1,
        latitude: -3_359,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -1,
        m_prime: -1,
        f: 1,
        latitude: 2_463,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -1,
        m_prime: 0,
        f: 1,
        latitude: 2_211,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -1,
        m_prime: -1,
        f: -1,
        latitude: 2_065,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: -1,
        f: -1,
        latitude: -1_870,
    },
    MoonLatitudeTerm {
        d: 4,
        m: 0,
        m_prime: -1,
        f: -1,
        latitude: 1_828,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: 0,
        f: 1,
        latitude: -1_794,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 0,
        f: 3,
        latitude: -1_749,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: -1,
        f: 1,
        latitude: -1_565,
    },
    MoonLatitudeTerm {
        d: 1,
        m: 0,
        m_prime: 0,
        f: 1,
        latitude: -1_491,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: 1,
        f: 1,
        latitude: -1_475,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: 1,
        f: -1,
        latitude: -1_410,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: 0,
        f: -1,
        latitude: -1_344,
    },
    MoonLatitudeTerm {
        d: 1,
        m: 0,
        m_prime: 0,
        f: -1,
        latitude: -1_335,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 3,
        f: 1,
        latitude: 1_107,
    },
    MoonLatitudeTerm {
        d: 4,
        m: 0,
        m_prime: 0,
        f: -1,
        latitude: 1_021,
    },
    MoonLatitudeTerm {
        d: 4,
        m: 0,
        m_prime: -1,
        f: 1,
        latitude: 833,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 1,
        f: -3,
        latitude: 777,
    },
    MoonLatitudeTerm {
        d: 4,
        m: 0,
        m_prime: -2,
        f: 1,
        latitude: 671,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: 0,
        f: -3,
        latitude: 607,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: 2,
        f: -1,
        latitude: 596,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -1,
        m_prime: 1,
        f: -1,
        latitude: 491,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: -2,
        f: 1,
        latitude: -451,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 3,
        f: -1,
        latitude: 439,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: 2,
        f: 1,
        latitude: 422,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 0,
        m_prime: -3,
        f: -1,
        latitude: 421,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 1,
        m_prime: -1,
        f: 1,
        latitude: -366,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 1,
        m_prime: 0,
        f: 1,
        latitude: -351,
    },
    MoonLatitudeTerm {
        d: 4,
        m: 0,
        m_prime: 0,
        f: 1,
        latitude: 331,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -1,
        m_prime: 1,
        f: 1,
        latitude: 315,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -2,
        m_prime: 0,
        f: -1,
        latitude: 302,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 0,
        m_prime: 1,
        f: 3,
        latitude: -283,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 1,
        m_prime: 1,
        f: -1,
        latitude: -229,
    },
    MoonLatitudeTerm {
        d: 1,
        m: 1,
        m_prime: 0,
        f: -1,
        latitude: 223,
    },
    MoonLatitudeTerm {
        d: 1,
        m: 1,
        m_prime: 0,
        f: 1,
        latitude: 223,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: -2,
        f: -1,
        latitude: -220,
    },
    MoonLatitudeTerm {
        d: 2,
        m: 1,
        m_prime: -1,
        f: -1,
        latitude: -220,
    },
    MoonLatitudeTerm {
        d: 1,
        m: 0,
        m_prime: 1,
        f: 1,
        latitude: -185,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -1,
        m_prime: -2,
        f: -1,
        latitude: 181,
    },
    MoonLatitudeTerm {
        d: 0,
        m: 1,
        m_prime: 2,
        f: 1,
        latitude: -177,
    },
    MoonLatitudeTerm {
        d: 4,
        m: 0,
        m_prime: -2,
        f: -1,
        latitude: 176,
    },
    MoonLatitudeTerm {
        d: 4,
        m: -1,
        m_prime: -1,
        f: -1,
        latitude: 166,
    },
    MoonLatitudeTerm {
        d: 1,
        m: 0,
        m_prime: 1,
        f: -1,
        latitude: -164,
    },
    MoonLatitudeTerm {
        d: 4,
        m: 0,
        m_prime: 1,
        f: -1,
        latitude: 132,
    },
    MoonLatitudeTerm {
        d: 1,
        m: 0,
        m_prime: -1,
        f: -1,
        latitude: -119,
    },
    MoonLatitudeTerm {
        d: 4,
        m: -1,
        m_prime: 0,
        f: -1,
        latitude: 115,
    },
    MoonLatitudeTerm {
        d: 2,
        m: -2,
        m_prime: 0,
        f: 1,
        latitude: 107,
    },
];

/// Compute the geocentric position of a body for a Julian Date in UT.
///
/// The implementation is intentionally low precision: Sun from Meeus Ch. 25,
/// planets from unperturbed Keplerian elements in Ch. 31, Moon from the main
/// periodic terms in Ch. 47. This is suitable for star-map placement at about
/// degree-level accuracy, not for precise almanac work.
#[must_use]
pub fn position(body: Body, jd_ut: f64) -> PlanetPosition {
    match body {
        Body::Earth => PlanetPosition {
            body,
            ra_radians: 0.0,
            dec_radians: 0.0,
            unit_vector: [0.0, 0.0, 0.0],
            magnitude: 0.0,
        },
        Body::Sun => {
            let (lambda, beta, _distance) = sun_geocentric_ecliptic(jd_ut);
            make_position(
                body,
                ecliptic_spherical_to_equatorial_unit(lambda, beta),
                SUN_MAGNITUDE,
            )
        }
        Body::Moon => {
            let (lambda, beta, _distance_km) = moon_geocentric_ecliptic(jd_ut);
            make_position(
                body,
                ecliptic_spherical_to_equatorial_unit(lambda, beta),
                MOON_MAGNITUDE,
            )
        }
        _ => {
            let earth = heliocentric_ecliptic_vector(EARTH, jd_ut);
            let planet = heliocentric_ecliptic_vector(coefficients(body), jd_ut);
            let geocentric_ecliptic = [
                planet[0] - earth[0],
                planet[1] - earth[1],
                planet[2] - earth[2],
            ];
            make_position(
                body,
                ecliptic_vector_to_equatorial_unit(geocentric_ecliptic),
                mean_magnitude(body),
            )
        }
    }
}

/// Compute the default batch of solar-system bodies used by star-map rendering.
///
/// The returned vector contains 9 geocentric bodies in this order: Sun,
/// Mercury, Venus, Moon, Mars, Jupiter, Saturn, Uranus, Neptune. Earth is
/// intentionally excluded because geocentric Earth coordinates are degenerate.
#[must_use]
pub fn all_positions(jd_ut: f64) -> Vec<PlanetPosition> {
    let bodies = [
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

    bodies
        .into_iter()
        .map(|body| position(body, jd_ut))
        .collect()
}

/// Suggested fallback display color for a body as an `(r, g, b)` tuple.
///
/// These colors are simple astronomy-oriented defaults for downstream renderers.
/// They are intentionally not treated as authoritative UI design values.
#[must_use]
pub fn body_color(body: Body) -> (u8, u8, u8) {
    match body {
        Body::Sun => (255, 214, 102),
        Body::Mercury => (180, 180, 170),
        Body::Venus => (244, 230, 190),
        Body::Earth => (100, 149, 237),
        Body::Moon => (214, 214, 214),
        Body::Mars => (219, 98, 71),
        Body::Jupiter => (216, 180, 140),
        Body::Saturn => (210, 195, 142),
        Body::Uranus => (142, 212, 220),
        Body::Neptune => (92, 126, 220),
    }
}

fn coefficients(body: Body) -> PlanetCoefficients {
    match body {
        Body::Mercury => MERCURY,
        Body::Venus => VENUS,
        Body::Earth => EARTH,
        Body::Mars => MARS,
        Body::Jupiter => JUPITER,
        Body::Saturn => SATURN,
        Body::Uranus => URANUS,
        Body::Neptune => NEPTUNE,
        Body::Sun | Body::Moon => unreachable!("Sun and Moon do not use Kepler element table"),
    }
}

fn mean_magnitude(body: Body) -> f64 {
    match body {
        Body::Sun => SUN_MAGNITUDE,
        Body::Mercury => MERCURY_MAGNITUDE,
        Body::Venus => VENUS_MAGNITUDE,
        Body::Earth => 0.0,
        Body::Moon => MOON_MAGNITUDE,
        Body::Mars => MARS_MAGNITUDE,
        Body::Jupiter => JUPITER_MAGNITUDE,
        Body::Saturn => SATURN_MAGNITUDE,
        Body::Uranus => URANUS_MAGNITUDE,
        Body::Neptune => NEPTUNE_MAGNITUDE,
    }
}

fn make_position(body: Body, unit_vector: [f64; 3], magnitude: f64) -> PlanetPosition {
    let ra = unit_vector[1].atan2(unit_vector[0]).rem_euclid(TAU);
    let dec = unit_vector[2]
        .atan2((unit_vector[0] * unit_vector[0] + unit_vector[1] * unit_vector[1]).sqrt());
    PlanetPosition {
        body,
        ra_radians: ra,
        dec_radians: dec,
        unit_vector,
        magnitude,
    }
}

fn heliocentric_ecliptic_vector(coeffs: PlanetCoefficients, jd: f64) -> [f64; 3] {
    let t = julian_centuries(jd);
    let a = coeffs.a_au + coeffs.a_rate_au * t;
    let e = coeffs.e + coeffs.e_rate * t;
    let i = (coeffs.i_deg + coeffs.i_rate_arcsec * t / 3600.0).to_radians();
    let l = (coeffs.l_deg + coeffs.l_rate_arcsec * t / 3600.0).to_radians();
    let long_peri = (coeffs.long_peri_deg + coeffs.long_peri_rate_arcsec * t / 3600.0).to_radians();
    let long_node = (coeffs.long_node_deg + coeffs.long_node_rate_arcsec * t / 3600.0).to_radians();

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

fn sun_geocentric_ecliptic(jd: f64) -> (f64, f64, f64) {
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

fn moon_geocentric_ecliptic(jd: f64) -> (f64, f64, f64) {
    let t = julian_centuries(jd);
    let t2 = t * t;
    let t3 = t2 * t;
    let t4 = t3 * t;

    let l_prime = normalize_radians(
        (218.3164477 + 481267.88123421 * t - 0.0015786 * t2 + t3 / 538841.0 - t4 / 65194000.0)
            .to_radians(),
    );
    let d = normalize_radians(
        (297.8501921 + 445267.1114034 * t - 0.0018819 * t2 + t3 / 545868.0 - t4 / 113065000.0)
            .to_radians(),
    );
    let m = normalize_radians(
        (357.5291092 + 35999.0502909 * t - 0.0001536 * t2 + t3 / 24490000.0).to_radians(),
    );
    let m_prime = normalize_radians(
        (134.9633964 + 477198.8675055 * t + 0.0087414 * t2 + t3 / 69699.0 - t4 / 14712000.0)
            .to_radians(),
    );
    let f = normalize_radians(
        (93.2720950 + 483202.0175233 * t - 0.0036539 * t2 - t3 / 3526000.0 + t4 / 863310000.0)
            .to_radians(),
    );

    let a1 = (119.75 + 131.849 * t).to_radians();
    let a2 = (53.09 + 479264.290 * t).to_radians();
    let a3 = (313.45 + 481266.484 * t).to_radians();
    let e = 1.0 - 0.002516 * t - 0.0000074 * t2;
    let e2 = e * e;

    let mut sigma_l = 0.0;
    let mut sigma_r = 0.0;
    for term in MOON_LONGITUDE_TERMS {
        let e_factor = match term.m.unsigned_abs() {
            1 => e,
            2 => e2,
            _ => 1.0,
        };
        let argument = f64::from(term.d) * d
            + f64::from(term.m) * m
            + f64::from(term.m_prime) * m_prime
            + f64::from(term.f) * f;
        sigma_l += f64::from(term.longitude) * e_factor * argument.sin();
        sigma_r += f64::from(term.radius) * e_factor * argument.cos();
    }

    let mut sigma_b = 0.0;
    for term in MOON_LATITUDE_TERMS {
        let e_factor = match term.m.unsigned_abs() {
            1 => e,
            2 => e2,
            _ => 1.0,
        };
        let argument = f64::from(term.d) * d
            + f64::from(term.m) * m
            + f64::from(term.m_prime) * m_prime
            + f64::from(term.f) * f;
        sigma_b += f64::from(term.latitude) * e_factor * argument.sin();
    }

    sigma_l += 3958.0 * a1.sin() + 1962.0 * (l_prime - f).sin() + 318.0 * a2.sin();
    sigma_b += -2235.0 * l_prime.sin()
        + 382.0 * a3.sin()
        + 175.0 * (a1 - f).sin()
        + 175.0 * (a1 + f).sin()
        + 127.0 * (l_prime - m_prime).sin()
        - 115.0 * (l_prime + m_prime).sin();

    let longitude = normalize_radians(l_prime + (sigma_l / 1_000_000.0).to_radians());
    let latitude = (sigma_b / 1_000_000.0).to_radians();
    let distance_km = 385000.56 + sigma_r / 1000.0;
    (longitude, latitude, distance_km)
}

fn ecliptic_spherical_to_equatorial_unit(lambda: f64, beta: f64) -> [f64; 3] {
    let cos_beta = beta.cos();
    let ecliptic = [cos_beta * lambda.cos(), cos_beta * lambda.sin(), beta.sin()];
    ecliptic_vector_to_equatorial_unit(ecliptic)
}

fn ecliptic_vector_to_equatorial_unit(vector: [f64; 3]) -> [f64; 3] {
    let equatorial = [
        vector[0],
        vector[1] * J2000_OBLIQUITY_RADIANS.cos() - vector[2] * J2000_OBLIQUITY_RADIANS.sin(),
        vector[1] * J2000_OBLIQUITY_RADIANS.sin() + vector[2] * J2000_OBLIQUITY_RADIANS.cos(),
    ];
    normalize_vector(equatorial)
}

fn normalize_vector(vector: [f64; 3]) -> [f64; 3] {
    let norm = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    [vector[0] / norm, vector[1] / norm, vector[2] / norm]
}

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

fn julian_centuries(jd: f64) -> f64 {
    (jd - J2000) / JULIAN_CENTURY_DAYS
}

fn normalize_radians(angle: f64) -> f64 {
    angle.rem_euclid(TAU)
}

#[cfg(test)]
mod tests {
    use super::*;

    const J2000_EPOCH: f64 = 2_451_545.0;
    const JAN_2024_EPOCH: f64 = 2_460_310.5;

    #[test]
    fn reference_positions_match_published_values() {
        // Source for all expected coordinates below:
        // TheSkyLive J2000 coordinate panel for each object page,
        // queried at the exact UTC dates embedded in each helper call.

        assert_reference(
            Body::Sun,
            J2000_EPOCH,
            (18, 45, 8),
            (-23, 2, 8),
            0.5,
            SUN_MAGNITUDE,
        );
        assert_reference(
            Body::Sun,
            JAN_2024_EPOCH,
            (18, 42, 14),
            (-23, 3, 24),
            0.5,
            SUN_MAGNITUDE,
        );

        assert_reference(
            Body::Mercury,
            J2000_EPOCH,
            (18, 8, 19),
            (-24, 25, 18),
            1.0,
            MERCURY_MAGNITUDE,
        );
        assert_reference(
            Body::Mercury,
            JAN_2024_EPOCH,
            (17, 25, 45),
            (-20, 9, 12),
            1.0,
            MERCURY_MAGNITUDE,
        );

        assert_reference(
            Body::Venus,
            J2000_EPOCH,
            (15, 59, 35),
            (-18, 27, 12),
            1.0,
            VENUS_MAGNITUDE,
        );
        assert_reference(
            Body::Venus,
            JAN_2024_EPOCH,
            (16, 2, 26),
            (-18, 46, 10),
            1.0,
            VENUS_MAGNITUDE,
        );

        // Meeus Ch. 47 truncated lunar terms are significantly better than degree-level,
        // but our UT-based low-precision implementation is still compared against a live
        // web almanac reference and can drift by several tenths of a degree, so Moon is
        // validated with a slightly looser 0.8° bound.
        assert_reference(
            Body::Moon,
            J2000_EPOCH,
            (14, 47, 52),
            (-11, 39, 22),
            0.8,
            MOON_MAGNITUDE,
        );
        assert_reference(
            Body::Moon,
            JAN_2024_EPOCH,
            (10, 37, 10),
            (12, 0, 2),
            0.8,
            MOON_MAGNITUDE,
        );

        assert_reference(
            Body::Mars,
            J2000_EPOCH,
            (22, 2, 5),
            (-13, 10, 53),
            1.0,
            MARS_MAGNITUDE,
        );
        assert_reference(
            Body::Mars,
            JAN_2024_EPOCH,
            (17, 46, 46),
            (-23, 57, 34),
            1.0,
            MARS_MAGNITUDE,
        );

        assert_reference(
            Body::Jupiter,
            J2000_EPOCH,
            (1, 35, 28),
            (8, 35, 43),
            0.5,
            JUPITER_MAGNITUDE,
        );
        assert_reference(
            Body::Jupiter,
            JAN_2024_EPOCH,
            (2, 13, 25),
            (12, 15, 43),
            0.5,
            JUPITER_MAGNITUDE,
        );

        assert_reference(
            Body::Saturn,
            J2000_EPOCH,
            (2, 35, 3),
            (12, 36, 56),
            0.5,
            SATURN_MAGNITUDE,
        );
        assert_reference(
            Body::Saturn,
            JAN_2024_EPOCH,
            (22, 21, 50),
            (-11, 50, 10),
            0.5,
            SATURN_MAGNITUDE,
        );

        assert_reference(
            Body::Uranus,
            J2000_EPOCH,
            (21, 9, 56),
            (-17, 1, 7),
            0.5,
            URANUS_MAGNITUDE,
        );
        assert_reference(
            Body::Uranus,
            JAN_2024_EPOCH,
            (3, 6, 42),
            (17, 16, 36),
            0.5,
            URANUS_MAGNITUDE,
        );

        assert_reference(
            Body::Neptune,
            J2000_EPOCH,
            (20, 21, 45),
            (-19, 12, 44),
            0.5,
            NEPTUNE_MAGNITUDE,
        );
        assert_reference(
            Body::Neptune,
            JAN_2024_EPOCH,
            (23, 42, 38),
            (-3, 5, 26),
            0.5,
            NEPTUNE_MAGNITUDE,
        );
    }

    #[test]
    fn all_positions_return_nine_unit_vectors() {
        let positions = all_positions(JAN_2024_EPOCH);
        assert_eq!(positions.len(), 9);

        for pos in positions {
            let norm = (pos.unit_vector[0] * pos.unit_vector[0]
                + pos.unit_vector[1] * pos.unit_vector[1]
                + pos.unit_vector[2] * pos.unit_vector[2])
                .sqrt();
            assert!((norm - 1.0).abs() <= 1e-9, "{:?} norm={norm}", pos.body);
        }
    }

    #[test]
    fn earth_position_is_geocentric_placeholder() {
        let earth = position(Body::Earth, J2000_EPOCH);
        assert_eq!(earth.body, Body::Earth);
        assert_eq!(earth.unit_vector, [0.0, 0.0, 0.0]);
        assert_eq!(earth.ra_radians, 0.0);
        assert_eq!(earth.dec_radians, 0.0);
    }

    fn assert_reference(
        body: Body,
        jd: f64,
        expected_ra_hms: (u32, u32, u32),
        expected_dec_dms: (i32, u32, u32),
        tolerance_deg: f64,
        expected_magnitude: f64,
    ) {
        let pos = position(body, jd);
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
        assert!((pos.magnitude - expected_magnitude).abs() <= 0.5);

        let norm = (pos.unit_vector[0] * pos.unit_vector[0]
            + pos.unit_vector[1] * pos.unit_vector[1]
            + pos.unit_vector[2] * pos.unit_vector[2])
            .sqrt();
        assert!((norm - 1.0).abs() <= 1e-9);
    }

    fn hms_to_radians(hours: u32, minutes: u32, seconds: u32) -> f64 {
        (f64::from(hours) + f64::from(minutes) / 60.0 + f64::from(seconds) / 3600.0) * PI / 12.0
    }

    fn dms_to_radians(degrees: i32, minutes: u32, seconds: u32) -> f64 {
        let sign = if degrees < 0 { -1.0 } else { 1.0 };
        sign * (f64::from(degrees.abs()) + f64::from(minutes) / 60.0 + f64::from(seconds) / 3600.0)
            * PI
            / 180.0
    }

    fn circular_degrees_difference(left: f64, right: f64) -> f64 {
        let delta = (left - right + PI).rem_euclid(TAU) - PI;
        delta.abs().to_degrees()
    }
}
