/**
 * The saved document: how its pages are written to storage and read back.
 *
 * What is read is not trusted: it may be an older build's, another tab's or
 * anybody's. A broken page or block is dropped and the rest kept; every frame is
 * put back inside its page. The clipboard is read the same way (`parseBlockCopy`).
 *
 * The saved shape has a number, and the key it is kept under carries it, so that
 * no build writes over a shape it does not know. In the first (`…v1`) a page kept
 * its charts in `items` and its texts in `texts`, a table being a text with a `table`
 * and no words. The second (`…v2`), written now, is the model's own: a page's
 * `blocks`, each of a `kind`. A document found only in the first is brought to the
 * second as it is read (`parseFirstShape`); once it is saved in the second, the
 * first's copy is taken away, the browser having no room to keep both for long.
 */

import type { ProjectionMode } from '$lib/state/projection-transition.svelte';
import { chartsOf, layered, typesetOf } from './blocks';
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
	ChartBlock,
	ChartSnapshot,
	DocBlock,
	DocPage,
	LayoutTree,
	PageLayout,
	PageOrientation,
	PageTemplate,
	Rect,
	SkyMark,
	TableBlock,
	TableLook,
	TableSpec,
	TextBlock,
	TextRole,
	TextStyle,
	TurnMemo,
	TypesetBlock
} from './types';

/** Where the document is kept, in the shape written now. */
export const DOCUMENT_STORAGE_KEY = 'skycharts.document.v2';
/** Where it was kept in the first shape, and is still read from when nothing newer is there. */
export const FIRST_SHAPE_STORAGE_KEY = 'skycharts.document.v1';
/** Thumbnails are saved while their total stays under this many chars (≈ bytes). */
export const THUMB_BUDGET_CHARS = 2_000_000;
/** Rings on one chart, as the backend takes them (backend/src/handlers/export.rs). */
const MAX_MARKS = 16;

export type DocumentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserStorage(): DocumentStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/**
 * The saved document's pages, from the shape written now or else from the first;
 * null when there is none, or what is there is no document, or the storage cannot
 * be read.
 */
export function readDocument(storage: DocumentStorage | null): DocPage[] | null {
	if (!storage) return null;
	return (
		parseDocument(readJson(storage, DOCUMENT_STORAGE_KEY)) ??
		parseFirstShape(readJson(storage, FIRST_SHAPE_STORAGE_KEY))
	);
}

