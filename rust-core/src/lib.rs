//! The astronomy of the star-map generator: where the stars, the Messier objects
//! and the planets are, and how a chart projects them.
//!
//! The crate works in one frame, the equator and equinox of J2000. A direction is
//! a unit vector with `x` towards RA 0h, `y` towards RA 6h and `z` towards the
//! north celestial pole ([`ra_dec_to_unit_vector`]). The [`catalog`]s give their
//! objects in it, [`planets`] puts the Sun, the Moon and the planets in it for an
//! instant of [`time`], and the [`projections`] take it to a place on a chart.
//!
//! The backend's SVG and PDF exporter draws with it, and the frontend's preview
//! repeats its view projection, so that the preview and the printed map agree.
//!
//! Every module is reachable by its path; the crate root re-exports what they
//! define, so `rust_core::HipCatalog` and `rust_core::catalog::HipCatalog` are one.

pub mod catalog;
pub mod coords;
pub mod planets;
pub mod projections;
pub mod time;

pub use catalog::{CatalogError, HipCatalog, MessierCatalog, MessierKind, MessierObject, Star};
pub use coords::ra_dec_to_unit_vector;
pub use planets::{Body, PlanetPosition, all_positions};
pub use projections::{
    CameraConfig, PinholeProjection, ProjectionError, StereoPoint, StereoProjection, ViewKind,
    ViewProjection,
};
pub use time::{DateTime, julian_date, sidereal_time, vernal_equinox_hour_angle};
