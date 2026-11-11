//! What the catalogue routes send: the stars, the Messier objects and the
//! constellations, each as the JSON a chart is drawn from in the browser.
//!
//! The page's TypeScript is written from these same types (`crate::wire`).

use std::collections::HashMap;
use std::ops::RangeBounds;

use rust_core::catalog::{HipCatalog, MessierCatalog, Star};
use rust_core::coords::{Direction, ra_dec_to_unit_vector};
use serde::Serialize;

use crate::constellations;

/// Faintest star of `/api/catalog/bright` by default: the first, small load.
pub(crate) const BRIGHT_MAX_MAG: f32 = 4.0;
/// Faintest star of `/api/catalog/full` by default: everything the chart draws.
pub(crate) const FULL_MAX_MAG: f32 = 6.5;
/// Faintest star a stick figure may join.
const FIGURE_MAX_MAG: f32 = 7.5;

/// A star as the catalog routes send it: where it is and how bright, which is all
/// a chart needs to draw it. The catalog's own `Star` also carries the HIP number
/// and the unit vector; a client derives the vector from `ra` and `dec`, and
/// leaving the four fields out makes the payload about a third of the size.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub(crate) struct CatalogStar {
    /// Visual magnitude.
    v_mag: f32,
    /// Radians.
    ra: f32,
    /// Radians.
    dec: f32,
}

impl From<&Star> for CatalogStar {
    fn from(star: &Star) -> Self {
        Self {
            v_mag: star.v_mag,
            ra: star.ra,
            dec: star.dec,
        }
    }
}

/// The stars whose visual magnitude is in `magnitudes`, as the catalog routes send them.
pub(crate) fn stars(catalog: &HipCatalog, magnitudes: impl RangeBounds<f32>) -> Vec<CatalogStar> {
    catalog.stars(magnitudes).map(CatalogStar::from).collect()
}

/// A Messier object as `/api/catalog/messier` sends it: what to call it and where it is.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub(crate) struct MessierEntry {
    /// Its number: 42 for M 42.
    m: i32,
    /// Its common name; empty when it has none.
    name: String,
    /// "Galaxy", "Open Cluster", ...
    kind: &'static str,
    /// The constellation it is in, abbreviated: "Ori".
    constellation: String,
    /// Visual magnitude.
    mag: f32,
    /// Degrees, J2000.
    ra_deg: f32,
    /// Degrees, J2000.
    dec_deg: f32,
}

/// The whole Messier catalogue, by number.
pub(crate) fn messier() -> Vec<MessierEntry> {
    let mut objects: Vec<MessierEntry> = MessierCatalog::new()
        .objects()
        .iter()
        .map(|object| MessierEntry {
            m: object.m_number,
            name: object.name.clone(),
            kind: object.kind.name(),
            constellation: object.constellation.clone(),
            mag: object.v_mag,
            // From the unit vector, which is what the charts are drawn from.
            ra_deg: object.y.atan2(object.x).to_degrees().rem_euclid(360.0),
            dec_deg: object.z.clamp(-1.0, 1.0).asin().to_degrees(),
        })
        .collect();
    objects.sort_by_key(|object| object.m);
    objects
}

/// A point of a constellation's line: a direction on the sky, as a unit vector in
/// the J2000 equatorial frame.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub(crate) struct SegmentPoint {
    /// Towards RA 0h on the equator.
    x: f32,
    /// Towards RA 6h on the equator.
    y: f32,
    /// Towards the north celestial pole.
    z: f32,
}

impl From<Direction> for SegmentPoint {
    fn from(Direction { x, y, z }: Direction) -> Self {
        Self { x, y, z }
    }
}

/// One constellation's lines: the polylines of its stick figure, or the polygons of
/// its boundary.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub(crate) struct ConstellationSegments {
    /// The constellation's abbreviation in capitals: "ORI".
    abbr: String,
    /// The lines, each a run of points joined in order.
    segments: Vec<Vec<SegmentPoint>>,
}

/// The IAU boundaries as polygons of unit vectors, sorted by constellation.
pub(crate) fn constellation_boundaries() -> Vec<ConstellationSegments> {
    let mut result: Vec<ConstellationSegments> = constellations::boundaries()
        .iter()
        .map(|(abbr, polygons)| {
            let segments = polygons
                .iter()
                .map(|polygon| {
                    polygon
                        .iter()
                        .map(|&[ra_deg, dec_deg]| {
                            ra_dec_to_unit_vector(ra_deg.to_radians(), dec_deg.to_radians()).into()
                        })
                        .collect()
                })
                .collect();
            ConstellationSegments {
                abbr: abbr.clone(),
                segments,
            }
        })
        .collect();
    result.sort_by(|a, b| a.abbr.cmp(&b.abbr));
    result
}

/// The stick figures as polylines of unit vectors, sorted by constellation. A star
/// the catalogue does not have is left out of its line, and a line or a figure with
/// nothing left to join is left out altogether.
pub(crate) fn constellation_figures(catalog: &HipCatalog) -> Vec<ConstellationSegments> {
    let stars: HashMap<i32, &Star> = catalog
        .stars(..=FIGURE_MAX_MAG)
        .map(|star| (star.hip_id, star))
        .collect();

    let mut result: Vec<ConstellationSegments> = constellations::figures()
        .iter()
        .filter_map(|(abbr, figure)| {
            let segments: Vec<Vec<SegmentPoint>> = figure
                .lines
                .iter()
                .filter_map(|line| {
                    let points: Vec<SegmentPoint> = line
                        .iter()
                        .filter_map(|hip_id| stars.get(hip_id))
                        .map(|&star| Direction::from(star).into())
                        .collect();
                    (points.len() >= 2).then_some(points)
                })
                .collect();
            (!segments.is_empty()).then(|| ConstellationSegments {
                abbr: abbr.clone(),
                segments,
            })
        })
        .collect();
    result.sort_by(|a, b| a.abbr.cmp(&b.abbr));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_messier_catalogue_is_sent_whole_by_number_with_its_places_in_degrees() {
        let objects = messier();
        assert_eq!(objects.len(), 110);
        assert!(objects.windows(2).all(|pair| pair[0].m < pair[1].m));
        let m31 = objects.iter().find(|object| object.m == 31).unwrap();
        assert_eq!(m31.name, "Andromeda Galaxy");
        assert_eq!(m31.kind, "Galaxy");
        assert_eq!(m31.constellation, "And");
        // 0h 42.7m, +41° 16′.
        assert!((m31.ra_deg - 10.68).abs() < 0.1, "{}", m31.ra_deg);
        assert!((m31.dec_deg - 41.27).abs() < 0.1, "{}", m31.dec_deg);
        let m42 = objects.iter().find(|object| object.m == 42).unwrap();
        assert!((m42.ra_deg - 83.82).abs() < 0.1, "{}", m42.ra_deg);
        assert!((m42.dec_deg + 5.39).abs() < 0.1, "{}", m42.dec_deg);
        for object in &objects {
            assert!((0.0..360.0).contains(&object.ra_deg), "M {}", object.m);
            assert!((-90.0..=90.0).contains(&object.dec_deg), "M {}", object.m);
        }
    }
}
