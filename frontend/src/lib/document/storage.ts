/**
 * The saved document: how its pages are written to storage and read back.
 *
 * What is read is not trusted: it may be an older build's, another tab's or
 * anybody's. A broken page or block is dropped and the rest kept; every frame is
 * put back inside its page. The clipboard is read the same way (`parseBlockCopy`).
 *
 * The saved shape is older than the model's, and stays as it is, so that a build
 * from before reads what this one writes: a page keeps its charts in `items` and its
 * texts in `texts`, a table being a text with a `table` and no words. The model's
 * page holds one list of blocks, each of a `kind`. The one is made of the other here
 * and nowhere else (`savedPage` writing, `parsePage` reading); a copy on the
 * clipboard is of the same age, and is written as it was too (`clipboardCopy`).
 */

import { MAX_MARKS, MAX_TEXTS_PER_PAGE } from '$lib/api/wire/limits';
import { PROJECTION_MODES, type ProjectionMode } from '$lib/math/projection';
import { chartsOf, typesetOf } from './blocks';
import { keptFrame } from './geometry';
import { MAX_TABLE_ROWS, MIN_TABLE_ROWS, TABLE_LOOKS, TABLE_SOURCES } from './table';
import { TEMPLATES, TEXT_ROLES } from './templates';
import {
	fitTextFrame,
	MAX_TEXT_CHARS,
	normalizeRotation,
	TEXT_ALIGNS,
	TEXT_FONTS,
	TEXT_SIZES
} from './text';
import { DEFAULT_LANGUAGE, LANGUAGES } from './words';
import type {
	BlockCopy,
	ChartBlock,
	ChartSnapshot,
	DocPage,
	LayoutTree,
	PageLayout,
	PageOrientation,
	PageTemplate,
	Rect,
	ChartMark,
	TableLook,
	TableSpec,
	TextRole,
	TextStyle,
	TurnMemo,
	TypesetBlock
} from './types';

/** Where the document is kept. */
export const DOCUMENT_STORAGE_KEY = 'skycharts.document.v1';
/** Thumbnails are saved while their total stays under this many chars (≈ bytes). */
export const THUMB_BUDGET_CHARS = 2_000_000;

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
	if (!storage) return null;
	try {
		const raw = storage.getItem(DOCUMENT_STORAGE_KEY);
		return raw === null ? null : parseDocument(JSON.parse(raw));
	} catch {
		return null;
	}
}

/** Save `pages` (plain data, no proxies), with their thumbnails while the storage has room. */
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
	const left = { chars: budget };
	return JSON.stringify({ pages: pages.map((page) => savedPage(page, left)) });
}

/**
 * A page as it is saved: its charts in `items`, its texts and tables in `texts` (none
 * when it has none), neither with a `kind`. A thumbnail is kept while `left` has room.
 */
function savedPage(page: DocPage, left: { chars: number }): object {
	const { id, orientation, blocks: _blocks, ...rest } = page;
	const items = chartsOf(page).map(({ kind: _kind, thumb, ...chart }) => {
		if (!thumb || thumb.length > left.chars) return chart;
		left.chars -= thumb.length;
		return { ...chart, thumb };
	});
	const texts = typesetOf(page).map(savedText);
	return { id, orientation, items, ...(texts.length > 0 ? { texts } : {}), ...rest };
}

/** A text as it is saved; a table as a text of no words that carries its spec. */
function savedText(block: TypesetBlock): object {
	if (block.kind === 'text') {
		const { kind: _kind, ...text } = block;
		return text;
	}
	const { kind: _kind, id, ...table } = block;
	return { id, text: '', ...table };
}

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

/** The pages of a document as it is saved; null for what is no document. */
export function parseDocument(value: unknown): DocPage[] | null {
	if (!isRecord(value) || !Array.isArray(value.pages)) return null;
	const ids = new Set<string>();
	return value.pages
		.map((page) => parsePage(page, ids))
		.filter((page): page is DocPage => page !== null);
}

// === Pages ===

