//! The 110 objects of Messier's catalogue.

use std::fmt;

use serde::{Deserialize, Serialize};

use super::CatalogError;

/// The table compiled into the crate: M 1 to M 110, by number.
const EMBEDDED: &[u8] = include_bytes!("messier_data.bin");

/// What a Messier object is. The table stores it as the code of each variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "i32", into = "i32")]
pub enum MessierKind {
    /// A galaxy.
    Galaxy = 1,
    /// A globular cluster.
    GlobularCluster = 2,
    /// An open cluster.
    OpenCluster = 3,
    /// A nebula.
    Nebula = 4,
    /// A supernova remnant (M 1).
    SupernovaRemnant = 5,
    /// A star cloud (M 24).
    StarCloud = 6,
    /// A double star (M 40).
    DoubleStar = 7,
}

impl MessierKind {
    /// The kind's name in English, as the catalogue routes send it: "Open Cluster".
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Galaxy => "Galaxy",
            Self::GlobularCluster => "Globular Cluster",
            Self::OpenCluster => "Open Cluster",
            Self::Nebula => "Nebula",
            Self::SupernovaRemnant => "Supernova Remnant",
            Self::StarCloud => "Star Cloud",
            Self::DoubleStar => "Double Star",
        }
    }

    /// A colour to draw the kind in, `#RRGGBB`.
    #[must_use]
    pub const fn color(self) -> &'static str {
        match self {
            Self::Galaxy => "#FF6B9D",
            Self::GlobularCluster => "#FFD700",
            Self::OpenCluster => "#87CEEB",
            Self::Nebula => "#00CED1",
            Self::SupernovaRemnant => "#FF4500",
            Self::StarCloud => "#DDA0DD",
            Self::DoubleStar => "#FFFDE7",
        }
    }
}

impl fmt::Display for MessierKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl TryFrom<i32> for MessierKind {
    type Error = CatalogError;

    /// The kind of a type code of the table, 1 to 7.
    fn try_from(code: i32) -> Result<Self, Self::Error> {
        Ok(match code {
            1 => Self::Galaxy,
            2 => Self::GlobularCluster,
            3 => Self::OpenCluster,
            4 => Self::Nebula,
            5 => Self::SupernovaRemnant,
            6 => Self::StarCloud,
            7 => Self::DoubleStar,
            _ => return Err(CatalogError::UnknownMessierKind(code)),
        })
    }
}

impl From<MessierKind> for i32 {
    /// The kind's type code in the table.
    fn from(kind: MessierKind) -> Self {
        kind as Self
    }
}

/// An object of Messier's catalogue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MessierObject {
    /// Its number: 42 for M 42.
    pub m_number: i32,
    /// Its common name; empty when it has none.
    pub name: String,
    /// Right ascension, radians.
    pub ra: f32,
    /// Declination, radians.
    pub dec: f32,
    /// Unit vector towards the object in the equatorial frame: x towards RA 0h.
    pub x: f32,
    /// Towards RA 6h.
    pub y: f32,
    /// Towards the north celestial pole.
    pub z: f32,
    /// Visual magnitude, V.
    pub v_mag: f32,
    /// Apparent size, arcminutes.
    pub size: f32,
    /// What it is.
    pub kind: MessierKind,
    /// The constellation it is in, as its IAU abbreviation: "Ori".
    pub constellation: String,
}

/// The objects of Messier's catalogue, by number.
pub struct MessierCatalog {
    objects: Vec<MessierObject>,
}

impl Default for MessierCatalog {
    fn default() -> Self {
        Self::new()
    }
}

impl MessierCatalog {
    /// The catalogue compiled into the crate: M 1 to M 110.
    ///
    /// # Panics
    ///
    /// Never: the embedded table is a valid one, which the tests check.
    #[must_use]
    pub fn new() -> Self {
        Self::from_bincode(EMBEDDED).expect("the embedded Messier table decodes")
    }

