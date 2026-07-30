import { describe, expect, it } from 'vitest';

import { projectPointerToArcball } from './arcball';

const RECT = { left: 0, top: 0, width: 200, height: 200 };

describe('projectPointerToArcball', () => {
	it('center maps to (0, 0, 1) — looking out of the sphere', () => {
		const { x, y, z } = projectPointerToArcball(100, 100, RECT);
		expect(x).toBeCloseTo(0, 6);
		expect(y).toBeCloseTo(0, 6);
		expect(z).toBeCloseTo(1, 6);
	});

	it('edge points are unit length', () => {
		const { x, y, z } = projectPointerToArcball(200, 100, RECT);
		const len = Math.hypot(x, y, z);
		expect(len).toBeCloseTo(1, 6);
	});

	it('outside the disc still returns a unit vector', () => {
		const { x, y, z } = projectPointerToArcball(400, 100, RECT);
		const len = Math.hypot(x, y, z);
		expect(len).toBeCloseTo(1, 6);
	});
});
