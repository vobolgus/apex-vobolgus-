/**
 * The SVG/PDF export's RenderConfig (see SPEC.md), built from what the preview shows.
 *
 * The backend draws with the preview's own camera: the view-space axes of the
 * current orientation, the field of view and the chart size in canvas px, so
 * stars and lines keep their on-screen proportions. The projection on both sides
 * is pinned to `backend/assets/golden/view-projection.json`.
 */

import {
	CHART_CANVAS_BACKING_PX,
	CHART_PAGE_COLOR,
	CHART_RADIUS_FRAC,
	CHART_SKY_COLOR,
	STAR_COLOR
} from '$lib/constants';
import { viewBasis, type ProjectionMode } from '$lib/math/projection';
import type { Quaternion } from '$lib/math/quaternion';
import { CONSTELLATION_LINE_STYLE, REFERENCE_LINE_STYLES } from '$lib/renderer/reference-lines';
import { FULL_MAX_MAG } from './wire/payload';
import type { RenderConfig, ViewConfig } from './wire/request';

/** The preview state an export depends on. */
export interface ChartView {
	projection: ProjectionMode;
	orientation: Quaternion;
	stereoFovDeg: number;
	pinholeFovDeg: number;
	pinholeAspectRatio: number;
	pinholeHeightFrac: number;
}

export interface ChartLayers {
	constellations: boolean;
	constellationBoundaries: boolean;
	equator: boolean;
	ecliptic: boolean;
	galacticEquator: boolean;
	planets: boolean;
}

/**
 * A RenderConfig as this page sends it: of all the backend takes (`wire/request`),
 * always the one drawn with the preview's own camera.
 */
export type ViewRenderConfig = RenderConfig & { view: ViewConfig };

/** Chart size in canvas px: the disc's diameter, or the pinhole frame. */
export function chartSizePx(view: ChartView): { width: number; height: number } {
	const radius = CHART_RADIUS_FRAC * CHART_CANVAS_BACKING_PX;
	if (view.projection === 'stereographic') return { width: 2 * radius, height: 2 * radius };
	const height = radius * view.pinholeHeightFrac;
	return { width: height * view.pinholeAspectRatio, height };
}

/** `now` places the planets; the chart has no time of its own yet. */
export function buildRenderConfig(
	view: ChartView,
	layers: ChartLayers,
	now: Date
): ViewRenderConfig {
	const stereo = view.projection === 'stereographic';
	return {
		projection: stereo ? 'stereo' : 'pinhole',
		datetime: now.toISOString(),
		// What the preview draws: the stars of `/api/catalog/full`, asked for without a limit.
		magnitude_limit: FULL_MAX_MAG,
		fov_deg: stereo ? view.stereoFovDeg : view.pinholeFovDeg,
		view: { ...viewBasis(view.orientation), ...chartSizePx(view) },
		layers: {
			ecliptic: layers.ecliptic,
			equator: layers.equator,
			galactic_equator: layers.galacticEquator,
			planets: layers.planets,
			horizontal_grid: false,
			equatorial_grid: false,
			constellations: layers.constellations,
			constellation_boundaries: layers.constellationBoundaries,
			constellation_names: false,
			zenith: false,
			poles: false
		},
		style: {
			star_color: STAR_COLOR,
			// The backend draws boundaries in this colour too, as the preview does.
			constellation_line_color: CONSTELLATION_LINE_STYLE.strokeStyle,
			grid_color: REFERENCE_LINE_STYLES.equator.strokeStyle,
			background_color: CHART_PAGE_COLOR,
			chart_color: CHART_SKY_COLOR,
			font_family: 'Inter',
			magnitude_scale: 1
		},
		print_info: false
	};
}
