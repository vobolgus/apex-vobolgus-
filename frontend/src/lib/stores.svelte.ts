import { PINHOLE_ASPECT_RATIO_DEFAULT, PINHOLE_HEIGHT_FRAC_DEFAULT } from './constants';
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

export interface ConstellationSegmentPoint {
	x: number;
	y: number;
	z: number;
}

export interface ConstellationData {
	abbr: string;
	segments: ConstellationSegmentPoint[][];
}

class ViewState {
	orientation = $state<Quaternion>({ x: 0, y: 0, z: 0, w: 1 });
	stereoFovDeg = $state(180);
	pinholeFovDeg = $state(100);
	pinholeAspectRatio = $state(PINHOLE_ASPECT_RATIO_DEFAULT);
	pinholeHeightFrac = $state(PINHOLE_HEIGHT_FRAC_DEFAULT);
}

class CatalogState {
	stars = $state.raw<CatalogStar[]>([]);
	starVectors = $state.raw<StarVector[]>([]);
	constellations = $state.raw<ConstellationData[]>([]);
	constellationBoundaries = $state.raw<ConstellationData[]>([]);
}

export const view = new ViewState();
export const catalog = new CatalogState();
