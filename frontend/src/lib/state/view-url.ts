/**
 * The chart's view as a URL fragment, so a reload keeps it and a link shares it.
 *
 *     #p=stereo&ra=83.822&dec=-5.391&pa=0&fov=60&layers=lines,ecliptic
 *     #p=pinhole&ra=83.822&dec=-5.391&pa=0&fov=100&ar=1.6102&size=1.18
 *
 * - `p`: the projection, `stereo` or `pinhole`.
 * - `ra`, `dec`: the centre of the chart, degrees.
 * - `pa`: the position angle of the chart's top (the topmost point of the stereo
 *   disc, the middle of the pinhole frame's top edge), degrees from north through
 *   east; see `$lib/math/pointing`.
 * - `fov`: the field of view, degrees: across the disc for stereo, the frame's
 *   width for pinhole.
 * - `ar`, `size` (pinhole only): the frame's width over its height, and its height
 *   on screen as the renderer counts it (a fraction of the chart radius), which
 *   sets how large the stars are against the frame.
 * - `layers`: the layers that are on, comma-separated; none when absent.
 *
 * Reading is lenient: a fragment that is not a view at all is ignored, a missing
 * or malformed value keeps what the page already has (`applySharedView`), and
 * numbers are clamped to what the controls can reach.
 */

import type { ChartLayers, ChartView } from '$lib/api/render-config';
import {
	CHART_RADIUS_FRAC,
	MAX_FOV_DEG_PINHOLE,
	MAX_FOV_DEG_STEREO,
	MIN_FOV_DEG_PINHOLE,
	MIN_FOV_DEG_STEREO,
	PINHOLE_ASPECT_RATIO_MAX,
	PINHOLE_ASPECT_RATIO_MIN,
	PINHOLE_HEIGHT_FRAC_MAX,
	PINHOLE_HEIGHT_FRAC_MIN
} from '$lib/constants';
import { orientationToPointing, pointingToOrientation } from '$lib/math/pointing';
import type { Quaternion } from '$lib/math/quaternion';
import type { ProjectionMode } from '$lib/state/projection-transition.svelte';

/** Layer names in the fragment, in the order they are written. */
const LAYER_NAMES = {
	constellations: 'lines',
	constellationBoundaries: 'bounds',
	equator: 'equator',
	ecliptic: 'ecliptic',
	galacticEquator: 'galactic',
	planets: 'planets'
} as const satisfies Record<keyof ChartLayers, string>;

const LAYER_KEYS = Object.keys(LAYER_NAMES) as (keyof ChartLayers)[];

const PROJECTION_NAMES = { stereographic: 'stereo', pinhole: 'pinhole' } as const;

/** What a fragment says: the view fields it names, as written, and every layer. */
export interface SharedView {
	projection?: ProjectionMode;
	orientation?: Quaternion;
	/** Of the projection the chart ends up in. */
	fovDeg?: number;
	pinholeAspectRatio?: number;
	pinholeHeightFrac?: number;
	layers: ChartLayers;
}

