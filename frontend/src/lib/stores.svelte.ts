import type { Quaternion } from './math/quaternion';

export interface CatalogStar {
	ra: number;
	dec: number;
	v_mag: number;
}

export interface StarVector {
	x: number;
	y: number;
	z: number;
	v_mag: number;
}

class ViewState {
	orientation = $state<Quaternion>({ x: 0, y: 0, z: 0, w: 1 });
	fovDeg = $state(100);
}

class CatalogState {
	stars = $state.raw<CatalogStar[]>([]);
	starVectors = $state.raw<StarVector[]>([]);
}

export const view = new ViewState();
export const catalog = new CatalogState();
