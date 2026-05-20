import { describe, expect, it } from 'vitest';
import {
	multiplyQuaternions,
	normalizeQuaternion,
	quaternionConjugate,
	quaternionBetweenVectors,
	rotateVectorByQuaternion,
	dot,
	cross,
	normalizeVec3
} from './quaternion';

describe('quaternion', () => {
	it('identity rotation maps vectors to themselves', () => {
		const id = { x: 0, y: 0, z: 0, w: 1 };
		const [x, y, z] = rotateVectorByQuaternion(1, 2, 3, id);
		expect(x).toBeCloseTo(1, 9);
		expect(y).toBeCloseTo(2, 9);
		expect(z).toBeCloseTo(3, 9);
	});

	it('multiply by conjugate yields identity', () => {
		const q = normalizeQuaternion({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
		const r = multiplyQuaternions(q, quaternionConjugate(q));
		expect(r.x).toBeCloseTo(0, 9);
		expect(r.y).toBeCloseTo(0, 9);
		expect(r.z).toBeCloseTo(0, 9);
		expect(r.w).toBeCloseTo(1, 9);
	});

	it('normalizeQuaternion gives unit length', () => {
		const q = normalizeQuaternion({ x: 3, y: 4, z: 0, w: 0 });
		const len = Math.hypot(q.x, q.y, q.z, q.w);
		expect(len).toBeCloseTo(1, 9);
	});

	it('quaternionBetweenVectors applies arcball gain rotation', () => {
		const a = { x: 1, y: 0, z: 0 };
		const b = { x: 0, y: 1, z: 0 };
		const q = quaternionBetweenVectors(a, b);
		const [x, y, z] = rotateVectorByQuaternion(a.x, a.y, a.z, q);
		expect(x).toBeCloseTo(Math.cos((Math.PI / 2) * 1.2), 6);
		expect(y).toBeCloseTo(Math.sin((Math.PI / 2) * 1.2), 6);
		expect(z).toBeCloseTo(0, 6);
	});

	it('dot/cross/normalizeVec3 basic identities', () => {
		const a = { x: 1, y: 0, z: 0 };
		const b = { x: 0, y: 1, z: 0 };
		expect(dot(a, b)).toBeCloseTo(0, 9);
		const c = cross(a, b);
		expect(c.x).toBeCloseTo(0, 9);
		expect(c.y).toBeCloseTo(0, 9);
		expect(c.z).toBeCloseTo(1, 9);
		const n = normalizeVec3({ x: 2, y: 0, z: 0 });
		expect(n.x).toBeCloseTo(1, 9);
	});
});
