//! The constellations the server carries: their stick figures, their IAU
//! boundaries and their Russian names.
//!
//! The figures and the boundaries are JSON files in `backend/assets/constellations`,
//! built into the binary and read once, on first use. Both are keyed by the
//! constellation's abbreviation in capitals (`ORI`).

mod names_ru;

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Deserialize;

use self::names_ru::NAMES_RU;

/// One constellation's stick figure.
#[derive(Debug, Deserialize)]
pub(crate) struct Figure {
    /// Its Latin name: "Orion".
    pub(crate) name: String,
    /// Polylines of Hipparcos numbers: each joins its stars in order.
    pub(crate) lines: Vec<Vec<i32>>,
    /// Where its name is set: a unit vector in the J2000 equatorial frame.
    pub(crate) center: [f32; 3],
}

/// A closed boundary polygon: `[ra_deg, dec_deg]` vertices, J2000.
pub(crate) type Polygon = Vec<[f32; 2]>;

// Загружаем созвездия из JSON один раз
static FIGURES: LazyLock<HashMap<String, Figure>> = LazyLock::new(|| {
    let json_str = include_str!("../../assets/constellations/constellations_data.json");
    serde_json::from_str(json_str)
        .expect("invariant violation: embedded backend/assets/constellations/constellations_data.json is malformed; this indicates checked-in data corruption")
});

static BOUNDARIES: LazyLock<HashMap<String, Vec<Polygon>>> = LazyLock::new(|| {
    let json_str = include_str!("../../assets/constellations/constellation_boundaries.json");
    serde_json::from_str(json_str)
        .expect("invariant violation: embedded backend/assets/constellations/constellation_boundaries.json is malformed; this indicates checked-in data corruption")
});

/// Every constellation's stick figure, by abbreviation.
pub(crate) fn figures() -> &'static HashMap<String, Figure> {
    &FIGURES
}

/// Every constellation's boundary polygons, by abbreviation.
pub(crate) fn boundaries() -> &'static HashMap<String, Vec<Polygon>> {
    &BOUNDARIES
}

/// The Russian name of the constellation `abbr`, or `default_name` when the
/// dictionary has none.
pub(crate) fn localized_name<'a>(abbr: &str, default_name: &'a str) -> &'a str {
    NAMES_RU
        .iter()
        .find(|&&(key, _)| key == abbr)
        .map_or(default_name, |&(_, name)| name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_tables_hold_all_88_constellations() {
        assert_eq!(figures().len(), 88);
        assert_eq!(boundaries().len(), 88);
        assert!(figures().keys().all(|abbr| boundaries().contains_key(abbr)));
        let orion = &figures()["ORI"];
        assert_eq!(orion.name, "Orion");
        // A line joins at least two stars.
        assert!(
            figures()
                .values()
                .flat_map(|f| &f.lines)
                .all(|l| l.len() >= 2)
        );
    }

    #[test]
    fn a_name_is_russian_where_the_dictionary_has_it() {
        assert_eq!(localized_name("ORI", "Orion"), "Орион");
        assert_eq!(localized_name("XYZ", "Nowhere"), "Nowhere");
    }
}
