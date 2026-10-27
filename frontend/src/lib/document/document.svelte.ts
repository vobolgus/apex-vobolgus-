/**
 * The PDF document: its pages and charts, kept in localStorage.
 *
 * Change it through the methods: they keep every frame inside its page's content
 * box at its chart's aspect, and save. Saves are debounced, so a drag may call
 * `updateItem` on every move; `flush` writes a pending save at once. Nothing is
 * read from storage until `load` (call it on mount, so the server render and
 * hydration agree on an empty document).
 */

import type { ProjectionMode } from '$lib/state/projection-transition.svelte';
import { findPlacement, fitFrame, rotateLayout } from './geometry';
import type { ChartSnapshot, DocItem, DocPage, PageOrientation, Rect } from './types';

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
	 * Why a chart at `aspect` cannot be added, or null when it can: the document
	 * holds `MAX_CHARTS`, or it would need a new page past `MAX_PAGES`.
	 */
	addChartBlocker(aspect: number): 'charts' | 'pages' | null {
		if (this.chartCount >= MAX_CHARTS) return 'charts';
		if (this.canAddPage) return null;
		return findPlacement(this.pages, aspect).pageIndex === null ? 'pages' : null;
	}

	page(id: string): DocPage | undefined {
		return this.pages.find((page) => page.id === id);
	}

	pageIndex(id: string): number {
		return this.pages.findIndex((page) => page.id === id);
	}

	/**
	 * Place a copy of `chart` where Add to PDF puts it, on a new page if it fits
	 * nowhere. Check `addChartBlocker` first: this does not.
	 */
	addChart(chart: ChartSnapshot, thumb?: string): AddChartResult {
		const { pageIndex, frame } = findPlacement(this.pages, chart.aspect);
		if (pageIndex === null) this.pages.push(emptyPage('portrait'));
		const page = this.pages[pageIndex ?? this.pages.length - 1];
		const item: DocItem = { id: createId(), chart: $state.snapshot(chart), frame };
		if (thumb) item.thumb = thumb;
		page.items.push(item);
		this.#scheduleSave();
		return { pageId: page.id, itemId: item.id, newPage: pageIndex === null };
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
		this.pages.splice(index, 1);
		if (wasSelected) {
			this.selectedPageId = this.pages[Math.min(index, this.pages.length - 1)]?.id ?? null;
		}
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

	/** Turn a page; its layout turns with it (`rotateLayout`): rows become columns. */
	setOrientation(id: string, orientation: PageOrientation): void {
		const page = this.page(id);
		if (!page || page.orientation === orientation) return;
		const frames = rotateLayout(
			page.items.map((item) => ({ frame: item.frame, aspect: item.chart.aspect })),
			page.orientation,
			orientation
		);
		page.orientation = orientation;
		page.items.forEach((item, i) => {
			item.frame = { ...frames[i] };
		});
		this.#scheduleSave();
	}

	/** Set a chart's frame, kept inside the content box at the chart's aspect (width wins). */
	updateItem(pageId: string, itemId: string, frame: Rect): boolean {
		const page = this.page(pageId);
		const item = page?.items.find((it) => it.id === itemId);
		if (!page || !item) return false;
		item.frame = fitFrame(frame, item.chart.aspect, page.orientation);
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
		to.items.push({ ...item, frame: fitFrame(frame, item.chart.aspect, to.orientation) });
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
		this.#scheduleSave();
		return once(() => {
			const target = this.page(pageId);
			if (!target || this.pages.some((p) => p.items.some((it) => it.id === removed.id))) {
				return false;
			}
			if (target.items.length >= MAX_ITEMS_PER_PAGE || this.chartCount >= MAX_CHARTS) return false;
			const frame = fitFrame(removed.frame, removed.chart.aspect, target.orientation);
			target.items.splice(Math.min(index, target.items.length), 0, { ...removed, frame });
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
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	if (orientation !== 'portrait' && orientation !== 'landscape') return null;
	ids.add(id);
	const items = value.items
		.map((item) => parseItem(item, ids, orientation))
		.filter((item): item is DocItem => item !== null);
	return { id, orientation, items };
}

function parseItem(value: unknown, ids: Set<string>, orientation: PageOrientation): DocItem | null {
	if (!isRecord(value)) return null;
	const { id, thumb } = value;
	if (typeof id !== 'string' || id === '' || ids.has(id)) return null;
	const chart = parseChart(value.chart);
	const frame = parseRect(value.frame);
	if (!chart || !frame) return null;
	ids.add(id);
	const item: DocItem = { id, chart, frame: fitFrame(frame, chart.aspect, orientation) };
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
