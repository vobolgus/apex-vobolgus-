import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_FOV_DEG_STEREO, PINHOLE_FOV_DEG_DEFAULT } from '$lib/constants';
import { pinholeFovToStereoFov, stereoFovToPinholeFov } from '$lib/math/projection';
import { view } from '$lib/stores.svelte';
import { ProjectionTransition } from './projection-transition.svelte';

describe('ProjectionTransition field of view carry', () => {
	beforeEach(() => {
		view.stereoFovDeg = MAX_FOV_DEG_STEREO;
		view.pinholeFovDeg = PINHOLE_FOV_DEG_DEFAULT;
	});

	it('opens pinhole from the full sky at the default, leaving room to widen the frame', () => {
		const projection = new ProjectionTransition();
		projection.start('pinhole');
		// The central-scale match alone would give 2·atan(2) ≈ 127°, past the 120° cap.
		expect(view.pinholeFovDeg).toBe(PINHOLE_FOV_DEG_DEFAULT);
	});

	it('matches the central scale when it fits under the cap', () => {
		view.stereoFovDeg = 90;
		const projection = new ProjectionTransition();
		projection.start('pinhole');
		expect(view.pinholeFovDeg).toBeCloseTo(stereoFovToPinholeFov(90), 9);
	});

	it('comes straight back to the view it left, both ways', () => {
		const projection = new ProjectionTransition();
		projection.start('pinhole');
		projection.start('stereographic');
		expect(view.stereoFovDeg).toBe(MAX_FOV_DEG_STEREO);
		projection.start('pinhole');
		expect(view.pinholeFovDeg).toBe(PINHOLE_FOV_DEG_DEFAULT);
	});

	it('converts again once the field of view was changed in between', () => {
		const projection = new ProjectionTransition();
		projection.start('pinhole');
		view.pinholeFovDeg = 60;
		projection.start('stereographic');
		expect(view.stereoFovDeg).toBeCloseTo(pinholeFovToStereoFov(60), 9);
	});

	it('leaves the field of view alone when the mode does not change', () => {
		const projection = new ProjectionTransition();
		view.stereoFovDeg = 120;
		projection.start('stereographic');
		expect(view.stereoFovDeg).toBe(120);
		expect(view.pinholeFovDeg).toBe(PINHOLE_FOV_DEG_DEFAULT);
	});
});
