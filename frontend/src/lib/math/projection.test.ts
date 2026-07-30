import { describe, expect, it } from 'vitest';

import {
	getProjectionFrameParams,
	pinholeFovToStereoFov,
	resizePinholeWidthKeepStars,
	sampleStarMorphFrame,
	stereoFovToPinholeFov
} from './projection';

const IDENTITY_ROTATE = (x: number, y: number, z: number) => [x, y, z] as const;

const ASPECT_DEFAULT = 1.9 / 1.18;
const HEIGHT_FRAC_DEFAULT = 1.18;

describe('getProjectionFrameParams', () => {
	it('blend=0 produces a circular stereo viewport', () => {
		const p = getProjectionFrameParams(800, 600, 0, 180, 100, ASPECT_DEFAULT, HEIGHT_FRAC_DEFAULT);
		expect(p.radius).toBeGreaterThan(0);
		expect(p.morphViewportWidth).toBeCloseTo(p.morphViewportHeight, 6);
	});

	it('blend=1 produces a rectangular pinhole viewport', () => {
		const p = getProjectionFrameParams(800, 600, 1, 180, 60, ASPECT_DEFAULT, HEIGHT_FRAC_DEFAULT);
		expect(p.pinholeViewportWidth).toBeGreaterThan(0);
		expect(p.pinholeViewportHeight).toBeGreaterThan(0);
	});

	it('pinhole viewport dimensions follow aspect and height frac', () => {
		const p = getProjectionFrameParams(800, 600, 1, 180, 60, 2.0, 1.0);
		expect(p.pinholeViewportHeight).toBeCloseTo(p.radius * 1.0, 5);
		expect(p.pinholeViewportWidth).toBeCloseTo(p.radius * 2.0, 5);
	});

	it('tanHalfHorizontalFov derives from pinhole fov only', () => {
		const p = getProjectionFrameParams(800, 600, 1, 180, 60, ASPECT_DEFAULT, HEIGHT_FRAC_DEFAULT);
		expect(p.tanHalfHorizontalFov).toBeCloseTo(Math.tan(((60 / 2) * Math.PI) / 180), 6);
	});

	it('stereo fov does not affect pinhole tan', () => {
		const wide = getProjectionFrameParams(
			800,
			600,
			1,
			180,
			60,
			ASPECT_DEFAULT,
			HEIGHT_FRAC_DEFAULT
		);
		const narrow = getProjectionFrameParams(
			800,
			600,
			1,
			20,
			60,
			ASPECT_DEFAULT,
			HEIGHT_FRAC_DEFAULT
		);
		expect(wide.tanHalfHorizontalFov).toBeCloseTo(narrow.tanHalfHorizontalFov, 6);
	});

	it('pinhole fov does not affect stereoScale', () => {
		const a = getProjectionFrameParams(800, 600, 0, 90, 60, ASPECT_DEFAULT, HEIGHT_FRAC_DEFAULT);
		const b = getProjectionFrameParams(800, 600, 0, 90, 120, ASPECT_DEFAULT, HEIGHT_FRAC_DEFAULT);
		expect(a.stereoScale).toBeCloseTo(b.stereoScale, 6);
	});

	it('stereoScale = 1 at stereoFov=180° (half-sky fills disk)', () => {
		const p = getProjectionFrameParams(800, 600, 0, 180, 100, ASPECT_DEFAULT, HEIGHT_FRAC_DEFAULT);
		expect(p.stereoScale).toBeCloseTo(1, 6);
	});

	it('stereoScale > 1 at narrower stereoFov (zoom in)', () => {
		const p = getProjectionFrameParams(800, 600, 0, 90, 100, ASPECT_DEFAULT, HEIGHT_FRAC_DEFAULT);
		expect(p.stereoScale).toBeCloseTo(1 / Math.tan(Math.PI / 8), 6);
		expect(p.stereoScale).toBeGreaterThan(1);
	});
});

describe('sampleStarMorphFrame', () => {
	const params = getProjectionFrameParams(
		800,
		600,
		0,
		180,
		100,
		ASPECT_DEFAULT,
		HEIGHT_FRAC_DEFAULT
	);
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

	it('brighter stars have larger radius (formula: max(MIN, BASE - COEFF * v_mag))', () => {
		const bright = sampleStarMorphFrame({ x: 0, y: 0, z: 1, v_mag: 0 }, 0, params, IDENTITY_ROTATE);
		const dim = sampleStarMorphFrame({ x: 0, y: 0, z: 1, v_mag: 6 }, 0, params, IDENTITY_ROTATE);
		expect(bright.stereoRadius).toBeGreaterThan(dim.stereoRadius);
		expect(bright.stereoRadius).toBeCloseTo(4.0, 5);
		expect(bright.pinholeRadius).toBeCloseTo(4.0, 5);
		expect(dim.stereoRadius).toBeCloseTo(0.5, 5);
		expect(bright.stereoAlpha).toBe(1);
		expect(dim.stereoAlpha).toBe(1);
	});

	it('stereo and pinhole star sizes are identical (unified legacy formula)', () => {
		const star = sampleStarMorphFrame({ x: 0, y: 0, z: 1, v_mag: 3 }, 0, params, IDENTITY_ROTATE);
		expect(star.stereoRadius).toBe(star.pinholeRadius);
		expect(star.stereoAlpha).toBe(star.pinholeAlpha);
	});
});

