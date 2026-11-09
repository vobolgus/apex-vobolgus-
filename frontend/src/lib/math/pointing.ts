/**
 * Where the chart looks, in the terms an astronomer would write down: the
 * equatorial coordinates of its centre and the position angle of its top.
 *
 * The preview keeps its camera as a quaternion (`view.orientation`); this is the
 * same camera in three angles, for the link in the address bar. The position
 * angle is that of the screen's up direction at the centre: the bearing from the
 * centre to the topmost point of the stereo disc, or to the middle of the pinhole
 * frame's top edge, measured from north through east (0° north up, 90° east up).
 */

import { viewBasis, type Vec3Tuple } from './projection';
import { quaternionFromRotationMatrix, type Quaternion } from './quaternion';

export interface Pointing {
	/** Right ascension of the chart's centre, degrees in [0, 360). */
	raDeg: number;
	/** Declination of the chart's centre, degrees in [−90, 90]. */
	decDeg: number;
	/** Position angle of the chart's top, degrees in [0, 360), north through east. */
	paDeg: number;
}

const DEG = Math.PI / 180;
/** Closer to a pole than this the centre has no right ascension of its own: it reads 0. */
const POLE_EPSILON = 1e-9;

function wrapDeg(deg: number): number {
	const wrapped = ((deg % 360) + 360) % 360;
	// −1e-15 wraps to 360 exactly in floating point.
	return wrapped >= 360 ? 0 : wrapped;
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The unit vector of (ra, dec) and the north and east directions there. North and
 * east are written from the angles, not from the vector, so they stay defined at
 * the poles: there the right ascension only picks which way "north" points, and
 * the position angle is read against that.
 */
function localFrame(raRad: number, decRad: number) {
	const [sinRa, cosRa] = [Math.sin(raRad), Math.cos(raRad)];
	const [sinDec, cosDec] = [Math.sin(decRad), Math.cos(decRad)];
	return {
		forward: [cosDec * cosRa, cosDec * sinRa, sinDec] as Vec3Tuple,
		north: [-sinDec * cosRa, -sinDec * sinRa, cosDec] as Vec3Tuple,
		east: [-sinRa, cosRa, 0] as Vec3Tuple
	};
}

/** The centre and the position angle of the top of the view `orientation` shows. */
export function orientationToPointing(orientation: Quaternion): Pointing {
	const { up, forward } = viewBasis(orientation);
	const decRad = Math.asin(Math.max(-1, Math.min(1, forward[2])));
	const raRad =
		Math.hypot(forward[0], forward[1]) < POLE_EPSILON ? 0 : Math.atan2(forward[1], forward[0]);
	const { north, east } = localFrame(raRad, decRad);
	return {
		raDeg: wrapDeg(raRad / DEG),
		decDeg: decRad / DEG,
		paDeg: wrapDeg(Math.atan2(dot(up, east), dot(up, north)) / DEG)
	};
}

/** The orientation that centres the view on (ra, dec) with its top at `paDeg`. */
export function pointingToOrientation(pointing: Pointing): Quaternion {
	const { forward, north, east } = localFrame(pointing.raDeg * DEG, pointing.decDeg * DEG);
	const [sinPa, cosPa] = [Math.sin(pointing.paDeg * DEG), Math.cos(pointing.paDeg * DEG)];
	const up: Vec3Tuple = [
		cosPa * north[0] + sinPa * east[0],
		cosPa * north[1] + sinPa * east[1],
		cosPa * north[2] + sinPa * east[2]
	];
	// The preview mirrors x (east is left of north), so the rotation's first row is −right.
	const left = cross(up, forward);
	return quaternionFromRotationMatrix([left, up, forward]);
}
