import type { Quaternion } from '../math/quaternion';
import type { StarVector } from '../math/projection';
import type { ConstellationData } from '../stores.svelte';

export type MorphInterpolator = (t: number) => string;

export type MorphInterpolatorFactory = (
	fromShape: string,
	toShape: string,
	options?: { maxSegmentLength?: number }
) => MorphInterpolator;

export interface ReferenceLinesState {
	equator: boolean;
	ecliptic: boolean;
	galacticEquator: boolean;
	constellations: boolean;
	constellationBoundaries: boolean;
}

export interface RenderState {
	orientation: Quaternion;
	stereoFovDeg: number;
	pinholeFovDeg: number;
	pinholeAspectRatio: number;
	pinholeHeightFrac: number;
	starVectors: StarVector[];
	projectionBlend: number;
	referenceLines: ReferenceLinesState;
	constellations: ConstellationData[];
	constellationBoundaries: ConstellationData[];
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
	stereoFovDeg: number;
	pinholeFovDeg: number;
	pinholeAspectRatio: number;
	pinholeHeightFrac: number;
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
	stereoFovDeg: number;
	pinholeFovDeg: number;
	pinholeAspectRatio: number;
	pinholeHeightFrac: number;
	starVectors: StarVector[];
	orientation: Quaternion;
}
