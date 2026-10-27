/**
 * The document's charts as RenderConfigs: vector previews and the PDF export.
 *
 * Each chart is drawn at its frame size in mm with `view.px` set to mm per preview
 * px, so scaling a chart on the page spreads the stars apart but keeps their radius
 * and the line widths. The paper style leaves the page showing through around a
 * white sky with a hairline edge.
 */

import {
	buildRenderConfig,
	type ChartLayers,
	type ChartView,
	type RenderConfig
} from '$lib/api/render-config';
import { pageSize, PRINT_MM_PER_PREVIEW_PX } from './geometry';
import type { ChartSnapshot, DocItem, DocPage } from './types';

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

export interface DocumentItemRequest {
	x_mm: number;
	y_mm: number;
	width_mm: number;
	height_mm: number;
	config: RenderConfig;
}

export interface DocumentPageRequest {
	width_mm: number;
	height_mm: number;
	items: DocumentItemRequest[];
}

/** Body of `POST /api/export/document`. */
export interface DocumentRequest {
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
export function itemRenderConfig(item: DocItem): RenderConfig {
	const { chart, frame } = item;
	const config = buildRenderConfig(chart.view, chart.layers, new Date(chart.createdAt));
	return {
		...config,
		view: { ...config.view, width: frame.w, height: frame.h, px: PRINT_MM_PER_PREVIEW_PX },
		style: { ...config.style, ...PAPER_STYLE }
	};
}

export function documentRequest(pages: readonly DocPage[]): DocumentRequest {
	return {
		pages: pages.map((page) => {
			const { w, h } = pageSize(page.orientation);
			return {
				width_mm: w,
				height_mm: h,
				items: page.items.map((item) => ({
					x_mm: item.frame.x,
					y_mm: item.frame.y,
					width_mm: item.frame.w,
					height_mm: item.frame.h,
					config: itemRenderConfig(item)
				}))
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
		const response = await fetch('/api/export/document', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(documentRequest(pages))
		});
		if (!response.ok) {
			const text = await response.text();
			if (response.status === 400) message = refusal(text);
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
export function itemPreviewUrl(item: DocItem): Promise<string> {
	const body = JSON.stringify(itemRenderConfig(item));
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