describe('central-scale fov matching', () => {
	function centralScaleStereo(stereoFovDeg: number) {
		const r = (stereoFovDeg * Math.PI) / 180;
		return 1 / (2 * Math.tan(r * 0.25));
	}
	function centralScalePinhole(pinholeFovDeg: number) {
		const r = (pinholeFovDeg * Math.PI) / 180;
		return 1 / Math.tan(r * 0.5);
	}

	it('matches central scale within clamp range (stereo→pinhole)', () => {
		for (const stereoFov of [40, 60, 90, 120]) {
			const pinholeFov = stereoFovToPinholeFov(stereoFov);
			expect(centralScaleStereo(stereoFov)).toBeCloseTo(centralScalePinhole(pinholeFov), 6);
		}
	});

	it('matches central scale within clamp range (pinhole→stereo)', () => {
		for (const pinholeFov of [40, 60, 90, 110]) {
			const stereoFov = pinholeFovToStereoFov(pinholeFov);
			expect(centralScalePinhole(pinholeFov)).toBeCloseTo(centralScaleStereo(stereoFov), 6);
		}
	});

	it('produces close-to-equivalent pinhole fov for wide stereo fov', () => {
		expect(stereoFovToPinholeFov(180)).toBeLessThanOrEqual(120);
		expect(stereoFovToPinholeFov(180)).toBeGreaterThanOrEqual(120);
	});

	it('is an involution within unclamped range', () => {
		const stereoFov = 80;
		const pinholeFov = stereoFovToPinholeFov(stereoFov);
		const roundTrip = pinholeFovToStereoFov(pinholeFov);
		expect(roundTrip).toBeCloseTo(stereoFov, 5);
	});
});

describe('resizePinholeWidthKeepStars', () => {
	const FOV_LIMITS: [number, number] = [20, 120];
	const ASPECT_LIMITS: [number, number] = [0.4, 3.5];
	const clampFov = (v: number) => Math.max(FOV_LIMITS[0], Math.min(FOV_LIMITS[1], v));
	const clampAspect = (v: number) => Math.max(ASPECT_LIMITS[0], Math.min(ASPECT_LIMITS[1], v));

	it('keeps stars fixed when resizing pinhole width (unclamped)', () => {
		const startFov = 60;
		const startAspect = 1.6;
		const startHeightFrac = 1.0;
		const startWidthFrac = startAspect * startHeightFrac;
		const newWidthFrac = startWidthFrac * 1.4;
		const { pinholeFovDeg, pinholeAspectRatio } = resizePinholeWidthKeepStars(
			startFov,
			startAspect,
			startHeightFrac,
			newWidthFrac,
			clampFov,
			clampAspect
		);
		const sample = (fov: number, aspect: number, heightFrac: number) => {
			const params = getProjectionFrameParams(800, 600, 1, 180, fov, aspect, heightFrac);
			return sampleStarMorphFrame(
				{ x: 0.3, y: 0.2, z: 0.93, v_mag: 0 },
				1,
				params,
				(x, y, z) => [x, y, z] as const
			);
		};
		const before = sample(startFov, startAspect, startHeightFrac);
		const after = sample(pinholeFovDeg, pinholeAspectRatio, startHeightFrac);
		expect(after.px).toBeCloseTo(before.px, 4);
		expect(after.py).toBeCloseTo(before.py, 4);
	});

	it('recovers invariant after fov clamp (stars stay fixed up to clamp limit)', () => {
		const startFov = 100;
		const startAspect = 1.6;
		const startHeightFrac = 1.0;
		const aggressiveNewWidthFrac = startAspect * startHeightFrac * 5;
		const { pinholeFovDeg, pinholeAspectRatio } = resizePinholeWidthKeepStars(
			startFov,
			startAspect,
			startHeightFrac,
			aggressiveNewWidthFrac,
			clampFov,
			clampAspect
		);
		expect(pinholeFovDeg).toBeLessThanOrEqual(FOV_LIMITS[1]);
		const ratio =
			(pinholeAspectRatio * startHeightFrac) / Math.tan((pinholeFovDeg * Math.PI) / 360);
		const refRatio = (startAspect * startHeightFrac) / Math.tan((startFov * Math.PI) / 360);
		expect(ratio).toBeCloseTo(refRatio, 4);
	});
});
