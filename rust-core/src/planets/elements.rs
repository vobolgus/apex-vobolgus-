//! Meeus' low-precision planetary elements, *Astronomical Algorithms* (2nd ed.),
//! chapter 31: the mean elements of each planet's orbit for the mean ecliptic and
//! equinox of J2000.0, with their linear rates per Julian century.

/// The elements of a planet's orbit at J2000.0 and how fast each changes.
pub(super) struct OrbitalElements {
    /// Semi-major axis, AU, and its rate, AU per century.
    pub(super) a_au: f64,
    pub(super) a_rate_au: f64,
    /// Eccentricity and its rate per century.
    pub(super) e: f64,
    pub(super) e_rate: f64,
    /// Inclination to the ecliptic, degrees, and its rate, arcseconds per century.
    pub(super) i_deg: f64,
    pub(super) i_rate_arcsec: f64,
    /// Mean longitude, degrees, and its rate, arcseconds per century.
    pub(super) l_deg: f64,
    pub(super) l_rate_arcsec: f64,
    /// Longitude of the perihelion, degrees, and its rate, arcseconds per century.
    pub(super) long_peri_deg: f64,
    pub(super) long_peri_rate_arcsec: f64,
    /// Longitude of the ascending node, degrees, and its rate, arcseconds per century.
    pub(super) long_node_deg: f64,
    pub(super) long_node_rate_arcsec: f64,
}

pub(super) const MERCURY: OrbitalElements = OrbitalElements {
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

pub(super) const VENUS: OrbitalElements = OrbitalElements {
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

pub(super) const EARTH: OrbitalElements = OrbitalElements {
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

pub(super) const MARS: OrbitalElements = OrbitalElements {
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

pub(super) const JUPITER: OrbitalElements = OrbitalElements {
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

pub(super) const SATURN: OrbitalElements = OrbitalElements {
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

pub(super) const URANUS: OrbitalElements = OrbitalElements {
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

pub(super) const NEPTUNE: OrbitalElements = OrbitalElements {
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
