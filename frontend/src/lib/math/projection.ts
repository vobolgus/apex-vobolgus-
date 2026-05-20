import { clamp, lerp, smoothstep } from './easing';

const EPSILON = 1e-7;

// === Star rendering coefficients (stereographic) ===
const STEREO_STAR_MIN_ALPHA = 0.38;
const STEREO_STAR_ALPHA_MAG_DIVISOR = 8;
const STEREO_STAR_MIN_RADIUS_PX = 0.45;
const STEREO_STAR_BASE_RADIUS_PX = 3.5;
const STEREO_STAR_MAG_RADIUS_COEFF = 0.4;

// === Star rendering coefficients (pinhole) ===
const PINHOLE_STAR_MIN_ALPHA = 0.35;
const PINHOLE_STAR_ALPHA_MAG_DIVISOR = 8;
const PINHOLE_STAR_MIN_RADIUS_PX = 0.4;
const PINHOLE_STAR_BASE_RADIUS_PX = 3.4;
const PINHOLE_STAR_MAG_RADIUS_COEFF = 0.38;

// === Projection geometry ===
const PROJECTION_NORM_CLAMP = 1.8;
const PROJECTION_INFINITE_SDF = 1.5;
const PROJECTION_FINITE_EPSILON = 0.0001;

// === Visibility / SDF ===
const VISIBILITY_SMOOTHSTEP_INNER = -0.08;
const VISIBILITY_SMOOTHSTEP_OUTER = 0.08;

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
	fovDeg: number
): ProjectionFrameParams {
	const radius = Math.min(width, height) * 0.46;
	const pinholeViewportWidth = radius * 1.9;
	const pinholeViewportHeight = radius * 1.18;
	const stereoViewportWidth = radius * 2;
	const stereoViewportHeight = radius * 2;
	const normalizedScaleT = clamp(scaleT, 0, 1);
	const morphViewportWidth = lerp(stereoViewportWidth, pinholeViewportWidth, normalizedScaleT);
	const morphViewportHeight = lerp(stereoViewportHeight, pinholeViewportHeight, normalizedScaleT);
	const morphHalfWidth = morphViewportWidth * 0.5;
	const morphHalfHeight = morphViewportHeight * 0.5;
	const horizontalFovRad = (fovDeg * Math.PI) / 180;
	const tanHalfHorizontalFov = Math.tan(horizontalFovRad * 0.5);
	const morphAspect = morphViewportWidth / Math.max(1, morphViewportHeight);
	const tanHalfVerticalFov = tanHalfHorizontalFov / Math.max(morphAspect, EPSILON);
	return {
		radius,
		pinholeViewportWidth,
		pinholeViewportHeight,
		morphViewportWidth,
		morphViewportHeight,
		morphHalfWidth,
		morphHalfHeight,
		tanHalfHorizontalFov,
		tanHalfVerticalFov
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
	const stereoNormXRaw = stereoFinite ? vx / denom : 0;
	const stereoNormYRaw = stereoFinite ? vy / denom : 0;
	const stereoNormX = clamp(stereoNormXRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const stereoNormY = clamp(stereoNormYRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const stereoNormHypot = Math.hypot(stereoNormXRaw, stereoNormYRaw);
	const stereoInsideDisk = stereoFinite && vz >= 0 && stereoNormHypot <= 1;
	const stereoSdf = stereoInsideDisk ? stereoNormHypot - 1 : PROJECTION_INFINITE_SDF;
	const stereoAlpha = Math.max(STEREO_STAR_MIN_ALPHA, 1 - star.v_mag / STEREO_STAR_ALPHA_MAG_DIVISOR);
	const stereoRadius = Math.max(
		STEREO_STAR_MIN_RADIUS_PX,
		STEREO_STAR_BASE_RADIUS_PX - star.v_mag * STEREO_STAR_MAG_RADIUS_COEFF
	);

	const pinholeFinite = vz > PROJECTION_FINITE_EPSILON;
	const pinholeNormXRaw = pinholeFinite ? vx / vz / params.tanHalfHorizontalFov : 0;
	const pinholeNormYRaw = pinholeFinite ? vy / vz / params.tanHalfVerticalFov : 0;
	const pinholeNormX = clamp(pinholeNormXRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const pinholeNormY = clamp(pinholeNormYRaw, -PROJECTION_NORM_CLAMP, PROJECTION_NORM_CLAMP);
	const pinholeSdf = pinholeFinite
		? Math.max(Math.abs(pinholeNormXRaw), Math.abs(pinholeNormYRaw)) - 1
		: PROJECTION_INFINITE_SDF;
	const pinholeAlpha = Math.max(PINHOLE_STAR_MIN_ALPHA, 1 - star.v_mag / PINHOLE_STAR_ALPHA_MAG_DIVISOR);
	const pinholeRadius = Math.max(
		PINHOLE_STAR_MIN_RADIUS_PX,
		PINHOLE_STAR_BASE_RADIUS_PX - star.v_mag * PINHOLE_STAR_MAG_RADIUS_COEFF
	);

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
