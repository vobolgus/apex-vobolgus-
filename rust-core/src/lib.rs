//! The astronomy of the star-map generator: where the stars, the Messier objects
//! and the planets are, and how a chart projects them.
//!
//! The crate works in one frame, the equator and equinox of J2000. A direction is
//! a unit vector with `x` towards RA 0h, `y` towards RA 6h and `z` towards the
//! north celestial pole ([`coords::ra_dec_to_unit_vector`]). The [`catalog`]s give
//! their objects in it, [`planets`] puts the Sun, the Moon and the planets in it for
//! an instant of [`time`], and the [`projections`] take it to a place on a chart.
//!
//! The backend's SVG and PDF exporter draws with it, and the frontend's preview
//! repeats its view projection, so that the preview and the printed map agree.
//!
//! Each item has one path, through the module that defines it:
//! `rust_core::catalog::HipCatalog`, `rust_core::projections::ViewProjection`.

pub mod catalog;
pub mod coords;
pub mod planets;
pub mod projections;
pub mod time;
