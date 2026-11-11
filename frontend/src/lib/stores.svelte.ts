import {
	PINHOLE_ASPECT_RATIO_DEFAULT,
	PINHOLE_FOV_DEG_DEFAULT,
	PINHOLE_HEIGHT_FRAC_DEFAULT
} from './constants';
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

/** A Messier object, as `/api/catalog/messier` sends it. */
export interface MessierObject {
	/** Its number: 42 for M 42. */
	m: number;
	/** Its common name; empty when it has none. */
	name: string;
	/** "Galaxy", "Open Cluster", ... */
	kind: string;
	/** The constellation it is in, abbreviated: "Ori". */
	constellation: string;
	mag: number;
	/** Degrees, J2000. */
	ra_deg: number;
	dec_deg: number;
}

class ViewState {
	orientation = $state<Quaternion>({ x: 0, y: 0, z: 0, w: 1 });
	stereoFovDeg = $state(180);
	pinholeFovDeg = $state(PINHOLE_FOV_DEG_DEFAULT);
	pinholeAspectRatio = $state(PINHOLE_ASPECT_RATIO_DEFAULT);
	pinholeHeightFrac = $state(PINHOLE_HEIGHT_FRAC_DEFAULT);
}

class CatalogState {
	stars = $state.raw<CatalogStar[]>([]);
	starVectors = $state.raw<StarVector[]>([]);
	constellations = $state.raw<ConstellationData[]>([]);
	constellationBoundaries = $state.raw<ConstellationData[]>([]);
	/** Loaded when something first asks for it (`loadMessier`): the chart does not draw it yet. */
	messier = $state.raw<MessierObject[]>([]);
}

export const view = new ViewState();
export const catalog = new CatalogState();
