/**
 * The PDF document: A4 pages holding frozen copies of the preview's chart.
 *
 * All geometry is in millimetres, origin at the page's top-left, y down.
 */

import type { ChartLayers, ChartView } from '$lib/api/render-config';

export type PageOrientation = 'portrait' | 'landscape';

/** Millimetres, page top-left origin, y down. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Everything needed to draw one chart again: a frozen copy of the preview state. */
export interface ChartSnapshot {
	/** Projection, orientation quaternion, fovs, pinhole aspect/height. */
	view: ChartView;
	layers: ChartLayers;
	/** Width / height of the chart: 1 for stereo (disc), the frame aspect for pinhole. */
	aspect: number;
	/** ISO, also the planets' time. */
	createdAt: string;
}

export interface DocItem {
	id: string;
	chart: ChartSnapshot;
	/** Always keeps the chart's aspect: `frame.w / frame.h === chart.aspect`. */
	frame: Rect;
	/** PNG data URL of the preview at add time, shown until the vector preview loads. */
	thumb?: string;
}

export interface DocPage {
	id: string;
	orientation: PageOrientation;
	items: DocItem[];
}
