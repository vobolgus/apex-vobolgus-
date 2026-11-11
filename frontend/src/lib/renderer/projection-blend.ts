/**
 * The projection's morph between stereographic and pinhole: where it is at a
 * moment of its animation (`getProjectionBlend`), and the perceptual curve it is
 * drawn along, which spends the morph's time evenly over how much the stars
 * appear to move rather than over the raw blend.
 */

import {
	EPSILON,
	PERCEPTUAL_AREA_WEIGHT,
	PERCEPTUAL_BLEND_MIX,
	PERCEPTUAL_LUT_POINTS,
	PERCEPTUAL_SAMPLE_TARGET,
	PERCEPTUAL_VISIBILITY_WEIGHT,
	VISIBILITY_CULL_THRESHOLD
} from '../constants';
import { clamp, easeInOutCubic, lerp } from '../math/easing';
import {
	getProjectionFrameParams,
	sampleStarMorphFrame,
	toViewSpace,
	type ProjectionFrameParams,
	type StarVector
} from '../math/projection';
import type {
	PerceptualBlendInput,
	PerceptualCacheKey,
	ProjectionAnimationState,
	ProjectionBlendTick
} from './types';

/** Whether two views give the same perceptual curve, so the one cached for the first still holds. */
export function perceptualKeyEquals(a: PerceptualCacheKey, b: PerceptualCacheKey): boolean {
	return (
		a.width === b.width &&
		a.height === b.height &&
		a.stereoFovDeg === b.stereoFovDeg &&
		a.pinholeFovDeg === b.pinholeFovDeg &&
		a.pinholeAspectRatio === b.pinholeAspectRatio &&
		a.pinholeHeightFrac === b.pinholeHeightFrac &&
		a.starVectorsLen === b.starVectorsLen &&
		a.orientation.x === b.orientation.x &&
		a.orientation.y === b.orientation.y &&
		a.orientation.z === b.orientation.z &&
		a.orientation.w === b.orientation.w
	);
}

export function getProjectionBlend(
	nowMs: number,
	animation: ProjectionAnimationState,
	currentBlend = animation.to
): ProjectionBlendTick {
	if (!animation.animating) {
		return { blend: currentBlend, animating: false };
	}

	const t = clamp((nowMs - animation.startMs) / animation.durationMs, 0, 1);
	const eased = easeInOutCubic(t);
	const blend = lerp(animation.from, animation.to, eased);

	if (t >= 1) {
		return { blend: animation.to, animating: false };
	}

	return { blend, animating: true };
}

/** `cumulative` as even steps from 0 to 1: the raw blend, for want of stars to measure. */
function evenSteps(cumulative: number[]): number[] {
	for (let i = 1; i < cumulative.length; i += 1) {
		cumulative[i] = i / (cumulative.length - 1);
	}
	return cumulative;
}

/** The stars the curve is measured on, and where each was in the last frame measured. */
interface Samples {
	stars: StarVector[];
	px: number[];
	py: number[];
	visibility: number[];
}

/** Every `step`-th star, about `PERCEPTUAL_SAMPLE_TARGET` of them, none placed yet. */
function samplesOf(starVectors: readonly StarVector[]): Samples {
	const step = Math.max(1, Math.ceil(starVectors.length / PERCEPTUAL_SAMPLE_TARGET));
	const stars: StarVector[] = [];
	for (let i = 0; i < starVectors.length; i += step) {
		stars.push(starVectors[i]);
	}
	const none = () => new Array<number>(stars.length).fill(0);
	return { stars, px: none(), py: none(), visibility: none() };
}

/**
 * The samples moved to the frame at `blend`: how far a star stays seen moves on
 * average, weighted by how much it stays seen, and how much its visibility changes.
 */
