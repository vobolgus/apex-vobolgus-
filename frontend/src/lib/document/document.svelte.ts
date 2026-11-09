/**
 * The PDF document: its pages and charts, kept in localStorage.
 *
 * Change it through the methods: they keep every frame inside its page's content
 * box at its chart's aspect, and save. Saves are debounced, so a drag may call
 * `updateItem` on every move; `flush` writes a pending save at once. Nothing is
 * read from storage until `load` (call it on mount, so the server render and
 * hydration agree on an empty document).
 *
 * Add to PDF and a turn lay a page out with the arranger (`planAdd`, `turnLayout`).
 * A drag, resize or nudge, or a chart dropped on a page, makes that page `manual`:
 * Add then moves nothing there. A turn re-lays the page and remembers it as it was,
 * so that turning back restores it; any other change to the page forgets that.
 */

import type { ProjectionMode } from '$lib/state/projection-transition.svelte';
import { chartKind, planAdd, turnLayout, type PlacedChart } from './arrange';
import { contentBox, fitFrame } from './geometry';
import type {
	ChartSnapshot,
	DocItem,
	DocPage,
	LayoutTree,
	PageLayout,
	PageOrientation,
	Rect,
	TurnMemo
} from './types';

export const DOCUMENT_STORAGE_KEY = 'skycharts.document.v1';
/**
 * The backend's limits (backend/src/handlers/document.rs): a document past them
 * cannot be exported, so the editor does not build one.
 */
export const MAX_PAGES = 100;
export const MAX_ITEMS_PER_PAGE = 50;
export const MAX_CHARTS = 200;
/** Thumbnails are saved while their total stays under this many chars (≈ bytes). */
export const THUMB_BUDGET_CHARS = 2_000_000;
const SAVE_DELAY_MS = 250;

export type DocumentStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface AddChartResult {
	pageId: string;
	itemId: string;
	/** Whether the chart fitted nowhere and got a page of its own. */
	newPage: boolean;
	/** Whether charts already on the page moved or changed size to make room. */
	relaid: boolean;
	/**
	 * Takes the Add back (once): the page as it was before, or no page if the Add opened
	 * it. False, and nothing happens, once the page has changed since.
	 */
	undo: () => boolean;
}

let fallbackCounter = 0;

/** `crypto.randomUUID()`, which plain http on a LAN address does not have. */
export function createId(): string {
	try {
		if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
	} catch {
		// Fall through.
	}
	fallbackCounter += 1;
	const random = Math.random().toString(36).slice(2, 10);
	return `${Date.now().toString(36)}-${random}-${fallbackCounter.toString(36)}`;
}

