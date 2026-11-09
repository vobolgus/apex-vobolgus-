import { describe, expect, it } from 'vitest';
import { orientationToPointing, pointingToOrientation, type Pointing } from './pointing';
import { toViewSpace } from './projection';
import {
	multiplyQuaternions,
	normalizeQuaternion,
	quaternionFromAxisAngle,
	quaternionFromRotationMatrix,
	rotateVectorByQuaternion,
	type Quaternion,
	type RotationMatrix
} from './quaternion';

const DEG = Math.PI / 180;

function raDec(raDeg: number, decDeg: number): [number, number, number] {
	const cosDec = Math.cos(decDeg * DEG);
	return [cosDec * Math.cos(raDeg * DEG), cosDec * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
}

/** The same rotation: q and −q turn every vector alike. */
function expectSameRotation(a: Quaternion, b: Quaternion) {
	const d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
	expect(Math.abs(d)).toBeCloseTo(1, 9);
}

/** Orientations all over the sphere, including half turns and the identity. */
const ORIENTATIONS: Quaternion[] = [
	{ x: 0, y: 0, z: 0, w: 1 },
	{ x: 1, y: 0, z: 0, w: 0 },
	{ x: 0, y: 1, z: 0, w: 0 },
	{ x: 0, y: 0, z: 1, w: 0 },
	normalizeQuaternion({ x: 0.3, y: -0.5, z: 0.2, w: 0.8 }),
	normalizeQuaternion({ x: -0.7, y: 0.1, z: 0.6, w: -0.2 }),
	normalizeQuaternion({ x: 0.9, y: 0.4, z: -0.1, w: 0.05 }),
	quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2)
];

describe('quaternionFromRotationMatrix', () => {
	it.each(ORIENTATIONS)('recovers the quaternion of its own matrix (%o)', (q) => {
		const columns = [
			rotateVectorByQuaternion(1, 0, 0, q),
			rotateVectorByQuaternion(0, 1, 0, q),
			rotateVectorByQuaternion(0, 0, 1, q)
		];
		const matrix = [0, 1, 2].map((row) => [
			columns[0][row],
			columns[1][row],
			columns[2][row]
		]) as unknown as RotationMatrix;
		expectSameRotation(quaternionFromRotationMatrix(matrix), q);
	});
});

describe('pointing', () => {
	it.each(ORIENTATIONS)('round-trips an orientation (%o)', (q) => {
		expectSameRotation(pointingToOrientation(orientationToPointing(q)), q);
	});

	it.each<Pointing>([
		{ raDeg: 83.822, decDeg: -5.391, paDeg: 0 },
		{ raDeg: 0, decDeg: 0, paDeg: 90 },
		{ raDeg: 279.23, decDeg: 38.78, paDeg: 211.5 },
		{ raDeg: 359.999, decDeg: -89.5, paDeg: 359.99 },
		// At a pole the right ascension is free; 0 with any position angle is canonical.
		{ raDeg: 0, decDeg: 90, paDeg: 37 },
		{ raDeg: 0, decDeg: -90, paDeg: 143 }
	])('round-trips a pointing ($raDeg, $decDeg, $paDeg)', (pointing) => {
		const back = orientationToPointing(pointingToOrientation(pointing));
		expect(back.raDeg).toBeCloseTo(pointing.raDeg, 6);
		expect(back.decDeg).toBeCloseTo(pointing.decDeg, 6);
		expect(back.paDeg).toBeCloseTo(pointing.paDeg, 6);
	});

	it('puts the named point at the centre of the view', () => {
		const q = pointingToOrientation({ raDeg: 83.822, decDeg: -5.391, paDeg: 30 });
		const [x, y, z] = toViewSpace(...raDec(83.822, -5.391), q);
		expect(x).toBeCloseTo(0, 9);
		expect(y).toBeCloseTo(0, 9);
		expect(z).toBeCloseTo(1, 9);
	});

	it('draws north up and east to the left at position angle 0', () => {
		const q = pointingToOrientation({ raDeg: 120, decDeg: 20, paDeg: 0 });
		const [northX, northY] = toViewSpace(...raDec(120, 21), q);
		expect(northX).toBeCloseTo(0, 9);
		expect(northY).toBeGreaterThan(0);
		const [eastX, eastY] = toViewSpace(...raDec(121, 20), q);
		expect(eastX).toBeLessThan(0);
		expect(Math.abs(eastY)).toBeLessThan(1e-3);
	});

	it('draws east up at position angle 90', () => {
		const q = pointingToOrientation({ raDeg: 120, decDeg: 20, paDeg: 90 });
		const [eastX, eastY] = toViewSpace(...raDec(121, 20), q);
		expect(eastY).toBeGreaterThan(0);
		expect(Math.abs(eastX)).toBeLessThan(1e-3);
		// North is then to the right: east stays a quarter turn counter-clockwise from it.
		const [northX] = toViewSpace(...raDec(120, 21), q);
		expect(northX).toBeGreaterThan(0);
	});

	it('reads the default view as the north pole', () => {
		const pointing = orientationToPointing({ x: 0, y: 0, z: 0, w: 1 });
		expect(pointing.decDeg).toBeCloseTo(90, 9);
		expect(pointing.raDeg).toBe(0);
	});

	it('follows a roll of the screen: the top moves through east as the sky turns', () => {
		const start = pointingToOrientation({ raDeg: 200, decDeg: -30, paDeg: 10 });
		// The Q/E keys roll about the view axis.
		const rolled = multiplyQuaternions(
			quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, 25 * DEG),
			start
		);
		const pointing = orientationToPointing(rolled);
		expect(pointing.raDeg).toBeCloseTo(200, 6);
		expect(pointing.decDeg).toBeCloseTo(-30, 6);
		expect(Math.abs(pointing.paDeg - 10)).toBeCloseTo(25, 6);
	});
});
