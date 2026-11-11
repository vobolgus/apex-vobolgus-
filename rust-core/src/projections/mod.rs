//! Projections of the sky onto a chart.
//!
//! Every projection takes a [`Direction`] of the equatorial frame and gives a
//! place on the chart, or nothing when the direction is not on it:
//! - [`ViewProjection`] is the generator preview's camera, stereographic or
//!   pinhole, so an export shows exactly what the preview shows;
//! - [`StereoProjection`] is the sky of an observer at a place and an instant;
//! - [`PinholeProjection`] is a camera looking at a direction, with a tilt.
//!
//! The two cameras give a place in px and are asked through [`Project`]. The
//! observer's sky gives more, its whole [`StereoPoint`], which the chart that
//! draws it scales and places itself.

mod pinhole;
mod stereo;
mod view;

use crate::coords::Direction;

pub use self::pinhole::{CameraConfig, PinholeProjection};
pub use self::stereo::{StereoPoint, StereoProjection};
pub use self::view::{ViewBasis, ViewKind, ViewProjection};

/// Where a direction on the sky lands on a chart, if it lands at all.
pub trait Project {
    /// The chart position of `direction`, px from the top-left with y down; `None`
    /// when the chart does not show it (behind the camera, off the frame, ...).
    fn project(&self, direction: Direction) -> Option<(f32, f32)>;
}

/// Why a projection cannot be set up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ProjectionError {
    /// A direction the camera is set by has no length, or no finite one.
    #[error("a direction of the camera has no length")]
    DegenerateDirection,
    /// The chart is not of a positive, finite size.
    #[error("the chart size is not positive and finite")]
    InvalidSize,
    /// The field of view is not one the projection can show.
    #[error("the field of view is out of the projection's range")]
    InvalidFieldOfView,
}