/** `value` to `digits` decimals, without trailing zeros or a negative zero. */
function fmt(value: number, digits: number): string {
	const text = value.toFixed(digits);
	const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
	return trimmed === '-0' ? '0' : trimmed;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** The fragment for `view` and `layers`, without the leading `#`. */
export function encodeViewHash(view: ChartView, layers: ChartLayers): string {
	const pinhole = view.projection === 'pinhole';
	const { raDeg, decDeg, paDeg } = orientationToPointing(view.orientation);
	// 0.001° is a twentieth of a preview px at the closest zoom.
	const parts = [
		`p=${PROJECTION_NAMES[view.projection]}`,
		`ra=${fmt(raDeg, 3)}`,
		`dec=${fmt(decDeg, 3)}`,
		`pa=${fmt(paDeg, 2)}`,
		`fov=${fmt(pinhole ? view.pinholeFovDeg : view.stereoFovDeg, 2)}`
	];
	if (pinhole) {
		parts.push(`ar=${fmt(view.pinholeAspectRatio, 4)}`, `size=${fmt(view.pinholeHeightFrac, 3)}`);
	}
	const on = LAYER_KEYS.filter((key) => layers[key]).map((key) => LAYER_NAMES[key]);
	if (on.length > 0) parts.push(`layers=${on.join(',')}`);
	return parts.join('&');
}

/** The finite number under `key`, or null when it is absent or not a number. */
function numberParam(params: URLSearchParams, key: string): number | null {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

/**
 * Read a fragment (with or without its `#`). Null when it is not a view: it names
 * neither a projection nor a centre.
 */
export function decodeViewHash(hash: string): SharedView | null {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const named = new Set((params.get('layers') ?? '').split(','));
	const shared: SharedView = {
		layers: Object.fromEntries(
			LAYER_KEYS.map((key) => [key, named.has(LAYER_NAMES[key])])
		) as unknown as ChartLayers
	};

	const projectionName = params.get('p');
	if (projectionName === 'stereo') shared.projection = 'stereographic';
	else if (projectionName === 'pinhole') shared.projection = 'pinhole';

	const raDeg = numberParam(params, 'ra');
	const decDeg = numberParam(params, 'dec');
	if (raDeg !== null && decDeg !== null) {
		shared.orientation = pointingToOrientation({
			raDeg,
			decDeg: clamp(decDeg, -90, 90),
			paDeg: numberParam(params, 'pa') ?? 0
		});
	}

	if (shared.projection === undefined && shared.orientation === undefined) return null;

	const fovDeg = numberParam(params, 'fov');
	if (fovDeg !== null) shared.fovDeg = fovDeg;
	const aspectRatio = numberParam(params, 'ar');
	if (aspectRatio !== null) shared.pinholeAspectRatio = aspectRatio;
	const heightFrac = numberParam(params, 'size');
	if (heightFrac !== null) shared.pinholeHeightFrac = heightFrac;
	return shared;
}

/**
 * `view` with what `shared` names, clamped to what the controls can reach. The
 * frame is kept on the chart surface as well: one as wide as a link may ask for
 * (aspect × size) would otherwise run off it.
 */
export function applySharedView(view: ChartView, shared: SharedView): ChartView {
	const next: ChartView = {
		...view,
		projection: shared.projection ?? view.projection,
		orientation: shared.orientation ?? view.orientation
	};
	if (shared.fovDeg !== undefined) {
		if (next.projection === 'pinhole') {
			next.pinholeFovDeg = clamp(shared.fovDeg, MIN_FOV_DEG_PINHOLE, MAX_FOV_DEG_PINHOLE);
		} else {
			next.stereoFovDeg = clamp(shared.fovDeg, MIN_FOV_DEG_STEREO, MAX_FOV_DEG_STEREO);
		}
	}
	if (shared.pinholeAspectRatio !== undefined) {
		next.pinholeAspectRatio = clamp(
			shared.pinholeAspectRatio,
			PINHOLE_ASPECT_RATIO_MIN,
			PINHOLE_ASPECT_RATIO_MAX
		);
	}
	if (shared.pinholeHeightFrac !== undefined) {
		next.pinholeHeightFrac = clamp(
			shared.pinholeHeightFrac,
			PINHOLE_HEIGHT_FRAC_MIN,
			PINHOLE_HEIGHT_FRAC_MAX
		);
	}
	const maxWidthFrac = 1 / CHART_RADIUS_FRAC;
	if (next.pinholeAspectRatio * next.pinholeHeightFrac > maxWidthFrac) {
		next.pinholeHeightFrac = Math.max(
			PINHOLE_HEIGHT_FRAC_MIN,
			maxWidthFrac / next.pinholeAspectRatio
		);
	}
	return next;
}
