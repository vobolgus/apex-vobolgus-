/**
 * The saved document: how its pages are written to storage and read back.
 *
 * What is read is not trusted: it may be an older build's, another tab's or
 * anybody's. A broken page, chart or text is dropped and the rest kept; every frame
 * is put back inside its page. The clipboard is read the same way (`parseBlockCopy`).
 */

import type { ProjectionMode } from '$lib/state/projection-transition.svelte';
import { keptFrame } from './geometry';
import { MAX_TABLE_ROWS, MIN_TABLE_ROWS, TABLE_LOOKS, TABLE_SOURCES } from './table';
import { TEMPLATE_LANGUAGES, TEMPLATES, TEXT_ROLES } from './templates';
import {
	fitTextFrame,
	MAX_TEXT_CHARS,
	MAX_TEXTS_PER_PAGE,
	normalizeRotation,
	TEXT_ALIGNS,
	TEXT_FONTS,
	TEXT_SIZES
} from './text';
import type {
	BlockCopy,
	ChartSnapshot,
	DocItem,
	DocPage,
	DocText,
	LayoutTree,
	PageLayout,
	PageOrientation,
	PageTemplate,
	Rect,
	SkyMark,
	TableLook,
	TableSpec,
	TextRole,
	TextStyle,
	TurnMemo
} from './types';

export const DOCUMENT_STORAGE_KEY = 'skycharts.document.v1';
/** Thumbnails are saved while their total stays under this many chars (≈ bytes). */
export const THUMB_BUDGET_CHARS = 2_000_000;
/** Rings on one chart, as the backend takes them (backend/src/handlers/export.rs). */
const MAX_MARKS = 16;

export type DocumentStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function browserStorage(): DocumentStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/**
 * The saved document's pages; null when there is none, or what is there is no
 * document, or the storage cannot be read.
 */