function browserStorage(): DocumentStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export class DocumentStore {
	pages = $state<DocPage[]>([]);
	selectedPageId = $state<string | null>(null);
	panelOpen = $state(true);

	readonly #storage: DocumentStorage | null;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(storage: DocumentStorage | null = browserStorage()) {
		this.#storage = storage;
	}

	get pageCount(): number {
		return this.pages.length;
	}

	get chartCount(): number {
		return this.pages.reduce((sum, page) => sum + page.items.length, 0);
	}

	/** Whether another page fits under `MAX_PAGES`. */
	get canAddPage(): boolean {
		return this.pages.length < MAX_PAGES;
	}

	/**
	 * Why `chart` cannot be added, or null when it can: the document holds
	 * `MAX_CHARTS`, or the chart would need a new page past `MAX_PAGES`.
	 */
	addChartBlocker(chart: Pick<ChartSnapshot, 'view' | 'aspect'>): 'charts' | 'pages' | null {
		if (this.chartCount >= MAX_CHARTS) return 'charts';
		if (this.canAddPage) return null;
		const plan = planAdd(this.pages, { kind: chartKind(chart), aspect: chart.aspect });
		return plan.pageIndex === null ? 'pages' : null;
	}

	page(id: string): DocPage | undefined {
		return this.pages.find((page) => page.id === id);
	}

	pageIndex(id: string): number {
		return this.pages.findIndex((page) => page.id === id);
	}

	/**
	 * Place a copy of `chart` where Add to PDF puts it (`planAdd`): the charts on that
	 * page may move to make room, or it gets a page of its own. Check
	 * `addChartBlocker` first: this does not.
	 */
	addChart(chart: ChartSnapshot, thumb?: string): AddChartResult {
		const plan = planAdd(this.pages, { kind: chartKind(chart), aspect: chart.aspect });
		const newPage = plan.pageIndex === null;
		if (newPage) this.pages.push(emptyPage(plan.orientation));
		const page = this.pages[plan.pageIndex ?? this.pages.length - 1];
		const before = newPage ? null : $state.snapshot(page);
		const item: DocItem = {
			id: createId(),
			chart: $state.snapshot(chart),
			frame: plan.items.find((placed) => placed.index < 0)!.frame
		};
		if (thumb) item.thumb = thumb;
		page.items = placeItems(page.items, plan.items, item);
		setLayout(page, { manual: plan.manual, layout: plan.layout });
		this.#scheduleSave();
		const after = pageState(page);
		const undo = once(() => {
			const index = this.pageIndex(page.id);
			const target = this.pages[index];
			if (!target || pageState(target) !== after) return false;
			if (!before) {
				this.#dropPage(index);
			} else {
				const current = target.items;
				target.items = before.items.map(({ id, frame }) => {
					const restored = current.find((it) => it.id === id)!;
					restored.frame = frame;
					return restored;
				});
				setLayout(target, before);
			}
			this.#scheduleSave();
			return true;
		});
		return { pageId: page.id, itemId: item.id, newPage, relaid: plan.relaid, undo };
	}

	/** Append an empty page; returns its id. */
	addPage(orientation: PageOrientation = 'portrait'): string {
		const page = emptyPage(orientation);
		this.pages.push(page);
		this.#scheduleSave();
		return page.id;
	}

	/**
	 * Delete a page; the returned function puts it back where it was (once, and only
	 * while the limits leave room) and says whether it did.
	 */
	removePage(id: string): () => boolean {
		const index = this.pageIndex(id);
		if (index < 0) return () => false;
		const removed = $state.snapshot(this.pages[index]);
		const wasSelected = this.selectedPageId === id;
		this.#dropPage(index);
		this.#scheduleSave();
		return once(() => {
			if (this.pageIndex(removed.id) >= 0 || !this.canAddPage) return false;
			if (this.chartCount + removed.items.length > MAX_CHARTS) return false;
			this.pages.splice(Math.min(index, this.pages.length), 0, removed);
			if (wasSelected) this.selectedPageId = removed.id;
			this.#scheduleSave();
			return true;
		});
	}

	/**
	 * Turn a page; its charts are laid out again on it (`turnLayout`): rows become
	 * columns, and turning back restores the page as it was.
	 */
	setOrientation(id: string, orientation: PageOrientation): void {
		const page = this.page(id);
		if (!page || page.orientation === orientation) return;
		const plan = turnLayout($state.snapshot(page), orientation);
		page.orientation = orientation;
		page.items = placeItems(page.items, plan.items);
		setLayout(page, plan);
		this.#scheduleSave();
	}

	/**
	 * Set a chart's frame, kept inside the content box at the chart's aspect (width
	 * wins). A frame that changes makes the page hand-arranged.
	 */
	updateItem(pageId: string, itemId: string, frame: Rect): boolean {
		const page = this.page(pageId);
		const item = page?.items.find((it) => it.id === itemId);
		if (!page || !item) return false;
		const fitted = fitFrame(frame, item.chart.aspect, page.orientation);
		if (sameFrame(fitted, item.frame)) return true;
		item.frame = fitted;
		setLayout(page, { manual: true });
		this.#scheduleSave();
		return true;
	}

	/**
	 * Move a chart to `toPageId` (on top of its charts) at `frame`, fitted like
	 * `updateItem`. A page holding `MAX_ITEMS_PER_PAGE` takes no more.
	 */
	moveItem(itemId: string, toPageId: string, frame: Rect): boolean {
		const from = this.pages.find((page) => page.items.some((it) => it.id === itemId));
		const to = this.page(toPageId);
		if (!from || !to) return false;
		if (from === to) return this.updateItem(toPageId, itemId, frame);
		if (to.items.length >= MAX_ITEMS_PER_PAGE) return false;
		const index = from.items.findIndex((it) => it.id === itemId);
		const item = $state.snapshot(from.items[index]);
		from.items.splice(index, 1);
		setLayout(from, { manual: from.manual });
		to.items.push({ ...item, frame: fitFrame(frame, item.chart.aspect, to.orientation) });
		setLayout(to, { manual: true });
		this.#scheduleSave();
		return true;
	}

	/**
	 * Delete a chart; the returned function puts it back on its page (once, if that
	 * page still exists and the limits leave room) and says whether it did.
	 */
	removeItem(pageId: string, itemId: string): () => boolean {
		const page = this.page(pageId);
		const index = page ? page.items.findIndex((it) => it.id === itemId) : -1;
		if (!page || index < 0) return () => false;
		const removed = $state.snapshot(page.items[index]);
		page.items.splice(index, 1);
		setLayout(page, { manual: page.manual });
		this.#scheduleSave();
		return once(() => {
			const target = this.page(pageId);
			if (!target || this.pages.some((p) => p.items.some((it) => it.id === removed.id))) {
				return false;
			}
			if (target.items.length >= MAX_ITEMS_PER_PAGE || this.chartCount >= MAX_CHARTS) return false;
			const frame = keptFrame(removed.frame, removed.chart.aspect, target.orientation);
			target.items.splice(Math.min(index, target.items.length), 0, { ...removed, frame });
			setLayout(target, { manual: target.manual });
			this.#scheduleSave();
			return true;
		});
	}

	/**
	 * Replace the document with the saved one. Data that does not parse is ignored:
	 * a broken page or chart is dropped, the rest kept. Returns whether anything loaded.
	 */
	load(): boolean {
		let raw: string | null;
		try {
			raw = this.#storage?.getItem(DOCUMENT_STORAGE_KEY) ?? null;
		} catch {
			return false;
		}
		if (raw === null) return false;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return false;
		}
		const pages = parseDocument(parsed);
		if (!pages) return false;
		this.pages = pages;
		if (this.selectedPageId !== null && !this.page(this.selectedPageId)) {
			this.selectedPageId = null;
		}
		return true;
	}

	/** Write a pending save now. */
	flush(): void {
		if (this.#saveTimer === null) return;
		clearTimeout(this.#saveTimer);
		this.#saveTimer = null;
		this.#save();
	}

	/** Remove the page at `index`; a selected page passes the selection to its neighbour. */
	#dropPage(index: number) {
		const [page] = this.pages.splice(index, 1);
		if (page && this.selectedPageId === page.id) {
			this.selectedPageId = this.pages[Math.min(index, this.pages.length - 1)]?.id ?? null;
		}
	}

	#scheduleSave() {
		if (!this.#storage || this.#saveTimer !== null) return;
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = null;
			this.#save();
		}, SAVE_DELAY_MS);
	}

	#save() {
		const storage = this.#storage;
		if (!storage) return;
		const pages = $state.snapshot(this.pages);
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
}

