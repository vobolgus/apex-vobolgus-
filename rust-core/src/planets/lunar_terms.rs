//! The Moon's periodic terms: Meeus, *Astronomical Algorithms* (2nd ed.),
//! tables 47.A and 47.B, row for row as printed.
//!
//! A term's argument is `D·d + M·m + M′·m′ + F·f`, the multiples of the Moon's mean
//! elongation, the Sun's mean anomaly, the Moon's mean anomaly and its argument of
//! latitude; its coefficients are in units of 10⁻⁶ degree (longitude, latitude)
//! and 10⁻³ km (distance).

/// A row of table 47.A: a term of the Moon's longitude (sine) and distance (cosine).
pub(super) struct LongitudeTerm {
    pub(super) multiples: Multiples,
    /// Σl coefficient, 10⁻⁶ degree.
    pub(super) longitude: i32,
    /// Σr coefficient, 10⁻³ km.
    pub(super) distance: i32,
}

/// A row of table 47.B: a term of the Moon's latitude (sine).
pub(super) struct LatitudeTerm {
    pub(super) multiples: Multiples,
    /// Σb coefficient, 10⁻⁶ degree.
    pub(super) latitude: i32,
}

/// How many times D, M, M′ and F a term's argument takes.
pub(super) struct Multiples {
    pub(super) d: i8,
    pub(super) m: i8,
    pub(super) m_prime: i8,
    pub(super) f: i8,
}

const fn lon(d: i8, m: i8, m_prime: i8, f: i8, longitude: i32, distance: i32) -> LongitudeTerm {
    LongitudeTerm {
        multiples: Multiples { d, m, m_prime, f },
        longitude,
        distance,
    }
}

const fn lat(d: i8, m: i8, m_prime: i8, f: i8, latitude: i32) -> LatitudeTerm {
    LatitudeTerm {
        multiples: Multiples { d, m, m_prime, f },
        latitude,
    }
}

/// Table 47.A.
#[rustfmt::skip]
pub(super) const LONGITUDE_AND_DISTANCE: [LongitudeTerm; 60] = [
    //   D   M  M′   F          Σl            Σr
    lon( 0,  0,  1,  0,  6_288_774,  -20_905_355),
    lon( 2,  0, -1,  0,  1_274_027,   -3_699_111),
    lon( 2,  0,  0,  0,    658_314,   -2_955_968),
    lon( 0,  0,  2,  0,    213_618,     -569_925),
    lon( 0,  1,  0,  0,   -185_116,       48_888),
    lon( 0,  0,  0,  2,   -114_332,       -3_149),
    lon( 2,  0, -2,  0,     58_793,      246_158),
    lon( 2, -1, -1,  0,     57_066,     -152_138),
    lon( 2,  0,  1,  0,     53_322,     -170_733),
    lon( 2, -1,  0,  0,     45_758,     -204_586),
    lon( 0,  1, -1,  0,    -40_923,     -129_620),
    lon( 1,  0,  0,  0,    -34_720,      108_743),
    lon( 0,  1,  1,  0,    -30_383,      104_755),
    lon( 2,  0,  0, -2,     15_327,       10_321),
    lon( 0,  0,  1,  2,    -12_528,            0),
    lon( 0,  0,  1, -2,     10_980,       79_661),
    lon( 4,  0, -1,  0,     10_675,      -34_782),
    lon( 0,  0,  3,  0,     10_034,      -23_210),
    lon( 4,  0, -2,  0,      8_548,      -21_636),
    lon( 2,  1, -1,  0,     -7_888,       24_208),
    lon( 2,  1,  0,  0,     -6_766,       30_824),
    lon( 1,  0, -1,  0,     -5_163,       -8_379),
    lon( 1,  1,  0,  0,      4_987,      -16_675),
    lon( 2, -1,  1,  0,      4_036,      -12_831),
    lon( 2,  0,  2,  0,      3_994,      -10_445),
    lon( 4,  0,  0,  0,      3_861,      -11_650),
    lon( 2,  0, -3,  0,      3_665,       14_403),
    lon( 0,  1, -2,  0,     -2_689,       -7_003),
    lon( 2,  0, -1,  2,     -2_602,            0),
    lon( 2, -1, -2,  0,      2_390,       10_056),
    lon( 1,  0,  1,  0,     -2_348,        6_322),
    lon( 2, -2,  0,  0,      2_236,       -9_884),
    lon( 0,  1,  2,  0,     -2_120,        5_751),
    lon( 0,  2,  0,  0,     -2_069,            0),
    lon( 2, -2, -1,  0,      2_048,       -4_950),
    lon( 2,  0,  1, -2,     -1_773,        4_130),
    lon( 2,  0,  0,  2,     -1_595,            0),
    lon( 4, -1, -1,  0,      1_215,       -3_958),
    lon( 0,  0,  2,  2,     -1_110,            0),
    lon( 3,  0, -1,  0,       -892,        3_258),
    lon( 2,  1,  1,  0,       -810,        2_616),
    lon( 4, -1, -2,  0,        759,       -1_897),
    lon( 0,  2, -1,  0,       -713,       -2_117),
    lon( 2,  2, -1,  0,       -700,        2_354),
    lon( 2,  1, -2,  0,        691,            0),
    lon( 2, -1,  0, -2,        596,            0),
    lon( 4,  0,  1,  0,        549,       -1_423),
    lon( 0,  0,  4,  0,        537,       -1_117),
    lon( 4, -1,  0,  0,        520,       -1_571),
    lon( 1,  0, -2,  0,       -487,       -1_739),
    lon( 2,  1,  0, -2,       -399,            0),
    lon( 0,  0,  2, -2,       -381,       -4_421),
    lon( 1,  1,  1,  0,        351,            0),
    lon( 3,  0, -2,  0,       -340,            0),
    lon( 4,  0, -3,  0,        330,            0),
    lon( 2, -1,  2,  0,        327,        1_165),
    lon( 0,  2,  1,  0,       -323,            0),
    lon( 1,  1, -1,  0,        299,            0),
    lon( 2,  0,  3,  0,        294,        8_752),
    lon( 2,  0, -1, -2,          0,            0),
];