export function readDocument(storage: DocumentStorage | null): DocPage[] | null {
	let raw: string | null;
	try {
		raw = storage?.getItem(DOCUMENT_STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
	if (raw === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return parseDocument(parsed);
}

/** Save `pages` (plain data, no proxies): with their thumbnails while the storage has room. */
export function writeDocument(storage: DocumentStorage, pages: DocPage[]): void {
	try {
		storage.setItem(DOCUMENT_STORAGE_KEY, serialize(pages, THUMB_BUDGET_CHARS));
	} catch {
		// Over the quota with thumbnails: the charts matter more.
		try {
			storage.setItem(DOCUMENT_STORAGE_KEY, serialize(pages, 0));
		} catch {
			// Storage is unavailable; the document lives for this session only.
		}
	}
}

/** The saved form: thumbnails kept in document order while they fit `budget`. */
function serialize(pages: DocPage[], budget: number): string {
	let left = budget;
	const saved = pages.map((page) => ({
		...page,
		items: page.items.map(({ thumb, ...item }) => {
			if (!thumb || thumb.length > left) return item;
			left -= thumb.length;
			return { ...item, thumb };
		})
	}));
	return JSON.stringify({ pages: saved });
}

const PROJECTIONS: readonly ProjectionMode[] = ['stereographic', 'pinhole'];
const LAYER_KEYS = [
	'constellations',
	'constellationBoundaries',
	'equator',
	'ecliptic',
	'galacticEquator',
	'planets'
] as const;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
	return isFiniteNumber(value) && value > 0;
}

/** The pages of a document as it was saved; null for what is no document. */
export function parseDocument(value: unknown): DocPage[] | null {
	if (!isRecord(value) || !Array.isArray(value.pages)) return null;
	const ids = new Set<string>();
	return value.pages
		.map((page) => parsePage(page, ids))
		.filter((page): page is DocPage => page !== null);
}

function parsePage(value: unknown, ids: Set<string>): DocPage | null {
	if (!isRecord(value) || !Array.isArray(value.items)) return null;
	const { id, orientation } = value;
	if (!isOrientation(orientation)) return null;
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	ids.add(id);
	const items = value.items
		.map((item) => parseItem(item, ids, orientation))
		.filter((item): item is DocItem => item !== null);
	const page: DocPage = { id, orientation, items };
	if (Array.isArray(value.texts)) {
		const texts = value.texts
			.map((text) => parseText(text, ids, orientation))
			.filter((text): text is DocText => text !== null)
			.slice(0, MAX_TEXTS_PER_PAGE);
		if (texts.length > 0) page.texts = texts;
	}
	// A page with text is hand-arranged, whatever was saved.
	if (value.manual === true || page.texts !== undefined) page.manual = true;
	const layout = parseLayout(value.layout, items.length);
	if (layout) page.layout = layout;
	const turnMemo = parseTurnMemo(value.turnMemo, page);
	if (turnMemo) page.turnMemo = turnMemo;
	const template = parseTemplate(value.template);
	if (template) page.template = template;
	return page;
}

/** The template a page remembers: one there is, charts alone apart, in a language there is. */
function parseTemplate(value: unknown): PageTemplate | null {
	if (!isRecord(value)) return null;
	const info = TEMPLATES.find((template) => template.id === value.id);
	if (!info || info.id === 'charts') return null;
	const language = TEMPLATE_LANGUAGES.find((code) => code === value.language);
	return { id: info.id, language: language ?? TEMPLATE_LANGUAGES[0] };
}

function isOrientation(value: unknown): value is PageOrientation {
	return value === 'portrait' || value === 'landscape';
}

/** A layout whose leaves are 0..n−1, each once; else null. */
function parseLayout(value: unknown, n: number): PageLayout | null {
	if (!isRecord(value) || (value.sizing !== 'uniform' && value.sizing !== 'blocked')) return null;
	const leaves: number[] = [];
	const tree = parseTree(value.tree, leaves, n);
	if (tree === null || leaves.length !== n) return null;
	const seen = new Set(leaves);
	if (seen.size !== n || leaves.some((leaf) => leaf < 0 || leaf >= n)) return null;
	return { tree, sizing: value.sizing };
}

/** A tree of at most `n` leaves (an integer, or a node of two kids or more), collected in `leaves`. */
function parseTree(value: unknown, leaves: number[], n: number, depth = 0): LayoutTree | null {
	if (Number.isInteger(value)) {
		leaves.push(value as number);
		return value as number;
	}
	// A node has two kids or more, so a tree of n leaves is less than n deep.
	if (depth >= n || !isRecord(value) || !Array.isArray(value.kids) || value.kids.length < 2) {
		return null;
	}
	const { dir } = value;
	if (dir !== 'H' && dir !== 'V') return null;
	const kids: LayoutTree[] = [];
	for (const kid of value.kids) {
		const tree = parseTree(kid, leaves, n, depth + 1);
		if (tree === null || leaves.length > n) return null;
		kids.push(tree);
	}
	return { dir, kids };
}

/**
 * The page as it was before its last turn: the other orientation, the same charts
 * (by id, each once) with a frame each inside that page at the chart's aspect.
 */
function parseTurnMemo(value: unknown, page: DocPage): TurnMemo | null {
	if (!isRecord(value) || !Array.isArray(value.ids) || !Array.isArray(value.frames)) return null;
	const { orientation, ids, frames } = value;
	if (!isOrientation(orientation) || orientation === page.orientation) return null;
	const n = page.items.length;
	if (n === 0 || ids.length !== n || frames.length !== n) return null;
	const aspect = new Map(page.items.map((it) => [it.id, it.chart.aspect]));
	if (new Set(ids).size !== n || !ids.every((id) => aspect.has(id as string))) return null;
	const rects: Rect[] = [];
	for (let i = 0; i < n; i++) {
		const rect = parseRect(frames[i]);
		const a = aspect.get(ids[i] as string)!;
		if (!rect || keptFrame(rect, a, orientation) !== rect) return null;
		rects.push(rect);
	}
	const memo: TurnMemo = {
		orientation,
		ids: ids as string[],
		frames: rects,
		manual: value.manual === true
	};
	if (value.layout !== undefined) {
		const layout = parseLayout(value.layout, n);
		if (!layout) return null;
		memo.layout = layout;
	}
	return memo;
}

function parseItem(value: unknown, ids: Set<string>, orientation: PageOrientation): DocItem | null {
	if (!isRecord(value)) return null;
	const { id, thumb } = value;
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	const chart = parseChart(value.chart);
	const frame = parseRect(value.frame);
	if (!chart || !frame) return null;
	ids.add(id);
	const item: DocItem = { id, chart, frame: keptFrame(frame, chart.aspect, orientation) };
	if (typeof thumb === 'string' && thumb.startsWith('data:image/')) item.thumb = thumb;
	if (typeof value.closeUpOf === 'string' && value.closeUpOf !== '') {
		item.closeUpOf = value.closeUpOf;
	}
	return item;
}

/** The places ringed on a chart: those that read as places, sixteen at the most. */
function parseMarks(value: unknown): SkyMark[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(mark): mark is SkyMark =>
				isRecord(mark) &&
				isFiniteNumber(mark.raDeg) &&
				isFiniteNumber(mark.decDeg) &&
				Math.abs(mark.decDeg) <= 90 &&
				isPositive(mark.radiusDeg) &&
				mark.radiusDeg <= 90
		)
		.slice(0, MAX_MARKS)
		.map(({ raDeg, decDeg, radiusDeg }) => ({ raDeg, decDeg, radiusDeg }));
}

function parseText(value: unknown, ids: Set<string>, orientation: PageOrientation): DocText | null {
	if (!isRecord(value)) return null;
	const { id, text, chartId } = value;
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	const style = parseTextStyle(value.style);
	const frame = parseRect(value.frame);
	if (typeof text !== 'string' || !style || !frame) return null;
	ids.add(id);
	const rotation = isFiniteNumber(value.rotation) ? normalizeRotation(value.rotation) : 0;
	const parsed: DocText = {
		id,
		text: text.slice(0, MAX_TEXT_CHARS),
		style,
		frame: fitTextFrame(frame, orientation, rotation)
	};
	if (rotation !== 0) parsed.rotation = rotation;
	const table = parseTableSpec(value.table);
	if (table) parsed.table = table;
	if (TEXT_ROLES.includes(value.role as TextRole)) parsed.role = value.role as TextRole;
	if (typeof chartId === 'string' && chartId !== '') parsed.chartId = chartId;
	return parsed;
}

/** A table's spec as read from anywhere: a source there is, and rows within the limits. */
export function parseTableSpec(value: unknown): TableSpec | null {
	if (!isRecord(value) || !TABLE_SOURCES.includes(value.source as TableSpec['source'])) return null;
	if (!isFiniteNumber(value.rows)) return null;
	const rows = Math.max(MIN_TABLE_ROWS, Math.min(MAX_TABLE_ROWS, Math.round(value.rows)));
	const look = TABLE_LOOKS.includes(value.look as TableLook) ? (value.look as TableLook) : 'names';
	const spec: TableSpec = { source: value.source as TableSpec['source'], look, rows };
	const language = TEMPLATE_LANGUAGES.find((code) => code === value.language);
	// English is the absence of a language, as for a template's words.
	if (language && language !== TEMPLATE_LANGUAGES[0]) spec.language = language;
	return spec;
}

function parseTextStyle(value: unknown): TextStyle | null {
	if (!isRecord(value)) return null;
	const { font, size, bold, italic, align } = value;
	if (!TEXT_FONTS.includes(font as TextStyle['font'])) return null;
	if (!TEXT_ALIGNS.includes(align as TextStyle['align'])) return null;
	if (!isFiniteNumber(size) || size < TEXT_SIZES[0] || size > TEXT_SIZES[TEXT_SIZES.length - 1]) {
		return null;
	}
	if (typeof bold !== 'boolean' || typeof italic !== 'boolean') return null;
	return {
		font: font as TextStyle['font'],
		size,
		bold,
		italic,
		align: align as TextStyle['align']
	};
}

function parseRect(value: unknown): Rect | null {
	if (!isRecord(value)) return null;
	const { x, y, w, h } = value;
	if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isPositive(w) || !isPositive(h)) return null;
	return { x, y, w, h };
}

