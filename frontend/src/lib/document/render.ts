/**
 * The document's charts as RenderConfigs, and its text as lines: what the vector
 * previews and the PDF export ask the backend for. Pure: who sends a request
 * (`$lib/api`) brings the measure and the catalogues it is made with.
 *
 * Each chart is drawn at its frame size in mm with `view.px` set to mm per preview
 * px, so scaling a chart on the page spreads the stars apart but keeps their radius
 * and the line widths. The paper style leaves the page showing through around a
 * white sky with a hairline edge.
 *
 * Text is broken into lines here (`text.ts`), with the fonts the backend sets it
 * in, and sent line by line: the PDF breaks where the editor does.
 */

import { buildRenderConfig, type ViewRenderConfig } from '$lib/api/render-config';
import { MAX_LINE_CHARS, MAX_LINES_PER_TEXT } from '$lib/api/wire/limits';
import type { DocumentRequest, DocumentText, DocumentTextLine } from '$lib/api/wire/request';
import { chartsOf, typesetOf } from './blocks';
import { pageSize, PRINT_MM_PER_PREVIEW_PX } from './geometry';
import { blockLayout, type Sky } from './table';
import { alignAnchor, anchoredFrame, type Measure } from './text';
import type {
	ChartBlock,
	ChartLayers,
	ChartSnapshot,
	ChartView,
	DocPage,
	TypesetBlock
} from './types';

/**
 * Overrides of the preview's style for a chart on white paper. The outline is
 * `--paper-chart-edge` in tokens.css, which draws the same edge on screen: keep
 * the two alike.
 */
export const PAPER_STYLE = {
	background_color: 'none',
	chart_color: '#ffffff',
	chart_outline: '#c9ced6'
} as const;

/** A frozen copy of what the preview shows now, for Add to PDF. */
export function snapshotChart(
	view: ChartView,
	layers: ChartLayers,
	now: Date = new Date()
): ChartSnapshot {
	const { x, y, z, w } = view.orientation;
	return {
		view: {
			projection: view.projection,
			orientation: { x, y, z, w },
			stereoFovDeg: view.stereoFovDeg,
			pinholeFovDeg: view.pinholeFovDeg,
			pinholeAspectRatio: view.pinholeAspectRatio,
			pinholeHeightFrac: view.pinholeHeightFrac
		},
		// Copied key by key: `layers` may be the live LayerState.
		layers: {
			constellations: layers.constellations,
			constellationBoundaries: layers.constellationBoundaries,
			equator: layers.equator,
			ecliptic: layers.ecliptic,
			galacticEquator: layers.galacticEquator,
			planets: layers.planets
		},
		aspect: view.projection === 'stereographic' ? 1 : view.pinholeAspectRatio,
		createdAt: now.toISOString()
	};
}

/** The preview's config for the chart, sized in mm with stars fixed in mm, on paper. */
export function chartRenderConfig(block: Pick<ChartBlock, 'chart' | 'frame'>): ViewRenderConfig {
	const { chart, frame } = block;
	const config = buildRenderConfig(chart.view, chart.layers, new Date(chart.createdAt));
	const drawn: ViewRenderConfig = {
		...config,
		view: { ...config.view, width: frame.w, height: frame.h, px: PRINT_MM_PER_PREVIEW_PX },
		style: { ...config.style, ...PAPER_STYLE }
	};
	if (chart.marks?.length) {
		drawn.marks = chart.marks.map((mark) => ({
			ra_deg: mark.raDeg,
			dec_deg: mark.decDeg,
			radius_deg: mark.radiusDeg
		}));
	}
	return drawn;
}

/**
 * A text as the backend sets it: its fields read from its chart, wrapped to its
 * width, its lines given upright with the turn to make about its centre; a table,
 * read from its chart and `sky`, is a line a cell and its rules. `pages` is the
 * document, for a text that reads a chart on another page. A line whose
 * baseline starts off the page (once turned) is left out (the backend refuses it),
 * as is everything past the backend's limits.
 */
export function textRequest(
	page: DocPage,
	text: TypesetBlock,
	measure: Measure,
	sky: Sky = NO_SKY,
	pages?: readonly DocPage[]
): DocumentText {
	const { w, h } = pageSize(page.orientation);
	const { style, rotation = 0 } = text;
	const layout = blockLayout(page, text, text.frame.w, measure, sky, pages);
	// As the editor draws it: as tall as its lines, from its own top-left corner.
	const frame = anchoredFrame(text.frame, rotation, text.frame.w, layout.height);
	const cx = frame.x + frame.w / 2;
	const cy = frame.y + frame.h / 2;
	const angle = (rotation * Math.PI) / 180;
	const onPage = (x: number, y: number) => {
		const px = cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle);
		const py = cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle);
		return px >= 0 && px <= w && py >= 0 && py <= h;
	};
	const { x, anchor } = alignAnchor(style.align, frame.w);
	const lines = layout.lines
		.map((line) => {
			const sent: DocumentTextLine = {
				x_mm: frame.x + (line.x ?? x),
				y_mm: frame.y + line.baseline,
				text: Array.from(line.text).slice(0, MAX_LINE_CHARS).join('')
			};
			if (line.anchor !== undefined && line.anchor !== anchor) sent.anchor = line.anchor;
			if (line.bold !== undefined && line.bold !== style.bold) sent.bold = line.bold;
			return sent;
		})
		.filter((line) => line.text !== '' && onPage(line.x_mm, line.y_mm))
		.slice(0, MAX_LINES_PER_TEXT);
	const request: DocumentText = {
		font: style.font,
		bold: style.bold,
		italic: style.italic,
		size_mm: layout.size,
		anchor,
		rotation_deg: rotation,
		cx_mm: cx,
		cy_mm: cy,
		lines
	};
	if (layout.rules?.length) {
		request.rules = layout.rules.map((rule) => ({
			x1_mm: frame.x + rule.x1,
			y1_mm: frame.y + rule.y1,
			x2_mm: frame.x + rule.x2,
			y2_mm: frame.y + rule.y2,
			width_mm: rule.width
		}));
	}
	return request;
}

/** No catalogues: a table read from this lists nothing. */
const NO_SKY: Sky = { messier: [], stars: [] };

/**
 * The whole document as the backend is asked for it. `measure` breaks the text into
 * lines: the canvas's, once the fonts have loaded. `sky` is what the tables read:
 * the loaded catalogues.
 */
export function documentRequest(
	pages: readonly DocPage[],
	measure: Measure,
	sky: Sky
): DocumentRequest {
	return {
		pages: pages.map((page) => {
			const { w, h } = pageSize(page.orientation);
			return {
				width_mm: w,
				height_mm: h,
				items: chartsOf(page).map((item) => ({
					x_mm: item.frame.x,
					y_mm: item.frame.y,
					width_mm: item.frame.w,
					height_mm: item.frame.h,
					config: chartRenderConfig(item)
				})),
				texts: typesetOf(page).map((text) => textRequest(page, text, measure, sky, pages))
			};
		})
	};
}
