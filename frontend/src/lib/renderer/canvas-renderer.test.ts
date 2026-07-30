import { describe, expect, it } from 'vitest';

import { easeInOutCubic } from '../math/easing';

import {
	getPerceptualBlendCumulative,
	getPerceptualProjectionBlend,
	getProjectionBlend
} from './canvas-renderer';
import type { ProjectionAnimationState } from './types';

describe('getProjectionBlend', () => {
	it('returns the starting blend at animation start', () => {
		const animation: ProjectionAnimationState = {
			animating: true,
			from: 0.2,
			to: 0.8,
			startMs: 100,
			durationMs: 500
		};

		expect(getProjectionBlend(100, animation).blend).toBeCloseTo(0.2, 6);
	});

	it('returns the eased midpoint while animation is active', () => {
		const animation: ProjectionAnimationState = {
			animating: true,
			from: 0,
			to: 1,
			startMs: 0,
			durationMs: 1000
		};

		const tick = getProjectionBlend(250, animation);
		expect(tick.animating).toBe(true);
		expect(tick.blend).toBeCloseTo(easeInOutCubic(0.25), 6);
	});

	it('snaps to the target blend when animation completes', () => {
		const animation: ProjectionAnimationState = {
			animating: true,
			from: 0,
			to: 1,
			startMs: 0,
			durationMs: 1000
		};

		const tick = getProjectionBlend(1000, animation);
		expect(tick.animating).toBe(false);
		expect(tick.blend).toBe(1);
	});
});

describe('perceptual projection helpers', () => {
	const orientation = { x: 0, y: 0, z: 0, w: 1 };
	const starVectors = [
		{ x: 0, y: 0, z: 1, v_mag: 0 },
		{ x: 0.2, y: 0.1, z: 0.97, v_mag: 2 }
	];

	it('builds a normalized cumulative LUT', () => {
		const cumulative = getPerceptualBlendCumulative({
			width: 1200,
			height: 1200,
			stereoFovDeg: 180,
			pinholeFovDeg: 100,
			pinholeAspectRatio: 1.9 / 1.18,
			pinholeHeightFrac: 1.18,
			starVectors,
			orientation
		});

		expect(cumulative[0]).toBe(0);
		expect(cumulative.at(-1)).toBeCloseTo(1, 6);
		for (let i = 1; i < cumulative.length; i += 1) {
			expect(cumulative[i]).toBeGreaterThanOrEqual(cumulative[i - 1]);
		}
	});

	it('preserves exact endpoints for perceptual blend lookup', () => {
		const cumulative = getPerceptualBlendCumulative({
			width: 1200,
			height: 1200,
			stereoFovDeg: 180,
			pinholeFovDeg: 100,
			pinholeAspectRatio: 1.9 / 1.18,
			pinholeHeightFrac: 1.18,
			starVectors,
			orientation
		});

		expect(getPerceptualProjectionBlend(0, cumulative)).toBe(0);
		expect(getPerceptualProjectionBlend(1, cumulative)).toBe(1);
	});
});
