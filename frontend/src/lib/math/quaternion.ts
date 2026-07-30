const ARCBALL_ROTATION_GAIN = 1.2;
const EPSILON = 1e-7;

export type Quaternion = {
	x: number;
	y: number;
	z: number;
	w: number;
};

export type Vec3 = {
	x: number;
	y: number;
	z: number;
};

export function dot(a: Vec3, b: Vec3) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x
	};
}

export function normalizeVec3(v: Vec3): Vec3 {
	const len = Math.hypot(v.x, v.y, v.z);
	if (len < EPSILON) return { x: 0, y: 0, z: 0 };
	return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
	const len = Math.hypot(q.x, q.y, q.z, q.w);
	if (len < EPSILON) return { x: 0, y: 0, z: 0, w: 1 };
	return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
	};
}

export function quaternionFromAxisAngle(axis: Vec3, angle: number): Quaternion {
	const halfAngle = angle * 0.5;
	const sinHalf = Math.sin(halfAngle);
	return normalizeQuaternion({
		x: axis.x * sinHalf,
		y: axis.y * sinHalf,
		z: axis.z * sinHalf,
		w: Math.cos(halfAngle)
	});
}

export function quaternionBetweenVectors(from: Vec3, to: Vec3): Quaternion {
	const axis = cross(from, to);
	const axisLen = Math.hypot(axis.x, axis.y, axis.z);
	const alignment = Math.max(-1, Math.min(1, dot(from, to)));
	if (axisLen < EPSILON) {
		// Near parallel/opposite vectors: pick a stable fallback axis.
		if (alignment > 0) return { x: 0, y: 0, z: 0, w: 1 };
		const fallbackAxis =
			Math.abs(from.x) < 0.9
				? cross(from, { x: 1, y: 0, z: 0 })
				: cross(from, { x: 0, y: 1, z: 0 });
		const normalizedFallback = normalizeVec3(fallbackAxis);
		return quaternionFromAxisAngle(normalizedFallback, Math.PI * ARCBALL_ROTATION_GAIN);
	}
	const normalizedAxis = { x: axis.x / axisLen, y: axis.y / axisLen, z: axis.z / axisLen };
	const angle = Math.acos(alignment) * ARCBALL_ROTATION_GAIN;
	return quaternionFromAxisAngle(normalizedAxis, angle);
}

export function slerpQuaternion(a: Quaternion, b: Quaternion, t: number): Quaternion {
	let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
	let b2 = b;
	if (d < 0) {
		d = -d;
		b2 = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
	}
	if (d > 0.9995) {
		return normalizeQuaternion({
			x: a.x + t * (b2.x - a.x),
			y: a.y + t * (b2.y - a.y),
			z: a.z + t * (b2.z - a.z),
			w: a.w + t * (b2.w - a.w)
		});
	}
	const theta = Math.acos(d);
	const sinTheta = Math.sin(theta);
	const wa = Math.sin((1 - t) * theta) / sinTheta;
	const wb = Math.sin(t * theta) / sinTheta;
	return {
		x: wa * a.x + wb * b2.x,
		y: wa * a.y + wb * b2.y,
		z: wa * a.z + wb * b2.z,
		w: wa * a.w + wb * b2.w
	};
}

export function quaternionConjugate(q: Quaternion): Quaternion {
	return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function rotateVectorByQuaternion(
	x: number,
	y: number,
	z: number,
	q: Quaternion
): [number, number, number] {
	const qx = q.x;
	const qy = q.y;
	const qz = q.z;
	const qw = q.w;
	const uvx = qy * z - qz * y;
	const uvy = qz * x - qx * z;
	const uvz = qx * y - qy * x;
	const uuvx = qy * uvz - qz * uvy;
	const uuvy = qz * uvx - qx * uvz;
	const uuvz = qx * uvy - qy * uvx;
	const scale = 2 * qw;
	return [x + uvx * scale + uuvx * 2, y + uvy * scale + uuvy * 2, z + uvz * scale + uuvz * 2];
}
