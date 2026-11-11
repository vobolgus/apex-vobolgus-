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
import { getProjectionFrameParams, sampleStarMorphFrame, toViewSpace } from '../math/projection';
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
	if (starVectors.length < 2) {
		for (let i = 1; i < PERCEPTUAL_LUT_POINTS; i += 1) {
			cumulative[i] = i / (PERCEPTUAL_LUT_POINTS - 1);
		}
		return cumulative;
	}

	const step = Math.max(1, Math.ceil(starVectors.length / PERCEPTUAL_SAMPLE_TARGET));
	const sampledIndices: number[] = [];
	for (let i = 0; i < starVectors.length; i += step) {
		sampledIndices.push(i);
	}

	const rotateVector = (x: number, y: number, z: number) => toViewSpace(x, y, z, orientation);

	const prevPx = new Array<number>(sampledIndices.length).fill(0);
	const prevPy = new Array<number>(sampledIndices.length).fill(0);
	const prevVisibility = new Array<number>(sampledIndices.length).fill(0);
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

		if (i === 0) {
			for (let sampleIndex = 0; sampleIndex < sampledIndices.length; sampleIndex += 1) {
				const sample = sampleStarMorphFrame(
					starVectors[sampledIndices[sampleIndex]],
					blend,
					params,
					rotateVector
				);
				prevPx[sampleIndex] = sample.px;
				prevPy[sampleIndex] = sample.py;
				prevVisibility[sampleIndex] = sample.visibility;
			}
			prevArea = area;
			continue;
		}

		let motionSum = 0;
		let motionWeight = 0;
		let visibilityChangeSum = 0;
		for (let sampleIndex = 0; sampleIndex < sampledIndices.length; sampleIndex += 1) {
			const sample = sampleStarMorphFrame(
				starVectors[sampledIndices[sampleIndex]],
				blend,
				params,
				rotateVector
			);
			const visibilityWeight = Math.min(prevVisibility[sampleIndex], sample.visibility);
			if (visibilityWeight > VISIBILITY_CULL_THRESHOLD) {
				const dx = sample.px - prevPx[sampleIndex];
				const dy = sample.py - prevPy[sampleIndex];
				motionSum += Math.hypot(dx, dy) * visibilityWeight;
				motionWeight += visibilityWeight;
			}
			visibilityChangeSum += Math.abs(sample.visibility - prevVisibility[sampleIndex]);
			prevPx[sampleIndex] = sample.px;
			prevPy[sampleIndex] = sample.py;
			prevVisibility[sampleIndex] = sample.visibility;
		}

		const avgMotion = motionWeight > EPSILON ? motionSum / motionWeight : 0;
		const avgVisibilityChange = visibilityChangeSum / sampledIndices.length;
		const areaChange = Math.abs(area - prevArea);
		const frameEnergy =
			avgMotion +
			PERCEPTUAL_VISIBILITY_WEIGHT * avgVisibilityChange +
			PERCEPTUAL_AREA_WEIGHT * areaChange;

		cumulative[i] = cumulative[i - 1] + Math.max(frameEnergy, EPSILON);
		prevArea = area;
	}

	const total = cumulative[cumulative.length - 1];
	if (total > EPSILON) {
		for (let i = 0; i < cumulative.length; i += 1) {
			cumulative[i] /= total;
		}
	} else {
		for (let i = 1; i < cumulative.length; i += 1) {
			cumulative[i] = i / (cumulative.length - 1);
		}
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