/// Table 47.B.
#[rustfmt::skip]
pub(super) const LATITUDE: [LatitudeTerm; 60] = [
    //   D   M  M′   F          Σb
    lat( 0,  0,  0,  1,  5_128_122),
    lat( 0,  0,  1,  1,    280_602),
    lat( 0,  0,  1, -1,    277_693),
    lat( 2,  0,  0, -1,    173_237),
    lat( 2,  0, -1,  1,     55_413),
    lat( 2,  0, -1, -1,     46_271),
    lat( 2,  0,  0,  1,     32_573),
    lat( 0,  0,  2,  1,     17_198),
    lat( 2,  0,  1, -1,      9_266),
    lat( 0,  0,  2, -1,      8_822),
    lat( 2, -1,  0, -1,      8_216),
    lat( 2,  0, -2, -1,      4_324),
    lat( 2,  0,  1,  1,      4_200),
    lat( 2,  1,  0, -1,     -3_359),
    lat( 2, -1, -1,  1,      2_463),
    lat( 2, -1,  0,  1,      2_211),
    lat( 2, -1, -1, -1,      2_065),
    lat( 0,  1, -1, -1,     -1_870),
    lat( 4,  0, -1, -1,      1_828),
    lat( 0,  1,  0,  1,     -1_794),
    lat( 0,  0,  0,  3,     -1_749),
    lat( 0,  1, -1,  1,     -1_565),
    lat( 1,  0,  0,  1,     -1_491),
    lat( 0,  1,  1,  1,     -1_475),
    lat( 0,  1,  1, -1,     -1_410),
    lat( 0,  1,  0, -1,     -1_344),
    lat( 1,  0,  0, -1,     -1_335),
    lat( 0,  0,  3,  1,      1_107),
    lat( 4,  0,  0, -1,      1_021),
    lat( 4,  0, -1,  1,        833),
    lat( 0,  0,  1, -3,        777),
    lat( 4,  0, -2,  1,        671),
    lat( 2,  0,  0, -3,        607),
    lat( 2,  0,  2, -1,        596),
    lat( 2, -1,  1, -1,        491),
    lat( 2,  0, -2,  1,       -451),
    lat( 0,  0,  3, -1,        439),
    lat( 2,  0,  2,  1,        422),
    lat( 2,  0, -3, -1,        421),
    lat( 2,  1, -1,  1,       -366),
    lat( 2,  1,  0,  1,       -351),
    lat( 4,  0,  0,  1,        331),
    lat( 2, -1,  1,  1,        315),
    lat( 2, -2,  0, -1,        302),
    lat( 0,  0,  1,  3,       -283),
    lat( 2,  1,  1, -1,       -229),
    lat( 1,  1,  0, -1,        223),
    lat( 1,  1,  0,  1,        223),
    lat( 0,  1, -2, -1,       -220),
    lat( 2,  1, -1, -1,       -220),
    lat( 1,  0,  1,  1,       -185),
    lat( 2, -1, -2, -1,        181),
    lat( 0,  1,  2,  1,       -177),
    lat( 4,  0, -2, -1,        176),
    lat( 4, -1, -1, -1,        166),
    lat( 1,  0,  1, -1,       -164),
    lat( 4,  0,  1, -1,        132),
    lat( 1,  0, -1, -1,       -119),
    lat( 4, -1,  0, -1,        115),
    lat( 2, -2,  0,  1,        107),
];
