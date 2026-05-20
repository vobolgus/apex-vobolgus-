import type { Quaternion } from '../math/quaternion';
import type { StarVector } from '../math/projection';

export type MorphInterpolator = (t: number) => string;

export type MorphInterpolatorFactory = (
	fromShape: string,
	toShape: string,
	options?: { maxSegmentLength?: number }
) => MorphInterpolator;

export interface RenderState {
	orientation: Quaternion;
	fovDeg: number;
	starVectors: StarVector[];
	projectionBlend: number;
}

export interface ProjectionAnimationState {
	animating: boolean;
	from: number;
	to: number;
	startMs: number;
	durationMs: number;
}

export interface PerceptualCacheKey {
	width: number;
	height: number;
	fovDeg: number;
	starVectorsLen: number;
	orientation: Quaternion;
}

export interface ViewportCacheKey {
	cx: number;
	cy: number;
	radius: number;
	pinholeViewportWidth: number;
	pinholeViewportHeight: number;
	cornerRadius: number;
}

export interface ProjectionBlendTick {
	blend: number;
	animating: boolean;
}

export interface PerceptualBlendInput {
	width: number;
	height: number;
	fovDeg: number;
	starVectors: StarVector[];
	orientation: Quaternion;
}