    /// A catalogue from a bincode list of [`MessierObject`] records.
    ///
    /// # Errors
    ///
    /// [`CatalogError::Decode`] when the bytes are not such a list, or a type code
    /// is not a [`MessierKind`].
    pub fn from_bincode(bytes: &[u8]) -> Result<Self, CatalogError> {
        Ok(Self {
            objects: bincode::deserialize(bytes)?,
        })
    }

    /// Every object, in the order of the table.
    #[must_use]
    pub fn objects(&self) -> &[MessierObject] {
        &self.objects
    }

    /// The object of a Messier number, if there is one.
    #[must_use]
    pub fn object(&self, m_number: i32) -> Option<&MessierObject> {
        self.objects.iter().find(|o| o.m_number == m_number)
    }

    /// The objects of one kind.
    pub fn of_kind(&self, kind: MessierKind) -> impl Iterator<Item = &MessierObject> {
        self.objects.iter().filter(move |o| o.kind == kind)
    }

    /// The objects in a constellation, by its abbreviation in any case ("ori").
    pub fn in_constellation(
        &self,
        constellation: &str,
    ) -> impl Iterator<Item = &MessierObject> + use<'_> {
        let const_upper = constellation.to_uppercase();
        self.objects
            .iter()
            .filter(move |o| o.constellation.to_uppercase() == const_upper)
    }

    /// The objects with `min_mag <= v_mag <= max_mag`.
    pub fn in_magnitude_range(
        &self,
        min_mag: f32,
        max_mag: f32,
    ) -> impl Iterator<Item = &MessierObject> {
        self.objects
            .iter()
            .filter(move |o| o.v_mag >= min_mag && o.v_mag <= max_mag)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_messier_catalog_loading() {
        let catalog = MessierCatalog::new();
        let all_objects = catalog.objects();
        assert_eq!(all_objects.len(), 110);

        // Проверяем конкретный объект (M31 - туманность Андромеды)
        let m31 = catalog.object(31).expect("M31 must exist");
        assert_eq!(m31.name, "Andromeda Galaxy");
        assert_eq!(m31.kind, MessierKind::Galaxy);
        assert_eq!(m31.kind.name(), "Galaxy");
        assert_eq!(m31.kind.color(), "#FF6B9D");
        assert_eq!(m31.constellation, "And");

        // Фильтрация по типам
        let galaxies: Vec<&MessierObject> = catalog.of_kind(MessierKind::Galaxy).collect();
        assert!(!galaxies.is_empty());
        assert!(galaxies.iter().all(|g| g.kind == MessierKind::Galaxy));

        // Поиск по созвездию
        let ori_objects = catalog.in_constellation("Ori").count();
        assert!(ori_objects > 0);
        // Проверка регистронезависимости
        let ori_objects_lower = catalog.in_constellation("ori").count();
        assert_eq!(ori_objects, ori_objects_lower);

        // Фильтрация по звездной величине
        let bright_messier: Vec<&MessierObject> = catalog.in_magnitude_range(0.0, 6.0).collect();
        assert!(bright_messier.len() < 110);
        for obj in bright_messier {
            assert!(obj.v_mag >= 0.0 && obj.v_mag <= 6.0);
        }
    }

    #[test]
    fn a_kind_is_its_type_code() {
        for code in 1..=7 {
            let kind = MessierKind::try_from(code).expect("a kind");
            assert_eq!(i32::from(kind), code);
            assert_eq!(kind.to_string(), kind.name());
        }
        assert!(matches!(
            MessierKind::try_from(8),
            Err(CatalogError::UnknownMessierKind(8))
        ));
    }

    #[test]
    fn a_kind_is_stored_as_its_type_code() {
        let nebula = 4i32.to_le_bytes();
        assert_eq!(
            bincode::serialize(&MessierKind::Nebula).expect("serializes"),
            nebula
        );
        let decoded: MessierKind = bincode::deserialize(&nebula).expect("decodes");
        assert_eq!(decoded, MessierKind::Nebula);
        assert!(bincode::deserialize::<MessierKind>(&9i32.to_le_bytes()).is_err());
    }
}
