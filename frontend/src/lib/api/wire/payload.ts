/**
 * What the catalogue routes send (backend/src/payload.rs).
 *
 * Written by the backend from its own types (backend/src/wire.rs), not by hand:
 * `WIRE_TYPES=write cargo test -p backend wire` writes it again after a change there.
 */

/** Faintest star of `/api/catalog/full` by default: everything the chart draws. */
export const FULL_MAX_MAG = 6.5;

/**
 * A star as the catalog routes send it: where it is and how bright, which is all
 * a chart needs to draw it. The catalog's own `Star` also carries the HIP number
 * and the unit vector; a client derives the vector from `ra` and `dec`, and
 * leaving the four fields out makes the payload about a third of the size.
 */
export type CatalogStar = {
	/** Visual magnitude. */
	v_mag: number;
	/** Radians. */
	ra: number;
	/** Radians. */
	dec: number;
};

/** A Messier object as `/api/catalog/messier` sends it: what to call it and where it is. */
export type MessierEntry = {
	/** Its number: 42 for M 42. */
	m: number;
	/** Its common name; empty when it has none. */
	name: string;
	/** "Galaxy", "Open Cluster", ... */
	kind: string;
	/** The constellation it is in, abbreviated: "Ori". */
	constellation: string;
	/** Visual magnitude. */
	mag: number;
	/** Degrees, J2000. */
	ra_deg: number;
	/** Degrees, J2000. */
	dec_deg: number;
};

/**
 * A point of a constellation's line: a direction on the sky, as a unit vector in
 * the J2000 equatorial frame.
 */
export type SegmentPoint = {
	/** Towards RA 0h on the equator. */
	x: number;
	/** Towards RA 6h on the equator. */
	y: number;
	/** Towards the north celestial pole. */
	z: number;
};

/**
 * One constellation's lines: the polylines of its stick figure, or the polygons of
 * its boundary.
 */
export type ConstellationSegments = {
	/** The constellation's abbreviation in capitals: "ORI". */
	abbr: string;
	/** The lines, each a run of points joined in order. */
	segments: Array<Array<SegmentPoint>>;
};
