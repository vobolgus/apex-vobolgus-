/**
 * The document's charts as RenderConfigs, and its text as lines: vector previews
 * and the PDF export.
 *
 * Each chart is drawn at its frame size in mm with `view.px` set to mm per preview
 * px, so scaling a chart on the page spreads the stars apart but keeps their radius
 * and the line widths. The paper style leaves the page showing through around a
 * white sky with a hairline edge.
 *
 * Text is broken into lines here (`text.ts`), with the fonts the backend sets it
 * in, and sent line by line: the PDF breaks where the editor does.
 */

import {
	buildRenderConfig,
	type ChartLayers,
	type ChartView,
	type RenderConfig
} from '$lib/api/render-config';
import { chartsOf, typesetOf } from './blocks';
import { pageSize, PRINT_MM_PER_PREVIEW_PX } from './geometry';
import { loadMessier } from '$lib/api/catalog';
import { catalog } from '$lib/state/catalog.svelte';
import { blockLayout, type Sky } from './table';
import { alignAnchor, anchoredFrame, MAX_LINE_CHARS, MAX_TEXT_LINES, type Measure } from './text';
import { loadTextFonts, measureText } from './text-fonts.svelte';
import type { ChartBlock, ChartSnapshot, DocPage, TextFont, TypesetBlock } from './types';

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

/** Previews kept as object URLs; the least recently used one is revoked beyond this. */
export const PREVIEW_CACHE_LIMIT = 60;

interface DocumentItemRequest {
	x_mm: number;
	y_mm: number;
	width_mm: number;
	height_mm: number;
	config: RenderConfig;
}

/** A text, line by line: where each baseline starts (or its middle, or its end), mm. */
interface DocumentTextRequest {
	font: TextFont;
	bold: boolean;
	italic: boolean;
	size_mm: number;
	anchor: 'start' | 'middle' | 'end';
	/** Degrees the lines are turned clockwise about (`cx_mm`, `cy_mm`), where they are given upright. */
	rotation_deg: number;
	cx_mm: number;
	cy_mm: number;
	/** A table's cell has an anchor and a weight of its own. */
	lines: {
		x_mm: number;
		y_mm: number;
		text: string;
		anchor?: 'start' | 'middle' | 'end';
		bold?: boolean;
	}[];
	/** A table's rules, turned with the text. */
	rules?: { x1_mm: number; y1_mm: number; x2_mm: number; y2_mm: number; width_mm: number }[];
}

interface DocumentPageRequest {
	width_mm: number;
	height_mm: number;
	items: DocumentItemRequest[];
	texts: DocumentTextRequest[];
}

/** Body of `POST /api/export/document`. */
interface DocumentRequest {
	pages: DocumentPageRequest[];
}