/** A page with its charts' list, an orientation and an id no page or block before it has. */
function parsePage(value: unknown, ids: Set<string>): DocPage | null {
	if (!isRecord(value) || !Array.isArray(value.items)) return null;
	const { id, orientation } = value;
	if (!isOrientation(orientation)) return null;
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	ids.add(id);
	const charts = value.items
		.map((item) => parseChartBlock(item, ids, orientation))
		.filter((chart): chart is ChartBlock => chart !== null);
	// A page saved before text was has no list of it.
	const type = (Array.isArray(value.texts) ? value.texts : [])
		.map((text) => parseTypesetBlock(text, ids, orientation))
		.filter((block): block is TypesetBlock => block !== null)
		.slice(0, MAX_TEXTS_PER_PAGE);
	const page: DocPage = { id, orientation, blocks: [...charts, ...type] };
	// A page with text is hand-arranged, whatever was saved.
	if (value.manual === true || type.length > 0) page.manual = true;
	const layout = parseLayout(value.layout, charts.length);
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
	const language = LANGUAGES.find((code) => code === value.language);
	return { id: info.id, language: language ?? DEFAULT_LANGUAGE };
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
	const charts = chartsOf(page);
	const n = charts.length;
	if (n === 0 || ids.length !== n || frames.length !== n) return null;
	const aspect = new Map(charts.map((it) => [it.id, it.chart.aspect]));
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

// === Blocks ===

/** The id of a saved block, when it is one no page or block before it has; else null. */
function freshId(value: Json, ids: Set<string>): string | null {
	const { id } = value;
	return typeof id === 'string' && id !== '' && !ids.has(id) ? id : null;
}

function parseChartBlock(
	value: unknown,
	ids: Set<string>,
	orientation: PageOrientation
): ChartBlock | null {
	if (!isRecord(value)) return null;
	const id = freshId(value, ids);
	const chart = parseChart(value.chart);
	const frame = parseRect(value.frame);
	if (id === null || !chart || !frame) return null;
	ids.add(id);
	const block: ChartBlock = {
		kind: 'chart',
		id,
		chart,
		frame: keptFrame(frame, chart.aspect, orientation)
	};
	const { thumb, closeUpOf } = value;
	if (typeof thumb === 'string' && thumb.startsWith('data:image/')) block.thumb = thumb;
	if (typeof closeUpOf === 'string' && closeUpOf !== '') block.closeUpOf = closeUpOf;
	return block;
}

/** The places ringed on a chart: those that read as places, sixteen at the most. */
function parseMarks(value: unknown): ChartMark[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(mark): mark is ChartMark =>
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

/**
 * A saved text, as the block it is: a table when it carries a spec that reads as
 * one, and then without the empty words it was saved with; else a text. Words are
 * asked of both. Then what the two are read alike: the turn (what does not read as
 * an angle is upright), the frame fitted to the page at that turn, the part it plays
 * and the chart it is told to read.
 */
function parseTypesetBlock(
	value: unknown,
	ids: Set<string>,
	orientation: PageOrientation
): TypesetBlock | null {
	if (!isRecord(value)) return null;
	const id = freshId(value, ids);
	const { text, role, chartId } = value;
	const style = parseTextStyle(value.style);
	const frame = parseRect(value.frame);
	if (id === null || typeof text !== 'string' || !style || !frame) return null;
	ids.add(id);
	const table = parseTableSpec(value.table);
	const rotation = isFiniteNumber(value.rotation) ? normalizeRotation(value.rotation) : 0;
	const place = { id, style, frame: fitTextFrame(frame, orientation, rotation) };
	const block: TypesetBlock = table
		? { kind: 'table', table, ...place }
		: { kind: 'text', text: text.slice(0, MAX_TEXT_CHARS), ...place };
	if (rotation !== 0) block.rotation = rotation;
	if (TEXT_ROLES.includes(role as TextRole)) block.role = role as TextRole;
	if (typeof chartId === 'string' && chartId !== '') block.chartId = chartId;
	return block;
}

/** A table's spec as read from anywhere: a source there is, and rows within the limits. */
export function parseTableSpec(value: unknown): TableSpec | null {
	if (!isRecord(value) || !TABLE_SOURCES.includes(value.source as TableSpec['source'])) return null;
	if (!isFiniteNumber(value.rows)) return null;
	const rows = Math.max(MIN_TABLE_ROWS, Math.min(MAX_TABLE_ROWS, Math.round(value.rows)));
	const look = TABLE_LOOKS.includes(value.look as TableLook) ? (value.look as TableLook) : 'names';
	const spec: TableSpec = { source: value.source as TableSpec['source'], look, rows };
	const language = LANGUAGES.find((code) => code === value.language);
	// English is the absence of a language, as for a template's words.
	if (language && language !== DEFAULT_LANGUAGE) spec.language = language;
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
	if (!PROJECTION_MODES.includes(view.projection as ProjectionMode)) return null;
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

// === The clipboard ===

/**
 * A copy as it goes on the clipboard: as it is, but for a table, which travels as
 * the text of no words with a spec that it is saved as, for a build from before to
 * paste it.
 */
export function clipboardCopy(copy: BlockCopy): object {
	if (copy.kind !== 'table') return copy;
	const { table, style, frame, rotation } = copy;
	return { kind: 'text', text: '', style, frame, ...(rotation ? { rotation } : {}), table };
}

/**
 * A copy as the clipboard holds it, from anywhere: null for what is no copy. A turn
 * that does not read as an angle is none. A text with a table's spec is the table
 * it was copied as (`clipboardCopy`); a copy that never left the model is read as
 * it is.
 */
export function parseBlockCopy(value: unknown): BlockCopy | null {
	if (!isRecord(value)) return null;
	const frame = parseRect(value.frame);
	if (!frame) return null;
	if (value.kind === 'chart') {
		const chart = parseChart(value.chart);
		return chart ? { kind: 'chart', chart, frame } : null;
	}
	const style = parseTextStyle(value.style);
	const table = parseTableSpec(value.table);
	let copy: BlockCopy;
	if (value.kind === 'table' && table && style) {
		copy = { kind: 'table', table, style, frame };
	} else if (value.kind === 'text' && typeof value.text === 'string' && style) {
		copy = table
			? { kind: 'table', table, style, frame }
			: { kind: 'text', text: value.text, style, frame };
	} else {
		return null;
	}
	const rotation = isFiniteNumber(value.rotation) ? normalizeRotation(value.rotation) : 0;
	if (rotation !== 0) copy.rotation = rotation;
	return copy;
}
