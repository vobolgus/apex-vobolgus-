import { describe, expect, it } from 'vitest';

import { easeInOutCubic } from '../math/easing';

import {
	getPerceptualBlendCumulative,
	getPerceptualProjectionBlend,
	getProjectionBlend,
	advanceStarFade,
	makeStarFade,
	STAR_FADE_MS
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

describe('advanceStarFade', () => {
	it('fades in the stars a frame brings, from none to all of them', () => {
		const fade = makeStarFade();
		advanceStarFade(fade, 500, 1000, false);
		expect(fade).toMatchObject({ count: 500, from: 0, progress: 0 });

		advanceStarFade(fade, 500, 1000 + STAR_FADE_MS / 2, false);
		expect(fade.progress).toBeGreaterThan(0.5);
		expect(fade.progress).toBeLessThan(1);

		advanceStarFade(fade, 500, 1000 + STAR_FADE_MS, false);
		expect(fade.progress).toBe(1);
	});

	it('fades in only the fainter stars when the full catalog replaces the bright one', () => {
		const fade = makeStarFade();
		advanceStarFade(fade, 500, 0, false);
		advanceStarFade(fade, 500, STAR_FADE_MS, false);
		expect(fade.progress).toBe(1);

		advanceStarFade(fade, 8870, 2000, false);
		// The 500 already on the chart stay as they are.
		expect(fade).toMatchObject({ count: 8870, from: 500, progress: 0 });
		advanceStarFade(fade, 8870, 2000 + STAR_FADE_MS, false);
		expect(fade.progress).toBe(1);
	});

	it('never goes backwards while it runs', () => {
		const fade = makeStarFade();
		advanceStarFade(fade, 100, 0, false);
		let last = fade.progress;
		for (let now = 16; now <= STAR_FADE_MS + 32; now += 16) {
			advanceStarFade(fade, 100, now, false);
			expect(fade.progress).toBeGreaterThanOrEqual(last);
			last = fade.progress;
		}
		expect(last).toBe(1);
	});

	it('shows the stars at once when the system asks for less motion, or when stars are taken away', () => {
		const reduced = makeStarFade();
		advanceStarFade(reduced, 500, 0, true);
		expect(reduced.progress).toBe(1);

		const fewer = makeStarFade();
		advanceStarFade(fewer, 500, 0, false);
		advanceStarFade(fewer, 100, 10, false);
		expect(fewer).toMatchObject({ count: 100, progress: 1 });
	});
});