/** How a document export went; `message` is the backend's reason for refusing it. */
export type DocumentExportResult = { ok: true } | { ok: false; message: string | null };

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
export function chartRenderConfig(item: Pick<ChartBlock, 'chart' | 'frame'>): RenderConfig {
	const { chart, frame } = item;
	const config = buildRenderConfig(chart.view, chart.layers, new Date(chart.createdAt));
	const drawn: RenderConfig = {
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
): DocumentTextRequest {
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
			const sent: DocumentTextRequest['lines'][number] = {
				x_mm: frame.x + (line.x ?? x),
				y_mm: frame.y + line.baseline,
				text: Array.from(line.text).slice(0, MAX_LINE_CHARS).join('')
			};
			if (line.anchor !== undefined && line.anchor !== anchor) sent.anchor = line.anchor;
			if (line.bold !== undefined && line.bold !== style.bold) sent.bold = line.bold;
			return sent;
		})
		.filter((line) => line.text !== '' && onPage(line.x_mm, line.y_mm))
		.slice(0, MAX_TEXT_LINES);
	const request: DocumentTextRequest = {
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
 * `measure` breaks the text into lines: the canvas's, once the fonts have loaded.
 * `sky` is what the tables read: the loaded catalogues.
 */
export function documentRequest(
	pages: readonly DocPage[],
	measure: Measure = measureText,
	sky: Sky = { messier: catalog.messier, stars: catalog.stars }
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

/**
 * Download the whole document as one PDF. Errors are logged rather than thrown, as
 * `exportChart` does; the result says whether a file was downloaded and, when the
 * backend refused the document (a 400, which trying again will not change), why.
 */
export async function exportDocument(pages: readonly DocPage[]): Promise<DocumentExportResult> {
	if (pages.length === 0) return { ok: false, message: null };
	let message: string | null = null;
	try {
		// Lines broken in a fallback font would break elsewhere in the PDF.
		const texts = pages.flatMap(typesetOf);
		await loadTextFonts(texts.map((text) => text.style));
		// A table of Messier objects lists none without their catalogue.
		if (texts.some((text) => text.kind === 'table' && text.table.source === 'messier')) {
			await loadMessier();
		}
		const response = await fetch('/api/export/document', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(documentRequest(pages))
		});
		if (!response.ok) {
			const text = await response.text();
			// A 400 says what is wrong with the document, a 429 how long to wait.
			if (response.status === 400 || response.status === 429) message = refusal(text);
			throw new Error(`Document export failed: ${response.status} ${text}`);
		}
		const url = URL.createObjectURL(await response.blob());
		const link = document.createElement('a');
		link.download = `skycharts-${Date.now()}.pdf`;
		link.href = url;
		link.click();
		URL.revokeObjectURL(url);
		return { ok: true };
	} catch (error) {
		console.error(error);
		return { ok: false, message };
	}
}

/** The backend's plain-text reason, which the proxy wraps as `{ "message": … }`. */
function refusal(body: string): string | null {
	let text = body;
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
			text = String(parsed.message);
		}
	} catch {
		// Plain text already.
	}
	text = text.trim();
	return text === '' ? null : text;
}

// Insertion order is recency: a hit moves to the end, eviction takes the first.
const previews = new Map<string, Promise<string>>();
/**
 * Evicted URLs an image still shows. A page that becomes current in the editor
 * draws a new <img> with the URL its chart already had, which a revoked URL would
 * break; these are revoked once no image shows them.
 */
const retired = new Set<string>();

/**
 * An object URL of the chart's SVG at its current size, cached by the JSON of its
 * config (the position on the page does not matter). Rejects when the backend
 * fails; a failure is not cached, so the next call tries again.
 */
export function chartPreviewUrl(item: Pick<ChartBlock, 'chart' | 'frame'>): Promise<string> {
	const body = JSON.stringify(chartRenderConfig(item));
	const cached = previews.get(body);
	if (cached) {
		previews.delete(body);
		previews.set(body, cached);
		return cached;
	}
	const url = fetchPreview(body);
	previews.set(body, url);
	url.catch(() => {
		if (previews.get(body) === url) previews.delete(body);
	});
	for (const [key, evicted] of previews) {
		if (previews.size <= PREVIEW_CACHE_LIMIT) break;
		previews.delete(key);
		evicted.then(
			(href) => {
				retired.add(href);
				revokeUnshown();
			},
			() => {}
		);
	}
	return url;
}

/** Drop every cached preview and revoke its URL. */
export function clearPreviewCache(): void {
	for (const url of previews.values()) revokeWhenSettled(url);
	previews.clear();
	for (const href of retired) URL.revokeObjectURL(href);
	retired.clear();
}

/** Revoke the retired URLs that no image in the document shows any more. */
function revokeUnshown() {
	const shown = new Set(
		typeof document === 'undefined' ? [] : Array.from(document.images, (image) => image.src)
	);
	for (const href of retired) {
		if (shown.has(href)) continue;
		retired.delete(href);
		URL.revokeObjectURL(href);
	}
}

async function fetchPreview(body: string): Promise<string> {
	const response = await fetch('/api/export?format=svg', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body
	});
	if (!response.ok) throw new Error(`Chart preview failed: ${response.status}`);
	return URL.createObjectURL(await response.blob());
}

function revokeWhenSettled(url: Promise<string>) {
	url.then(
		(href) => URL.revokeObjectURL(href),
		() => {}
	);
}
