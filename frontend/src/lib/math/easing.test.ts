import { describe, expect, it } from 'vitest';

import { clamp, easeInOutCubic, lerp, smoothstep } from './easing';

describe('easing utilities', () => {
	describe('clamp', () => {
		it('clamps below min', () => expect(clamp(-1, 0, 10)).toBe(0));
		it('clamps above max', () => expect(clamp(99, 0, 10)).toBe(10));
		it('passes through in-range', () => expect(clamp(5, 0, 10)).toBe(5));
	});

	describe('lerp', () => {
		it('returns a at t=0', () => expect(lerp(2, 8, 0)).toBeCloseTo(2));
		it('returns b at t=1', () => expect(lerp(2, 8, 1)).toBeCloseTo(8));
		it('returns midpoint at t=0.5', () => expect(lerp(2, 8, 0.5)).toBeCloseTo(5));
	});

	describe('easeInOutCubic', () => {
		it('is 0 at t=0', () => expect(easeInOutCubic(0)).toBeCloseTo(0, 6));
		it('is 1 at t=1', () => expect(easeInOutCubic(1)).toBeCloseTo(1, 6));
		it('is 0.5 at t=0.5 (symmetric)', () => expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6));
		it('is monotonic in [0,1]', () => {
			let prev = -Infinity;
			for (let t = 0; t <= 1; t += 0.05) {
				const v = easeInOutCubic(t);
				expect(v).toBeGreaterThanOrEqual(prev);
				prev = v;
			}
		});
	});

	describe('smoothstep', () => {
		it('0 below edge0', () => expect(smoothstep(0, 1, -0.5)).toBe(0));
		it('1 above edge1', () => expect(smoothstep(0, 1, 1.5)).toBe(1));
		it('0.5 at midpoint', () => expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6));
	});
});
