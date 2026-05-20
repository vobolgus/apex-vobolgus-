export const EPSILON = 1e-7;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
	return from + (to - from) * t;
}

export function easeInOutCubic(t: number): number {
	return 0.5 - Math.cos(Math.PI * clamp(t, 0, 1)) * 0.5;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
	if (Math.abs(edge1 - edge0) < EPSILON) {
		return x < edge0 ? 0 : 1;
	}
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}
