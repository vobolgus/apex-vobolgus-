import { describe, expect, it } from 'vitest';
import type { ChartLayers, ChartView } from '$lib/api/render-config';
import {
	CHART_RADIUS_FRAC,
	MAX_FOV_DEG_PINHOLE,
	MIN_FOV_DEG_STEREO,
	PINHOLE_ASPECT_RATIO_MAX
} from '$lib/constants';
import { orientationToPointing, pointingToOrientation } from '$lib/math/pointing';
import { applySharedView, decodeViewHash, encodeViewHash } from './view-url';

const ORION = pointingToOrientation({ raDeg: 83.822, decDeg: -5.391, paDeg: 15 });

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: ORION,
	stereoFovDeg: 60,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 1.6,
	pinholeHeightFrac: 1.18
};

const NO_LAYERS: ChartLayers = {
	constellations: false,
	constellationBoundaries: false,
	equator: false,
	ecliptic: false,
	galacticEquator: false,
	planets: false
};

describe('encodeViewHash', () => {
	it('writes the stereo view as its centre, the angle of its top and its field of view', () => {
		expect(encodeViewHash(VIEW, NO_LAYERS)).toBe('p=stereo&ra=83.822&dec=-5.391&pa=15&fov=60');
	});

	it('adds the frame for pinhole, with the pinhole field of view', () => {
		expect(encodeViewHash({ ...VIEW, projection: 'pinhole' }, NO_LAYERS)).toBe(
			'p=pinhole&ra=83.822&dec=-5.391&pa=15&fov=100&ar=1.6&size=1.18'
		);
	});

	it('lists the layers that are on', () => {
		const layers = { ...NO_LAYERS, constellations: true, ecliptic: true, planets: true };
		expect(encodeViewHash(VIEW, layers)).toMatch(/&layers=lines,ecliptic,planets$/);
	});
});

describe('decodeViewHash', () => {
	it('ignores a fragment that is not a view', () => {
		expect(decodeViewHash('')).toBeNull();
		expect(decodeViewHash('#about')).toBeNull();
		expect(decodeViewHash('#fov=40&layers=lines')).toBeNull();
		expect(decodeViewHash('#p=fisheye&ra=abc&dec=1')).toBeNull();
	});

	it('reads what it wrote, with or without the #', () => {
		const layers = { ...NO_LAYERS, constellationBoundaries: true, galacticEquator: true };
		for (const projection of ['stereographic', 'pinhole'] as const) {
			const view = { ...VIEW, projection };
			const hash = encodeViewHash(view, layers);
			for (const text of [hash, `#${hash}`]) {
				const shared = decodeViewHash(text);
				expect(shared).not.toBeNull();
				expect(shared!.layers).toEqual(layers);
				const back = applySharedView({ ...VIEW, orientation: { x: 0, y: 0, z: 0, w: 1 } }, shared!);
				// The fragment is the fixed point: what was read writes the same address.
				expect(encodeViewHash(back, shared!.layers)).toBe(hash);
			}
		}
	});

	it('turns every layer off when the fragment names none', () => {
		expect(decodeViewHash('#p=stereo')!.layers).toEqual(NO_LAYERS);
		expect(decodeViewHash('#p=stereo&layers=bogus,ecliptic')!.layers).toEqual({
			...NO_LAYERS,
			ecliptic: true
		});
	});

	it('takes north up when the position angle is missing', () => {
		const shared = decodeViewHash('#ra=10&dec=20')!;
		expect(shared.projection).toBeUndefined();
		const pointing = orientationToPointing(shared.orientation!);
		expect(pointing.raDeg).toBeCloseTo(10, 6);
		expect(pointing.decDeg).toBeCloseTo(20, 6);
		expect(pointing.paDeg).toBeCloseTo(0, 6);
	});
});

describe('applySharedView', () => {
	it('keeps what the fragment does not name', () => {
		const next = applySharedView(VIEW, decodeViewHash('#p=pinhole')!);
		expect(next).toEqual({ ...VIEW, projection: 'pinhole' });
	});

	it('gives the field of view to the projection the chart ends up in', () => {
		expect(applySharedView(VIEW, decodeViewHash('#ra=1&dec=2&fov=45')!).stereoFovDeg).toBe(45);
		const pinhole = applySharedView(VIEW, decodeViewHash('#p=pinhole&fov=45')!);
		expect(pinhole.pinholeFovDeg).toBe(45);
		expect(pinhole.stereoFovDeg).toBe(VIEW.stereoFovDeg);
	});

	it('clamps numbers to what the controls reach', () => {
		expect(applySharedView(VIEW, decodeViewHash('#p=stereo&fov=1')!).stereoFovDeg).toBe(
			MIN_FOV_DEG_STEREO
		);
		const pinhole = applySharedView(VIEW, decodeViewHash('#p=pinhole&fov=999&ar=99&size=99')!);
		expect(pinhole.pinholeFovDeg).toBe(MAX_FOV_DEG_PINHOLE);
		expect(pinhole.pinholeAspectRatio).toBe(PINHOLE_ASPECT_RATIO_MAX);
		// As wide as the chart surface, no wider.
		expect(pinhole.pinholeAspectRatio * pinhole.pinholeHeightFrac).toBeCloseTo(
			1 / CHART_RADIUS_FRAC,
			9
		);
	});

	it('clamps a declination past the pole', () => {
		const shared = decodeViewHash('#ra=0&dec=120')!;
		expect(orientationToPointing(shared.orientation!).decDeg).toBeCloseTo(90, 6);
	});
});
