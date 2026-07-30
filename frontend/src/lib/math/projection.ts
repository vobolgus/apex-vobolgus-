import { clamp, lerp, smoothstep } from './easing';
import {
	CHART_RADIUS_FRAC,
	EPSILON,
	MAX_FOV_DEG_PINHOLE,
	MAX_FOV_DEG_STEREO,
	MIN_FOV_DEG_PINHOLE,
	MIN_FOV_DEG_STEREO,
	PROJECTION_FINITE_EPSILON,
	PROJECTION_INFINITE_SDF,
	PROJECTION_NORM_CLAMP,
	STAR_ALPHA,
	STAR_BASE_RADIUS_PX,
	STAR_MAG_COEFF,
	STAR_MIN_RADIUS_PX,
	VISIBILITY_SMOOTHSTEP_INNER,
	VISIBILITY_SMOOTHSTEP_OUTER
} from '../constants';

export interface ProjectionFrameParams {
	radius: number;
	morphHalfWidth: number;
	morphHalfHeight: number;
	morphViewportWidth: number;
	morphViewportHeight: number;
	pinholeViewportWidth: number;
	pinholeViewportHeight: number;
	tanHalfHorizontalFov: number;
	tanHalfVerticalFov: number;
	stereoScale: number;
}

export interface StarMorphSample {
	px: number;
	py: number;
	visibility: number;
	stereoAlpha: number;
	stereoRadius: number;
	pinholeAlpha: number;
	pinholeRadius: number;
}

export interface StarVector {
	x: number;
	y: number;
	z: number;
	v_mag: number;
}

export function getProjectionFrameParams(
	width: number,
	height: number,
	scaleT: number,
	stereoFovDeg: number,
	pinholeFovDeg: number,
	pinholeAspectRatio: number,
	pinholeHeightFrac: number
): ProjectionFrameParams {
	const radius = Math.min(width, height) * CHART_RADIUS_FRAC;
	const pinholeViewportHeight = radius * pinholeHeightFrac;
	const pinholeViewportWidth = pinholeViewportHeight * pinholeAspectRatio;
	const stereoViewportWidth = radius * 2;
	const stereoViewportHeight = radius * 2;
	const normalizedScaleT = clamp(scaleT, 0, 1);
	const morphViewportWidth = lerp(stereoViewportWidth, pinholeViewportWidth, normalizedScaleT);
	const morphViewportHeight = lerp(stereoViewportHeight, pinholeViewportHeight, normalizedScaleT);
	const morphHalfWidth = morphViewportWidth * 0.5;
	const morphHalfHeight = morphViewportHeight * 0.5;
	const pinholeFovRad = (pinholeFovDeg * Math.PI) / 180;
	const tanHalfHorizontalFov = Math.tan(pinholeFovRad * 0.5);
	const morphAspect = morphViewportWidth / Math.max(1, morphViewportHeight);
	const tanHalfVerticalFov = tanHalfHorizontalFov / Math.max(morphAspect, EPSILON);
	// Stereographic zoom: at fov=180° (half-sky), tan(fov/4)=1 → scale=1 (disk fills viewport,
	// vz=0 maps to disk edge). At smaller fov, scale>1 zooms in. Independent from pinhole fov.
	const stereoFovRad = (stereoFovDeg * Math.PI) / 180;
	const stereoScale = 1 / Math.max(Math.tan(stereoFovRad * 0.25), EPSILON);
	return {
		radius,
		pinholeViewportWidth,
		pinholeViewportHeight,
		morphViewportWidth,
		morphViewportHeight,
		morphHalfWidth,
		morphHalfHeight,
		tanHalfHorizontalFov,
		tanHalfVerticalFov,
		stereoScale
	};
}

