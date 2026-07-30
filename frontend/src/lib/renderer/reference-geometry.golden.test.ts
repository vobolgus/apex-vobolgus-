/**
 * Cross-language drift guard for the reference-line geometry.
 *
 * The celestial equator, the ecliptic and the galactic equator are implemented TWICE in this
 * repo: once in TypeScript for the live canvas preview (`reference-lines.ts` / `math/astronomy.ts`)
 * and once in Rust for the exported SVG (`backend/src/svg_generator/grids.rs`). "The preview
 * matches the export" is the product's core promise, so both implementations are pinned against
 * the SAME fixture: `backend/assets/golden/reference-geometry.json`.
 *
 * A mirror-image Rust test reads the same file. If this test fails, do NOT just re-generate the
 * fixture — see the failure message.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { J2000_OBLIQUITY_DEG } from '../math/astronomy';
import { sampleEcliptic, sampleEquator, sampleGalacticEquator } from './reference-lines';

// Read the fixture off disk rather than importing it: it lives outside the frontend root, which
// Vite's fs.allow would refuse, and vitest runs in node so readFileSync is available.
// NB: do not write `new URL('...', import.meta.url)` here — Vite statically rewrites that pattern
// into a dev-server asset URL and you get an http: URL instead of a file path.
const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, '../../../../backend/assets/golden/reference-geometry.json');

interface GoldenSample {
	deg: number;
	equator: [number, number, number];
	ecliptic: [number, number, number];
	galactic_equator: [number, number, number];
}

interface GoldenFixture {
	obliquity_deg: number;
	tolerance: number;
	samples: GoldenSample[];
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFixture;

/** The TS samplers emit one point per degree over a closed 0..360 loop. */
const SAMPLE_STEP_DEG = 1;
const SAMPLE_COUNT = 361;

function driftMessage(
	circle: string,
	deg: number,
	axis: string,
	actual: number,
	expected: number
): string {
	return [
		`RUST AND TYPESCRIPT HAVE DRIFTED: ${circle} at source angle ${deg}°, ${axis} component.`,
		`  TypeScript preview produced ${actual}`,
		`  golden fixture expects     ${expected}`,
		`  delta                      ${Math.abs(actual - expected)} (tolerance ${golden.tolerance})`,
		'',
		'The canvas preview (frontend/src/lib/renderer/reference-lines.ts +',
		'frontend/src/lib/math/astronomy.ts) and the SVG exporter',
		'(backend/src/svg_generator/grids.rs) implement this geometry SEPARATELY and must agree —',
		'the preview is supposed to be exactly what the customer gets exported.',
		'',
		'Do NOT "fix" this by regenerating backend/assets/golden/reference-geometry.json to match',
		'whichever side you just touched. Decide which side is astronomically correct, then update',
		'BOTH implementations AND the fixture together, in the same change.'
	].join('\n');
}

function expectVec(
	circle: string,
	deg: number,
	actual: { x: number; y: number; z: number },
	expected: readonly [number, number, number]
): void {
	const axes = [
		['x', actual.x, expected[0]],
		['y', actual.y, expected[1]],
		['z', actual.z, expected[2]]
	] as const;
	for (const [axis, got, want] of axes) {
		if (Math.abs(got - want) > golden.tolerance) {
			throw new Error(driftMessage(circle, deg, axis, got, want));
		}
	}
}

describe('reference geometry golden fixture (TS ↔ Rust)', () => {
	it('the fixture itself is shaped the way this test assumes', () => {
		expect(golden.samples.length).toBe(25); // 0..360 inclusive at 15° steps
		expect(golden.tolerance).toBeGreaterThan(0);
		golden.samples.forEach((sample, i) => {
			expect(sample.deg).toBe(i * 15);
		});
	});

	it('uses the same J2000 obliquity as the TypeScript astronomy module', () => {
		// If this fails, the two sides disagree on a constant, not just on rounding.
		expect(golden.obliquity_deg).toBeCloseTo(J2000_OBLIQUITY_DEG, 9);
	});

	it('indexes the 1°-step samplers at the right 15° strides', () => {
		// Guard the indexing arithmetic itself: a 15° stride into a 1°-step array is index == deg.
		// If SAMPLE_STEP_DEG ever changes, this assertion — not the vector comparisons — should be
		// the first thing to fail.
		expect(sampleEquator().length).toBe(SAMPLE_COUNT);
		expect(sampleEcliptic().length).toBe(SAMPLE_COUNT);
		expect(sampleGalacticEquator().length).toBe(SAMPLE_COUNT);
		expect(SAMPLE_STEP_DEG).toBe(1);
		for (const sample of golden.samples) {
			const index = sample.deg / SAMPLE_STEP_DEG;
			expect(Number.isInteger(index)).toBe(true);
			expect(index).toBeLessThan(SAMPLE_COUNT);
		}
		// Sanity-check the stride against a value that does not depend on the fixture:
		// index 90 of the equator sampler must be RA = 90° → (0, 1, 0).
		const equatorAt90 = sampleEquator()[90 / SAMPLE_STEP_DEG];
		expect(equatorAt90.x).toBeCloseTo(0, 12);
		expect(equatorAt90.y).toBeCloseTo(1, 12);
	});

	it('reproduces every golden sample of all three great circles within tolerance', () => {
		const equator = sampleEquator();
		const ecliptic = sampleEcliptic();
		const galactic = sampleGalacticEquator();

		for (const sample of golden.samples) {
			const index = sample.deg / SAMPLE_STEP_DEG;
			expectVec('celestial equator', sample.deg, equator[index], sample.equator);
			expectVec('ecliptic', sample.deg, ecliptic[index], sample.ecliptic);
			expectVec('galactic equator', sample.deg, galactic[index], sample.galactic_equator);
		}
	});
});
