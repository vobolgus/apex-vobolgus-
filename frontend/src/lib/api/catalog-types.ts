/**
 * What the backend's catalogue endpoints send, as they send it: the field names
 * are the wire's. `$lib/api/catalog` fetches them, `$lib/state/catalog` holds them.
 */

/** A star of `/api/catalog/full` (or `/bright`). */
export interface CatalogStar {
	ra: number;
	dec: number;
	v_mag: number;
}

/** A point of a constellation's figure or boundary, on the unit sphere. */
export interface ConstellationSegmentPoint {
	x: number;
	y: number;
	z: number;
}

/** A constellation's stick figure (`/api/constellations`) or its IAU boundary (`/api/constellation-boundaries`). */
export interface ConstellationData {
	abbr: string;
	segments: ConstellationSegmentPoint[][];
}

/** A Messier object, as `/api/catalog/messier` sends it. */
export interface MessierObject {
	/** Its number: 42 for M 42. */
	m: number;
	/** Its common name; empty when it has none. */
	name: string;
	/** "Galaxy", "Open Cluster", ... */
	kind: string;
	/** The constellation it is in, abbreviated: "Ori". */
	constellation: string;
	mag: number;
	/** Degrees, J2000. */
	ra_deg: number;
	dec_deg: number;
}