export function sampleStarMorphFrame(
	star: StarVector,
	blend: number,
	params: ProjectionFrameParams,
	rotateVector: (x: number, y: number, z: number) => readonly [number, number, number]
): StarMorphSample {
	const [vx, vy, vz] = rotateVector(star.x, star.y, star.z);
	const denom = 1 + vz;
	const stereoFinite = denom > PROJECTION_FINITE_EPSILON;
	const stereoNormXRaw = stereoFinite ? (vx / denom) * params.stereoScale : 0;
	const stereoNormYRaw = stereoFinite ? (vy / denom) * params.stereoScale : 0;
	const stereoNormX = clamp(stereoNormXRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const stereoNormY = clamp(stereoNormYRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const stereoNormHypot = Math.hypot(stereoNormXRaw, stereoNormYRaw);
	const stereoInsideDisk = stereoFinite && vz >= 0 && stereoNormHypot <= 1;
	const stereoSdf = stereoInsideDisk ? stereoNormHypot - 1 : PROJECTION_INFINITE_SDF;
	const starRadius = Math.max(
		STAR_MIN_RADIUS_PX,
		STAR_BASE_RADIUS_PX - STAR_MAG_COEFF * star.v_mag
	);
	const stereoAlpha = STAR_ALPHA;
	const stereoRadius = starRadius;

	const pinholeFinite = vz > PROJECTION_FINITE_EPSILON;
	const pinholeNormXRaw = pinholeFinite ? vx / vz / params.tanHalfHorizontalFov : 0;
	const pinholeNormYRaw = pinholeFinite ? vy / vz / params.tanHalfVerticalFov : 0;
	const pinholeNormX = clamp(pinholeNormXRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const pinholeNormY = clamp(pinholeNormYRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const pinholeSdf = pinholeFinite
		? Math.max(Math.abs(pinholeNormXRaw), Math.abs(pinholeNormYRaw)) - 1
		: PROJECTION_INFINITE_SDF;
	const pinholeAlpha = STAR_ALPHA;
	const pinholeRadius = starRadius;

	const morphNormX = lerp(stereoNormX, pinholeNormX, blend);
	const morphNormY = lerp(stereoNormY, pinholeNormY, blend);
	const morphSdf = lerp(stereoSdf, pinholeSdf, blend);
	const visibility =
		1 - smoothstep(VISIBILITY_SMOOTHSTEP_INNER, VISIBILITY_SMOOTHSTEP_OUTER, morphSdf);
	return {
		px: morphNormX * params.morphHalfWidth,
		py: -morphNormY * params.morphHalfHeight,
		visibility,
		stereoAlpha,
		stereoRadius,
		pinholeAlpha,
		pinholeRadius
	};
}

// Pinhole star position depends only on (horizontalFov, viewportWidth) on x and on
// the same pair on y too (viewportHeight cancels in py = vy/vz / tan(verticalFov/2) * H/2
// because tan(verticalFov/2) = tan(horizontalFov/2) * H / W).
// To keep stars fixed when resizing the frame width, we must hold
// viewportWidth / tan(horizontalFov/2) constant. Height can change freely (only
// reveals/hides stars above and below).
export interface PinholeWidthResize {
	pinholeFovDeg: number;
	pinholeAspectRatio: number;
}

export function resizePinholeWidthKeepStars(
	currentFovDeg: number,
	currentAspectRatio: number,
	currentHeightFrac: number,
	newWidthFrac: number,
	clampFov: (fov: number) => number,
	clampAspect: (aspect: number) => number
): PinholeWidthResize {
	const oldWidthFrac = currentAspectRatio * currentHeightFrac;
	const widthRatio = newWidthFrac / Math.max(oldWidthFrac, EPSILON);
	const currentTanHalf = Math.tan((currentFovDeg * Math.PI) / 360);
	const newTanHalf = currentTanHalf * widthRatio;
	const newFovRad = 2 * Math.atan(newTanHalf);
	const newFovDeg = clampFov((newFovRad * 180) / Math.PI);
	// After fov clamp the invariant may be broken; recover by recomputing widthFrac
	// from the actually-applied fov so stars truly stay fixed.
	const actualTanHalf = Math.tan((newFovDeg * Math.PI) / 360);
	const actualWidthFrac = oldWidthFrac * (actualTanHalf / Math.max(currentTanHalf, EPSILON));
	const actualAspectRatio = clampAspect(actualWidthFrac / Math.max(currentHeightFrac, EPSILON));
	return { pinholeFovDeg: newFovDeg, pinholeAspectRatio: actualAspectRatio };
}

// Central-scale match: stars near the projection axis stay put when switching
// projections. Equating dr/dθ at θ=0 gives tan(fov_p/2) = 2·tan(fov_s/4).
// Result is clamped to each mode's allowed fov range.
export function stereoFovToPinholeFov(stereoFovDeg: number): number {
	const stereoRad = (stereoFovDeg * Math.PI) / 180;
	const pinholeRad = 2 * Math.atan(2 * Math.tan(stereoRad * 0.25));
	const pinholeDeg = (pinholeRad * 180) / Math.PI;
	return clamp(pinholeDeg, MIN_FOV_DEG_PINHOLE, MAX_FOV_DEG_PINHOLE);
}

export function pinholeFovToStereoFov(pinholeFovDeg: number): number {
	const pinholeRad = (pinholeFovDeg * Math.PI) / 180;
	const stereoRad = 4 * Math.atan(Math.tan(pinholeRad * 0.5) * 0.5);
	const stereoDeg = (stereoRad * 180) / Math.PI;
	return clamp(stereoDeg, MIN_FOV_DEG_STEREO, MAX_FOV_DEG_STEREO);
}
