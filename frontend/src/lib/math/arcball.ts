import type { Vec3 } from './quaternion';

/**
 * Maps a pointer event coordinate to a unit vector on a virtual arcball.
 * Returns the projected vector on the sphere; for points outside the
 * disc, projects onto the hyperbolic plane (Holroyd-Henriksen scheme).
 */
export function projectPointerToArcball(
	clientX: number,
	clientY: number,
	rect: DOMRect | { left: number; top: number; width: number; height: number }
): Vec3 {
	const cx = rect.left + rect.width * 0.5;
	const cy = rect.top + rect.height * 0.5;
	const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
	// Keep interaction axes in sync with camera/view handedness.
	const x = (cx - clientX) / radius;
	const y = (cy - clientY) / radius;
	const squaredLength = x * x + y * y;
	if (squaredLength <= 1) {
		return { x, y, z: Math.sqrt(1 - squaredLength) };
	}
	const invLength = 1 / Math.sqrt(squaredLength);
	return { x: x * invLength, y: y * invLength, z: 0 };
}