function moveSamples(
	samples: Samples,
	blend: number,
	params: ProjectionFrameParams,
	rotateVector: (x: number, y: number, z: number) => [number, number, number]
): { motion: number; visibilityChange: number } {
	let motionSum = 0;
	let motionWeight = 0;
	let visibilityChangeSum = 0;
	for (let k = 0; k < samples.stars.length; k += 1) {
		const sample = sampleStarMorphFrame(samples.stars[k], blend, params, rotateVector);
		const visibilityWeight = Math.min(samples.visibility[k], sample.visibility);
		if (visibilityWeight > VISIBILITY_CULL_THRESHOLD) {
			const dx = sample.px - samples.px[k];
			const dy = sample.py - samples.py[k];
			motionSum += Math.hypot(dx, dy) * visibilityWeight;
			motionWeight += visibilityWeight;
		}
		visibilityChangeSum += Math.abs(sample.visibility - samples.visibility[k]);
		samples.px[k] = sample.px;
		samples.py[k] = sample.py;
		samples.visibility[k] = sample.visibility;
	}
	return {
		motion: motionWeight > EPSILON ? motionSum / motionWeight : 0,
		visibilityChange: visibilityChangeSum / samples.stars.length
	};
}

/**
 * The perceptual curve: at each of `PERCEPTUAL_LUT_POINTS` blends, the share of the
 * morph's whole apparent change made by then. A frame's change is how far the
 * sampled stars move, how much they fade in or out, and how much the viewport grows.
 */
export function getPerceptualBlendCumulative({
	width,
	height,
	stereoFovDeg,
	pinholeFovDeg,
	pinholeAspectRatio,
	pinholeHeightFrac,
	starVectors,
	orientation
}: PerceptualBlendInput): number[] {
	const cumulative = new Array<number>(PERCEPTUAL_LUT_POINTS).fill(0);
	if (starVectors.length < 2) return evenSteps(cumulative);

	const samples = samplesOf(starVectors);
	const rotateVector = (x: number, y: number, z: number) => toViewSpace(x, y, z, orientation);
	let prevArea = 0;
	for (let i = 0; i < PERCEPTUAL_LUT_POINTS; i += 1) {
		const blend = i / (PERCEPTUAL_LUT_POINTS - 1);
		const params = getProjectionFrameParams(
			width,
			height,
			blend,
			stereoFovDeg,
			pinholeFovDeg,
			pinholeAspectRatio,
			pinholeHeightFrac
		);
		const area = params.morphViewportWidth * params.morphViewportHeight;
		// The first frame only places the samples: there is no change before it.
		const { motion, visibilityChange } = moveSamples(samples, blend, params, rotateVector);
		if (i > 0) {
			const frameEnergy =
				motion +
				PERCEPTUAL_VISIBILITY_WEIGHT * visibilityChange +
				PERCEPTUAL_AREA_WEIGHT * Math.abs(area - prevArea);
			cumulative[i] = cumulative[i - 1] + Math.max(frameEnergy, EPSILON);
		}
		prevArea = area;
	}

	const total = cumulative[cumulative.length - 1];
	if (!(total > EPSILON)) return evenSteps(cumulative);
	for (let i = 0; i < cumulative.length; i += 1) {
		cumulative[i] /= total;
	}
	return cumulative;
}

export function getPerceptualProjectionBlend(
	rawBlend: number,
	cumulative: readonly number[]
): number {
	const normalizedRawBlend = clamp(rawBlend, 0, 1);
	if (normalizedRawBlend <= 0) return 0;
	if (normalizedRawBlend >= 1) return 1;

	let perceptual = 1;
	for (let i = 1; i < cumulative.length; i += 1) {
		if (cumulative[i] < normalizedRawBlend) continue;
		const prev = cumulative[i - 1];
		const next = cumulative[i];
		const localT =
			Math.abs(next - prev) <= EPSILON ? 0 : (normalizedRawBlend - prev) / (next - prev);
		const prevBlend = (i - 1) / (cumulative.length - 1);
		const nextBlend = i / (cumulative.length - 1);
		perceptual = lerp(prevBlend, nextBlend, localT);
		break;
	}

	return lerp(normalizedRawBlend, perceptual, PERCEPTUAL_BLEND_MIX);
}
