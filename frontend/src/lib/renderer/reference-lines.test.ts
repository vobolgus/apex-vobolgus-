import { describe, expect, it } from 'vitest';

import {
	galacticToEquatorial,
	sampleEcliptic,
	sampleEquator,
	sampleGalacticEquator
} from './reference-lines';

const RAD_TO_DEG = 180 / Math.PI;

function unitVecToRaDecDeg(x: number, y: number, z: number): { ra: number; dec: number } {
	const dec = Math.asin(z) * RAD_TO_DEG;
	let ra = Math.atan2(y, x) * RAD_TO_DEG;
	if (ra < 0) ra += 360;
	return { ra, dec };
}

describe('sampleEquator', () => {
	it('produces 361 samples on the unit circle in the xy plane', () => {
		const samples = sampleEquator();
		expect(samples.length).toBe(361);
		for (const s of samples) {
			expect(s.z).toBeCloseTo(0, 10);
			expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 10);
		}
		expect(samples[0].x).toBeCloseTo(1, 10);
		expect(samples[0].y).toBeCloseTo(0, 10);
		expect(samples[360].x).toBeCloseTo(1, 6);
	});
});

describe('sampleEcliptic', () => {
	it('produces unit vectors, with λ=0 at the vernal equinox', () => {
		const samples = sampleEcliptic();
		expect(samples.length).toBe(361);
		for (const s of samples) {
			expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6);
		}
		// λ=0 should be on the equator at RA=0.
		const v0 = samples[0];
		expect(v0.x).toBeCloseTo(1, 6);
		expect(v0.y).toBeCloseTo(0, 6);
		expect(v0.z).toBeCloseTo(0, 6);
		// λ=90° → declination = obliquity (≈ 23.439°).
		const v90 = samples[90];
		const dec90 = Math.asin(v90.z) * RAD_TO_DEG;
		expect(dec90).toBeCloseTo(23.439291, 3);
	});
});

describe('galacticToEquatorial', () => {
	it('maps l=0, b=0 (galactic center) to α≈266.405°, δ≈-28.936°', () => {
		const v = galacticToEquatorial(1, 0);
		const { ra, dec } = unitVecToRaDecDeg(v.x, v.y, v.z);
		expect(ra).toBeCloseTo(266.405, 1);
		expect(dec).toBeCloseTo(-28.936, 1);
	});

	it('maps l=90°, b=0 to α≈318.005°, δ≈+48.330°', () => {
		const v = galacticToEquatorial(0, 1);
		const { ra, dec } = unitVecToRaDecDeg(v.x, v.y, v.z);
		expect(ra).toBeCloseTo(318.005, 1);
		expect(dec).toBeCloseTo(48.33, 1);
	});

	it('returns unit-length vectors', () => {
		for (let deg = 0; deg < 360; deg += 17) {
			const l = (deg * Math.PI) / 180;
			const v = galacticToEquatorial(Math.cos(l), Math.sin(l));
			expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 5);
		}
	});
});

describe('sampleGalacticEquator', () => {
	it('produces 361 unit-length samples that close the loop', () => {
		const samples = sampleGalacticEquator();
		expect(samples.length).toBe(361);
		for (const s of samples) {
			expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6);
		}
		// first and last sample should be identical (closed loop)
		expect(samples[0].x).toBeCloseTo(samples[360].x, 6);
		expect(samples[0].y).toBeCloseTo(samples[360].y, 6);
		expect(samples[0].z).toBeCloseTo(samples[360].z, 6);
	});
});
