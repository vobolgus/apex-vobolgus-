import { describe, expect, it } from 'vitest';

import { getProjectionFrameParams, sampleStarMorphFrame } from './projection';

const IDENTITY_ROTATE = (x: number, y: number, z: number) => [x, y, z] as const;

describe('getProjectionFrameParams', () => {
	it('blend=0 produces a circular stereo viewport', () => {
		const p = getProjectionFrameParams(800, 600, 0, 100);
		expect(p.radius).toBeGreaterThan(0);
		expect(p.morphViewportWidth).toBeCloseTo(p.morphViewportHeight, 6);
	});

	it('blend=1 produces a rectangular pinhole viewport', () => {
		const p = getProjectionFrameParams(800, 600, 1, 60);
		expect(p.pinholeViewportWidth).toBeGreaterThan(0);
		expect(p.pinholeViewportHeight).toBeGreaterThan(0);
	});

	it('tanHalfHorizontalFov matches the fov_deg input', () => {
		const p = getProjectionFrameParams(800, 600, 1, 60);
		expect(p.tanHalfHorizontalFov).toBeCloseTo(Math.tan(((60 / 2) * Math.PI) / 180), 6);
	});
});

describe('sampleStarMorphFrame', () => {
	const params = getProjectionFrameParams(800, 600, 0, 100);
	const ZENITH_STAR = { x: 0, y: 0, z: 1, v_mag: 0 };
	const NADIR_STAR = { x: 0, y: 0, z: -1, v_mag: 0 };

	it('zenith star at stereo blend is fully visible', () => {
		const s = sampleStarMorphFrame(ZENITH_STAR, 0, params, IDENTITY_ROTATE);
		expect(s.visibility).toBeGreaterThan(0.99);
		expect(s.px).toBeCloseTo(0, 5);
		expect(s.py).toBeCloseTo(0, 5);
	});

	it('nadir star is invisible at stereo', () => {
		const s = sampleStarMorphFrame(NADIR_STAR, 0, params, IDENTITY_ROTATE);
		expect(s.visibility).toBeLessThan(0.01);
	});

	it('star magnitudes affect radius/alpha linearly', () => {
		const bright = sampleStarMorphFrame({ x: 0, y: 0, z: 1, v_mag: 0 }, 0, params, IDENTITY_ROTATE);
		const dim = sampleStarMorphFrame({ x: 0, y: 0, z: 1, v_mag: 6 }, 0, params, IDENTITY_ROTATE);
		expect(bright.stereoRadius).toBeGreaterThan(dim.stereoRadius);
		expect(bright.stereoAlpha).toBeGreaterThan(dim.stereoAlpha);
	});
});
