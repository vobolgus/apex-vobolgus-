import { describe, expect, it } from 'vitest';
import { MAX_FOV_DEG_STEREO } from '$lib/constants';
import { toViewSpace, viewBasis } from '$lib/math/projection';
import { normalizeQuaternion } from '$lib/math/quaternion';
import { buildRenderConfig, chartSizePx, type ChartView } from './render-config';

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: { x: 0, y: 0, z: 0, w: 1 },
	stereoFovDeg: MAX_FOV_DEG_STEREO,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 16 / 9,
	pinholeHeightFrac: 1
};

const LAYERS = {
	constellations: true,
	constellationBoundaries: true,
	equator: false,
	ecliptic: true,
	galacticEquator: false,
	planets: true
};

describe('buildRenderConfig', () => {
	it('sends the stereo disc at the preview size, with no observer', () => {
		const config = buildRenderConfig(VIEW, LAYERS, new Date('2026-10-27T12:00:00Z'));
		expect(config.projection).toBe('stereo');
		expect(config.fov_deg).toBe(180);
		expect(config.datetime).toBe('2026-10-27T12:00:00.000Z');
		expect(config.view.width).toBeCloseTo(1104, 9);
		expect(config.view.height).toBeCloseTo(1104, 9);
		expect(config).not.toHaveProperty('latitude');
	});

	it('sends the pinhole frame and its horizontal fov', () => {
		const config = buildRenderConfig({ ...VIEW, projection: 'pinhole' }, LAYERS, new Date(0));
		expect(config.projection).toBe('pinhole');
		expect(config.fov_deg).toBe(100);
		expect(config.view.height).toBeCloseTo(552, 9);
		expect(config.view.width).toBeCloseTo(552 * (16 / 9), 9);
		expect(chartSizePx({ ...VIEW, projection: 'pinhole' })).toEqual({
			width: config.view.width,
			height: config.view.height
		});
	});

	it('maps every preview layer, and only those', () => {
		const { layers } = buildRenderConfig(VIEW, LAYERS, new Date(0));
		expect(layers).toEqual({
			ecliptic: true,
			equator: false,
			galactic_equator: false,
			planets: true,
			horizontal_grid: false,
			equatorial_grid: false,
			constellations: true,
			constellation_boundaries: true,
			constellation_names: false,
			zenith: false,
			poles: false
		});
	});
});

describe('viewBasis', () => {
	it('is the map the preview projects with', () => {
		const q = normalizeQuaternion({ x: 0.2, y: -0.4, z: 0.7, w: 0.5 });
		const { right, up, forward } = viewBasis(q);
		const sky: [number, number, number] = [0.48, -0.6, 0.64];
		const dot = (a: number[]) => a[0] * sky[0] + a[1] * sky[1] + a[2] * sky[2];
		const [vx, vy, vz] = toViewSpace(...sky, q);
		expect(dot(right)).toBeCloseTo(vx, 12);
		expect(dot(up)).toBeCloseTo(vy, 12);
		expect(dot(forward)).toBeCloseTo(vz, 12);
	});

	it('reads the sky from the ground: right is up × forward flipped', () => {
		const { right, up, forward } = viewBasis({ x: 0, y: 0, z: 0, w: 1 });
		// `+ 0` turns the -0 of the flip into 0.
		expect(right.map((v) => v + 0)).toEqual([-1, 0, 0]);
		expect(up.map((v) => v + 0)).toEqual([0, 1, 0]);
		expect(forward.map((v) => v + 0)).toEqual([0, 0, 1]);
	});
});