function emptyPage(orientation: PageOrientation): DocPage {
	return { id: createId(), orientation, items: [] };
}

/**
 * The page's items in the arranger's order with its frames (copied); `added` is the
 * chart Add brings (index −1). The items keep their identity.
 */
function placeItems(items: DocItem[], plan: readonly PlacedChart[], added?: DocItem): DocItem[] {
	return plan.map(({ index, frame }) => {
		const item = index < 0 ? added! : items[index];
		item.frame = { ...frame };
		return item;
	});
}

/**
 * Set how a page was laid out. An absent field is the default (automatic, no
 * layout, no memo), so a change that passes only `manual` forgets the layout
 * (its frames are no longer the arranger's) and the turn memo.
 */
function setLayout(
	page: DocPage,
	{ manual, layout, turnMemo }: { manual?: boolean; layout?: PageLayout; turnMemo?: TurnMemo }
) {
	if (manual) page.manual = true;
	else delete page.manual;
	if (layout) page.layout = layout;
	else delete page.layout;
	if (turnMemo) page.turnMemo = turnMemo;
	else delete page.turnMemo;
}

/** What `undo` of an Add compares: a page changed since the Add takes no undo. */
function pageState(page: DocPage): string {
	const { orientation, manual, layout, turnMemo } = page;
	const items = page.items.map((it) => [it.id, it.frame]);
	return JSON.stringify([orientation, items, !!manual, layout ?? null, turnMemo ?? null]);
}

function sameFrame(a: Rect, b: Rect): boolean {
	return (
		Math.abs(a.x - b.x) <= 1e-9 &&
		Math.abs(a.y - b.y) <= 1e-9 &&
		Math.abs(a.w - b.w) <= 1e-9 &&
		Math.abs(a.h - b.h) <= 1e-9
	);
}

/**
 * `frame` as it is when it lies inside the content box at `aspect`, as every frame
 * the editor or the arranger makes does, else fitted in (`fitFrame`). A crowded
 * turn lays charts out under the smallest side; raised to it, they would overlap.
 */
function keptFrame(frame: Rect, aspect: number, o: PageOrientation): Rect {
	const box = contentBox(o);
	const inside =
		frame.x >= box.x - 1e-6 &&
		frame.y >= box.y - 1e-6 &&
		frame.x + frame.w <= box.x + box.w + 1e-6 &&
		frame.y + frame.h <= box.y + box.h + 1e-6;
	return inside && Math.abs(frame.w / frame.h - aspect) <= 1e-9 * aspect
		? frame
		: fitFrame(frame, aspect, o);
}

/** `fn` the first time; false every time after. */
function once(fn: () => boolean): () => boolean {
	let done = false;
	return () => {
		if (done) return false;
		done = true;
		return fn();
	};
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

// === Parsing saved data ===

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

function parseDocument(value: unknown): DocPage[] | null {
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
	if (value.manual === true) page.manual = true;
	const layout = parseLayout(value.layout, items.length);
	if (layout) page.layout = layout;
	const turnMemo = parseTurnMemo(value.turnMemo, page);
	if (turnMemo) page.turnMemo = turnMemo;
	return page;
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
	return item;
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
	return {
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