/** What is under `key`, read as JSON; undefined for nothing, or nothing that reads. */
function readJson(storage: DocumentStorage, key: string): unknown {
	try {
		const raw = storage.getItem(key);
		return raw === null ? undefined : JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * Save `pages` (plain data, no proxies), with their thumbnails while the storage has
 * room. Saved, the document needs its copy in the first shape no more.
 */
export function writeDocument(storage: DocumentStorage, pages: DocPage[]): void {
	const write = (budget: number): boolean => {
		try {
			storage.setItem(DOCUMENT_STORAGE_KEY, serialize(pages, budget));
			return true;
		} catch {
			return false;
		}
	};
	const forgetFirstShape = () => {
		try {
			storage.removeItem(FIRST_SHAPE_STORAGE_KEY);
		} catch {
			// It stays, and is read only while there is nothing newer.
		}
	};
	if (write(THUMB_BUDGET_CHARS)) return forgetFirstShape();
	// Over the quota: the first shape's copy goes, to make room, then the thumbnails. The
	// charts matter more. If that fails too, storage is unavailable; the document lives
	// for this session only.
	forgetFirstShape();
	if (!write(THUMB_BUDGET_CHARS)) write(0);
}

/** The saved form: thumbnails kept in document order while they fit `budget`. */
function serialize(pages: DocPage[], budget: number): string {
	let left = budget;
	const saved = pages.map((page) => ({
		...page,
		blocks: page.blocks.map((block) => {
			if (block.kind !== 'chart') return block;
			const { thumb, ...chart } = block;
			if (!thumb || thumb.length > left) return chart;
			left -= thumb.length;
			return { ...chart, thumb };
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

/** The pages of a document as it is saved now; null for what is no document. */
export function parseDocument(value: unknown): DocPage[] | null {
	if (!isRecord(value) || !Array.isArray(value.pages)) return null;
	const ids = new Set<string>();
	return value.pages
		.map((page) => parsePage(page, ids))
		.filter((page): page is DocPage => page !== null);
}

// === The first shape ===

/** The pages of a document as the first shape saved it; null for what is no document. */
export function parseFirstShape(value: unknown): DocPage[] | null {
	if (!isRecord(value) || !Array.isArray(value.pages)) return null;
	return parseDocument({ pages: value.pages.map(fromFirstShape) });
}

/**
 * A page saved in the first shape, in the second: its charts, then its texts, one
 * list. Nothing is judged here but what the shapes differ in; what does not read as
 * a page or a block is passed on as it is, for the parser to drop.
 */
function fromFirstShape(page: unknown): unknown {
	if (!isRecord(page)) return page;
	const { items, texts, ...rest } = page;
	// Without its charts' list it was no page then, and is none now, whatever else it carries.
	if (!Array.isArray(items)) return { ...rest, blocks: undefined };
	const blocks = [
		...items.map((item) => (isRecord(item) ? { ...item, kind: 'chart' } : item)),
		...(Array.isArray(texts) ? texts.map(typesetFromFirstShape) : [])
	];
	return { ...rest, blocks };
}

/**
 * A text of the first shape: a table when it carried a table's spec that reads as
 * one, and then without the empty words it had to have; else a text. Words were
 * asked of both: one with none that read as words is no block.
 */
function typesetFromFirstShape(text: unknown): unknown {
	if (!isRecord(text)) return text;
	const { text: words, ...rest } = text;
	if (typeof words !== 'string') return { ...rest, kind: undefined };
	return parseTableSpec(text.table) ? { ...rest, kind: 'table' } : { ...text, kind: 'text' };
}

// === Pages ===

function parsePage(value: unknown, ids: Set<string>): DocPage | null {
	if (!isRecord(value) || !Array.isArray(value.blocks)) return null;
	const { id, orientation } = value;
	if (!isOrientation(orientation)) return null;
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	ids.add(id);
	const read = layered(
		value.blocks
			.map((block) => parseBlock(block, ids, orientation))
			.filter((block): block is DocBlock => block !== null)
	);
	const charts = chartsOf({ blocks: read });
	const type = typesetOf({ blocks: read }).slice(0, MAX_TEXTS_PER_PAGE);
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

/** A block of a kind there is, with an id no page or block before it has; else null. */
function parseBlock(
	value: unknown,
	ids: Set<string>,
	orientation: PageOrientation
): DocBlock | null {
	if (!isRecord(value)) return null;
	const { id } = value;
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	const block = blockOfKind(value, id, orientation);
	if (block) ids.add(id);
	return block;
}

function blockOfKind(value: Json, id: string, orientation: PageOrientation): DocBlock | null {
	switch (value.kind) {
		case 'chart':
			return parseChartBlock(value, id, orientation);
		case 'text':
			return parseTextBlock(value, id, orientation);
		case 'table':
			return parseTableBlock(value, id, orientation);
		default:
			return null;
	}
}

function parseChartBlock(value: Json, id: string, orientation: PageOrientation): ChartBlock | null {
	const { thumb } = value;
	const chart = parseChart(value.chart);
	const frame = parseRect(value.frame);
	if (!chart || !frame) return null;
	const item: ChartBlock = {
		kind: 'chart',
		id,
		chart,
		frame: keptFrame(frame, chart.aspect, orientation)
	};
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

function parseTextBlock(value: Json, id: string, orientation: PageOrientation): TextBlock | null {
	const { text } = value;
	const style = parseTextStyle(value.style);
	const frame = parseRect(value.frame);
	if (typeof text !== 'string' || !style || !frame) return null;
	const parsed: TextBlock = { kind: 'text', id, text: text.slice(0, MAX_TEXT_CHARS), style, frame };
	return typeset(parsed, value, orientation);
}

function parseTableBlock(value: Json, id: string, orientation: PageOrientation): TableBlock | null {
	const table = parseTableSpec(value.table);
	const style = parseTextStyle(value.style);
	const frame = parseRect(value.frame);
	if (!table || !style || !frame) return null;
	return typeset({ kind: 'table', id, table, style, frame }, value, orientation);
}

/**
 * What a text and a table are read alike: the turn (what does not read as an angle
 * is upright), the frame fitted to the page at that turn, the part it plays and the
 * chart it is told to read.
 */
function typeset<B extends TypesetBlock>(block: B, value: Json, orientation: PageOrientation): B {
	const rotation = isFiniteNumber(value.rotation) ? normalizeRotation(value.rotation) : 0;
	block.frame = fitTextFrame(block.frame, orientation, rotation);
	if (rotation !== 0) block.rotation = rotation;
	if (TEXT_ROLES.includes(value.role as TextRole)) block.role = value.role as TextRole;
	if (typeof value.chartId === 'string' && value.chartId !== '') block.chartId = value.chartId;
	return block;
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

// === The clipboard ===

/**
 * A copy as the clipboard holds it, from anywhere: null for what is no copy. A turn
 * that does not read as an angle is none. A table copied by a build that knew the
 * first shape came as a text with a table's spec, and is read as the table it was.
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
