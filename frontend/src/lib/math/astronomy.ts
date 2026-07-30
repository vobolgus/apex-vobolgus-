/**
 * Shared astronomy primitives for the TypeScript side of the app.
 *
 * This module is the single source of truth for the frame conversions and astronomical
 * constants used by the canvas preview. The Rust SVG exporter
 * (`backend/src/svg_generator/grids.rs`) implements the same geometry independently, so the
 * two are pinned against the shared fixture `backend/assets/golden/reference-geometry.json`
 * (see `src/lib/renderer/reference-geometry.golden.test.ts`). If you change anything here,
 * change the Rust side and the fixture together.
 */

export interface UnitVec3 {
	x: number;
	y: number;
	z: number;
}

/** J2000 obliquity of the ecliptic, in degrees. Must match `obliquity_deg` in the golden fixture. */
export const J2000_OBLIQUITY_DEG = 23.439291;

/** J2000 obliquity of the ecliptic, in radians. */
export const J2000_OBLIQUITY_RAD = (J2000_OBLIQUITY_DEG * Math.PI) / 180;

/**
 * ICRS J2000 → galactic rotation matrix (Liu et al. 2011 / standard form), transposed.
 *
 * We only ever need R^T (galactic → equatorial) applied to points on the galactic equator,
 * i.e. to (cos l, sin l, 0), so only the first two columns are stored — the third column
 * would only contribute for b ≠ 0.
 *
 * Indexed as `[row][column]`: row = equatorial axis (x, y, z), column = galactic axis (l-cos, l-sin).
 */
export const GALACTIC_TO_EQUATORIAL_MATRIX = [
	[-0.05487556, +0.494109428],
	[-0.87343709, -0.44482963],
	[-0.483835016, +0.746982245]
] as const;

/**
 * Convert equatorial spherical coordinates to a unit vector in the equatorial (ICRS) frame.
 *
 * The frame convention is x → (RA 0h, Dec 0°), y → (RA 6h, Dec 0°), z → north celestial pole.
 * This is the same convention the Rust exporter uses.
 */
export function raDecToUnitVector(
	raRad: number,
	decRad: number
): { x: number; y: number; z: number } {
	const cosDec = Math.cos(decRad);
	return {
		x: cosDec * Math.cos(raRad),
		y: cosDec * Math.sin(raRad),
		z: Math.sin(decRad)
	};
}

/**
 * Map a point on the galactic equator, given as (cos l, sin l, 0) in the galactic frame,
 * to a unit vector in the equatorial frame.
 */
export function galacticToEquatorial(cosL: number, sinL: number): UnitVec3 {
	const m = GALACTIC_TO_EQUATORIAL_MATRIX;
	return {
		x: m[0][0] * cosL + m[0][1] * sinL,
		y: m[1][0] * cosL + m[1][1] * sinL,
		z: m[2][0] * cosL + m[2][1] * sinL
	};
}
