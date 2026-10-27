/**
 * Cross-language drift guard for the view projection, like the reference-geometry one.
 *
 * The SVG/PDF export draws the preview's chart in Rust (`rust-core` ViewProjection)
 * from the basis and size this side sends. Both are pinned to the SAME fixture,
 * `backend/assets/golden/view-projection.json`: the preview pipeline must put each
 * sky point where the fixture says, and the basis sent to the backend must be the
 * fixture's. A Rust test checks the export against the same file.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildRenderConfig } from '$lib/api/render-config';
import { CHART_CANVAS_BACKING_PX } from '$lib/constants';
import {
	getProjectionFrameParams,
	sampleStarMorphFrame,
	toViewSpace,
	viewBasis
} from './projection';
import type { Quaternion } from './quaternion';

// Read off disk, not imported: see reference-geometry.golden.test.ts.
const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, '../../../../backend/assets/golden/view-projection.json');

type Vec3 = [number, number, number];

interface GoldenCase {
	name: string;
	projection: 'stereo' | 'pinhole';
	orientation: Quaternion;
	fov_deg: number;
	pinhole_aspect_ratio: number;
	pinhole_height_frac: number;
	right: Vec3;
	up: Vec3;
	forward: Vec3;
	width: number;
	height: number;
	points: { sky: Vec3; px: [number, number] }[];
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as {
	tolerance_px: number;
	cases: GoldenCase[];
};

function chartView(c: GoldenCase) {
	return {
		projection: c.projection === 'pinhole' ? ('pinhole' as const) : ('stereographic' as const),
		orientation: c.orientation,
		stereoFovDeg: c.projection === 'stereo' ? c.fov_deg : 180,
		pinholeFovDeg: c.projection === 'pinhole' ? c.fov_deg : 100,
		pinholeAspectRatio: c.pinhole_aspect_ratio,
		pinholeHeightFrac: c.pinhole_height_frac
	};
}

const NO_LAYERS = {
	constellations: false,
	constellationBoundaries: false,
	equator: false,
	ecliptic: false,
	galacticEquator: false,
	planets: false
};

describe('view projection golden', () => {
	it('has cases with points to check', () => {
		expect(golden.cases.length).toBeGreaterThanOrEqual(4);
		for (const c of golden.cases) expect(c.points.length).toBeGreaterThan(5);
	});

	for (const c of golden.cases) {
		it(`${c.name}: the preview puts every point where the fixture does`, () => {
			const view = chartView(c);
			const blend = c.projection === 'pinhole' ? 1 : 0;
			const params = getProjectionFrameParams(
				CHART_CANVAS_BACKING_PX,
				CHART_CANVAS_BACKING_PX,
				blend,
				view.stereoFovDeg,
				view.pinholeFovDeg,
				view.pinholeAspectRatio,
				view.pinholeHeightFrac
			);
			for (const { sky, px } of c.points) {
				const sample = sampleStarMorphFrame(
					{ x: sky[0], y: sky[1], z: sky[2], v_mag: 0 },
					blend,
					params,
					(x, y, z) => toViewSpace(x, y, z, c.orientation)
				);
				expect(Math.abs(c.width / 2 + sample.px - px[0])).toBeLessThanOrEqual(golden.tolerance_px);
				expect(Math.abs(c.height / 2 + sample.py - px[1])).toBeLessThanOrEqual(golden.tolerance_px);
			}
		});

		it(`${c.name}: the export is sent the fixture's camera`, () => {
			const config = buildRenderConfig(chartView(c), NO_LAYERS, new Date(0));
			expect(config.projection).toBe(c.projection);
			expect(config.fov_deg).toBe(c.fov_deg);
			expect(config.view.width).toBeCloseTo(c.width, 6);
			expect(config.view.height).toBeCloseTo(c.height, 6);
			const basis = viewBasis(c.orientation);
			for (const axis of ['right', 'up', 'forward'] as const) {
				for (let i = 0; i < 3; i += 1) {
					expect(config.view[axis][i]).toBeCloseTo(c[axis][i], 8);
					expect(basis[axis][i]).toBeCloseTo(c[axis][i], 8);
				}
			}
		});
	}
});
