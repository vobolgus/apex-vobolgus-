//! The catalogues compiled into the crate: the Hipparcos stars a chart draws and
//! the Messier objects, each a bincode table decoded once when it is opened.
//!
//! Places are on the J2000 equator (ICRS), as right ascension and declination in
//! radians and as the unit vector of [`crate::coords::ra_dec_to_unit_vector`].

mod hip;
mod messier;

pub use self::hip::{HipCatalog, Star};
pub use self::messier::{MessierCatalog, MessierKind, MessierObject};

/// Why a catalogue cannot be read.
#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    /// The bytes are not a bincode list of the catalogue's records.
    #[error("the catalogue is not a valid bincode table")]
    Decode(#[from] bincode::Error),
    /// A Messier object's type code is none of the seven [`MessierKind`]s.
    #[error("{0} is not a Messier object type code")]
    UnknownMessierKind(i32),
}