function parseChart(value: unknown): ChartSnapshot | null {
	if (!isRecord(value) || !isRecord(value.view) || !isRecord(value.layers)) return null;
	const { view, layers, aspect, createdAt } = value;
	const q = view.orientation;
	if (!PROJECTIONS.includes(view.projection as ProjectionMode)) return null;
	if (!isRecord(q) || ![q.x, q.y, q.z, q.w].every(isFiniteNumber)) return null;
	const sizes = [
		view.stereoFovDeg,
		view.pinholeFovDeg,
		view.pinholeAspectRatio,
		view.pinholeHeightFrac
	];
	if (!sizes.every(isPositive) || !isPositive(aspect)) return null;
	if (!LAYER_KEYS.every((key) => typeof layers[key] === 'boolean')) return null;
	if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return null;
	const marks = parseMarks(value.marks);
	return {
		...(marks.length > 0 ? { marks } : {}),
		view: {
			projection: view.projection as ProjectionMode,
			orientation: { x: q.x as number, y: q.y as number, z: q.z as number, w: q.w as number },
			stereoFovDeg: view.stereoFovDeg as number,
			pinholeFovDeg: view.pinholeFovDeg as number,
			pinholeAspectRatio: view.pinholeAspectRatio as number,
			pinholeHeightFrac: view.pinholeHeightFrac as number
		},
		layers: {
			constellations: layers.constellations as boolean,
			constellationBoundaries: layers.constellationBoundaries as boolean,
			equator: layers.equator as boolean,
			ecliptic: layers.ecliptic as boolean,
			galacticEquator: layers.galacticEquator as boolean,
			planets: layers.planets as boolean
		},
		aspect,
		createdAt
	};
}

/**
 * A copy as the clipboard holds it, from anywhere: null for what is no copy. A turn
 * that does not read as an angle is none; a spec that is no table's leaves a text.
 */
export function parseBlockCopy(value: unknown): BlockCopy | null {
	if (!isRecord(value)) return null;
	const frame = parseRect(value.frame);
	if (!frame) return null;
	if (value.kind === 'chart') {
		const chart = parseChart(value.chart);
		return chart ? { kind: 'chart', chart, frame } : null;
	}
	if (value.kind !== 'text') return null;
	const style = parseTextStyle(value.style);
	if (typeof value.text !== 'string' || !style) return null;
	const copy: BlockCopy = { kind: 'text', text: value.text, style, frame };
	const rotation = isFiniteNumber(value.rotation) ? normalizeRotation(value.rotation) : 0;
	if (rotation !== 0) copy.rotation = rotation;
	const table = parseTableSpec(value.table);
	if (table) copy.table = table;
	return copy;
}
