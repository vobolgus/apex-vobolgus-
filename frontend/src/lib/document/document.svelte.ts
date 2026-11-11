/**
 * The PDF document: its pages, their charts and text, kept in localStorage.
 *
 * Change it through the methods: they keep every frame inside its page's content
 * box (a chart's at its aspect), and save. Saves are debounced, so a drag may call
 * `updateItem` on every move; `flush` writes a pending save at once. Nothing is
 * read from storage until `load` (call it on mount, so the server render and
 * hydration agree on an empty document). How the document is written and read back
 * is `storage.ts`'s.
 *
 * Add to PDF and a turn lay a page out with the arranger (`planAdd`, `turnLayout`).
 * A drag, resize or nudge, or a chart dropped on a page, makes that page `manual`:
 * Add then moves nothing there. A turn re-lays the page and remembers it as it was,
 * so that turning back restores it; any other change to the page forgets that.
 *
 * A page with text on it is hand-arranged too: the arranger lays out charts, and
 * would lay them over the text. A turn moves a page's text with the content box.
 *
 * A page a template laid out remembers which (`template`) while it is what the
 * template made: a turn then lays it out as that template does the other way.
 * Whatever adds, removes or moves a chart or a text there by hand forgets it; what a
 * text says and how it is set do not.
 */

import { chartKind, planAdd, turnLayout, type PlacedChart } from './arrange';

export { isBlank } from './arrange';
import {
	clampPosition,
	contentBox,
	fitFrame,
	GUTTER_MM,
	keptFrame,
	nearestFreePlace,
	overlaps,
	rotatedBounds
} from './geometry';
import {
	browserStorage,
	parseBlockCopy,
	parseTableSpec,
	readDocument,
	writeDocument,
	type DocumentStorage
} from './storage';
import {
	anchoredFrame,
	boundItem,
	fitTextFrame,
	MAX_TEXT_CHARS,
	normalizeRotation,
	textBounds,
	MAX_TEXTS_PER_PAGE
} from './text';
import { layTemplate, type LaidPage, type TemplateOptions } from './templates';
import type {
	BlockCopy,
	ChartSnapshot,
	DocItem,
	DocPage,
	DocText,
	PageLayout,
	PageOrientation,
	PageTemplate,
	Rect,
	TableSpec,
	TextStyle,
	TurnMemo
} from './types';

/**
 * The backend's limits (backend/src/handlers/document.rs): a document past them
 * cannot be exported, so the editor does not build one.
 */
export const MAX_PAGES = 100;
export const MAX_ITEMS_PER_PAGE = 50;
export const MAX_CHARTS = 200;
const SAVE_DELAY_MS = 250;

/** How far a copy pasted with no room and no pointer stands off what is in its place, mm down and right. */
const PASTE_OFFSET_MM = 5;
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
	 *
	 * A page that is still what a template made of it (`template`) is laid out by
	 * that template for the new orientation instead (`#turnTemplate`). `height` is the
	 * measure for its text, as the picker brings one to `layTemplate`; without it a
	 * text is as tall as the lines it was typed in, until the editor says otherwise
	 * (`setTextHeight`).
	 */
	setOrientation(
		id: string,
		orientation: PageOrientation,
		height?: TemplateOptions['height']
	): void {
		const page = this.page(id);
		if (!page || page.orientation === orientation) return;
		if (page.template && this.#turnTemplate(page, orientation, height)) {
			this.#scheduleSave();
			return;
		}
		const plan = turnLayout($state.snapshot(page), orientation);
		const from = page.orientation;
		page.orientation = orientation;
		page.items = placeItems(page.items, plan.items);
		for (const text of page.texts ?? []) text.frame = turnedTextFrame(text, from, orientation);
		setLayout(page, hasText(page) ? { ...plan, manual: true } : plan);
		this.#scheduleSave();
	}

	/**
	 * Turn a page as the template that made it lays it out the other way
	 * (`layTemplate`, `again`): the charts in the template's places, its texts where it
	 * puts them with their words, faces and ids kept, and the owner's own texts (no
	 * `role`) moved with the content box as on any turn. The layout is the template's
	 * for the orientation and nothing else, so turning back gives the page it was.
	 *
	 * False, and nothing is touched, when the template would not make this one page of
	 * it: charts that would go on further pages, a chart to make or to drop, or a text
	 * of the template it does not find as it is (told to read another chart since).
	 * The page is then turned like any other, and forgets the template.
	 */
	#turnTemplate(
		page: DocPage,
		orientation: PageOrientation,
		height: TemplateOptions['height']
	): boolean {
		const { id, language } = page.template!;
		const options: TemplateOptions = { orientation, language, again: true };
		if (height) options.height = height;
		const laid = layTemplate(id, $state.snapshot(page), options);
		if (laid.length !== 1) return false;
		const [{ charts, texts, dropped }] = laid;
		const items = charts.map((placed) =>
			placed.chart ? undefined : page.items.find((item) => item.id === placed.id)
		);
		const roled = (page.texts ?? []).filter((text) => text.role !== undefined);
		// Each laid text is one of the page's: the same part and words, of the same chart
		// where the part belongs to one (a caption, a key).
		const found = texts.map((placed) =>
			roled.findIndex(
				(text) =>
					text.role === placed.role &&
					text.text === placed.text &&
					(placed.chartId === undefined || text.chartId === placed.chartId)
			)
		);
		const each = (list: readonly unknown[]) => list.every((it, i) => list.indexOf(it) === i);
		const whole =
			!dropped?.length &&
			items.length === page.items.length &&
			items.every((item) => item !== undefined) &&
			each(items) &&
			found.length === roled.length &&
			found.every((index) => index >= 0) &&
			each(found);
		if (!whole) return false;

		const from = page.orientation;
		page.orientation = orientation;
		page.items = items.map((item, i) => {
			item!.frame = fitFrame(charts[i].frame, item!.chart.aspect, orientation);
			return item!;
		});
		for (const text of page.texts ?? []) {
			if (text.role === undefined) text.frame = turnedTextFrame(text, from, orientation);
		}
		texts.forEach((placed, i) => {
			const text = roled[found[i]];
			setRotation(text, placed.rotation ?? 0);
			text.frame = fitTextFrame(placed.frame, orientation, text.rotation);
		});
		setLayout(page, { manual: true, template: page.template });
		return true;
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

	// === Text ===

	/**
	 * Put a text on a page, over its charts, its frame fitted to the page
	 * (`fitTextFrame`); the page is hand-arranged from then on. Returns the text's id,
	 * or null for a page that is not there or holds `MAX_TEXTS_PER_PAGE`.
	 */
	addText(pageId: string, text: Omit<DocText, 'id'>): string | null {
		const page = this.page(pageId);
		if (!page || (page.texts?.length ?? 0) >= MAX_TEXTS_PER_PAGE) return null;
		const added: DocText = {
			...$state.snapshot(text),
			id: createId(),
			text: text.text.slice(0, MAX_TEXT_CHARS),
			frame: fitTextFrame(text.frame, page.orientation, text.rotation)
		};
		setRotation(added, text.rotation ?? 0);
		page.texts = [...(page.texts ?? []), added];
		setLayout(page, { manual: true });
		this.#scheduleSave();
		return added.id;
	}

	/**
	 * Change a text: what it says, how it is set, where it is, the chart its fields
	 * read (`chartId: null` goes back to the nearest one), how far it is turned
	 * (`rotation`, degrees clockwise about its centre). Its frame is fitted to the
	 * page at its turn; the height follows the lines later (`setTextHeight`).
	 */
	updateText(
		pageId: string,
		textId: string,
		patch: {
			text?: string;
			style?: TextStyle;
			frame?: Rect;
			chartId?: string | null;
			rotation?: number;
			table?: TableSpec;
		}
	): boolean {
		const page = this.page(pageId);
		const text = page?.texts?.find((it) => it.id === textId);
		if (!page || !text) return false;
		const { frame, rotation } = text;
		if (patch.text !== undefined) text.text = patch.text.slice(0, MAX_TEXT_CHARS);
		if (patch.style) text.style = { ...patch.style };
		if (patch.table && text.table) text.table = parseTableSpec(patch.table) ?? text.table;
		if (patch.rotation !== undefined) setRotation(text, patch.rotation);
		if (patch.frame || patch.rotation !== undefined) {
			text.frame = fitTextFrame(patch.frame ?? text.frame, page.orientation, text.rotation);
		}
		if (patch.chartId === null) delete text.chartId;
		else if (patch.chartId !== undefined) text.chartId = patch.chartId;
		// Moved or turned, the page is no longer as its template left it; typed in, it is.
		const moved = !sameFrame(text.frame, frame) || text.rotation !== rotation;
		setLayout(page, { manual: true, template: moved ? undefined : page.template });
		this.#scheduleSave();
		return true;
	}

	/**
	 * The height a text turned out to be when it was laid out: only the box kept for
	 * it follows, from its own top-left corner down (`anchoredFrame`); nothing on the
	 * page has been arranged, and neither a turn of the page nor its template is
	 * forgotten.
	 */
	setTextHeight(pageId: string, textId: string, height: number): void {
		const page = this.page(pageId);
		const text = page?.texts?.find((it) => it.id === textId);
		if (!page || !text || !(height > 0) || Math.abs(text.frame.h - height) <= 1e-6) return;
		const { frame, rotation = 0 } = text;
		text.frame = fitTextFrame(
			anchoredFrame(frame, rotation, frame.w, height),
			page.orientation,
			rotation
		);
		this.#scheduleSave();
	}

	/**
	 * Move a text to `toPageId` (on top of its text) at `frame`, fitted like
	 * `updateText`. A page holding `MAX_TEXTS_PER_PAGE` takes no more. A text told
	 * which chart to read goes on reading it, from the other page; one that read the
	 * nearest reads the nearest where it lands, and on a page with no chart the one it
	 * read before, so that a table moved to a page of its own still lists its sky.
	 */
	moveText(textId: string, toPageId: string, frame: Rect): boolean {
		const from = this.pages.find((page) => page.texts?.some((it) => it.id === textId));
		const to = this.page(toPageId);
		if (!from || !to) return false;
		if (from === to) return this.updateText(toPageId, textId, { frame });
		if ((to.texts?.length ?? 0) >= MAX_TEXTS_PER_PAGE) return false;
		const index = from.texts!.findIndex((it) => it.id === textId);
		const moved = $state.snapshot(from.texts![index]);
		const read = boundItem(from, moved, this.pages);
		if (to.items.length === 0 && read) moved.chartId = read.id;
		from.texts!.splice(index, 1);
		setLayout(from, { manual: from.manual });
		to.texts = [
			...(to.texts ?? []),
			{ ...moved, frame: fitTextFrame(frame, to.orientation, moved.rotation) }
		];
		setLayout(to, { manual: true });
		this.#scheduleSave();
		return true;
	}

	/**
	 * Delete a text; the returned function puts it back on its page (once, if that
	 * page still exists and has room) and says whether it did.
	 */
	removeText(pageId: string, textId: string): () => boolean {
		const page = this.page(pageId);
		const index = page?.texts?.findIndex((it) => it.id === textId) ?? -1;
		if (!page || index < 0) return () => false;
		const removed = $state.snapshot(page.texts![index]);
		page.texts!.splice(index, 1);
		setLayout(page, { manual: page.manual });
		this.#scheduleSave();
		return once(() => {
			const target = this.page(pageId);
			if (!target || this.pages.some((p) => p.texts?.some((it) => it.id === removed.id))) {
				return false;
			}
			const texts = [...(target.texts ?? [])];
			if (texts.length >= MAX_TEXTS_PER_PAGE) return false;
			const frame = fitTextFrame(removed.frame, target.orientation, removed.rotation);
			texts.splice(Math.min(index, texts.length), 0, { ...removed, frame });
			target.texts = texts;
			setLayout(target, { manual: true });
			this.#scheduleSave();
			return true;
		});
	}

	// === Templates ===

	/**
	 * Lay a page out as a template says (`layTemplate`): the first of `laid` takes
	 * the page's place, the rest follow it as new pages, each with the charts named
	 * for it. A chart the template made (a finder card's close-up) is added; one it
	 * drops (the close-up before it) goes. Text a template put on the page before
	 * goes; the text its owner added stays on the first. Each page remembers the
	 * template that made it (`LaidPage.template`), for a turn. Nothing happens, and null
	 * comes back, when `laid` does not account for the page's charts each once, or the
	 * document has no room for the pages or the charts. The returned function puts the
	 * page back as it was and takes the new ones away (once, while they are all still
	 * there) and says whether it did.
	 */
	layPage(pageId: string, laid: readonly LaidPage[]): (() => boolean) | null {
		const index = this.pageIndex(pageId);
		const page = this.pages[index];
		if (!page || laid.length === 0) return null;
		const placed = laid.flatMap((part) => part.charts);
		const made = placed.filter((chart) => chart.chart !== undefined);
		const kept = placed.filter((chart) => chart.chart === undefined).map((chart) => chart.id);
		const dropped = laid.flatMap((part) => part.dropped ?? []);
		// Each of the page's charts once, kept or dropped: as many names, and every chart among them.
		const whole =
			kept.length + dropped.length === page.items.length &&
			page.items.every((item) => kept.includes(item.id) !== dropped.includes(item.id));
		if (!whole || this.pages.length + laid.length - 1 > MAX_PAGES) return null;
		if (this.chartCount - dropped.length + made.length > MAX_CHARTS) return null;
		if (laid.some((part) => part.charts.length > MAX_ITEMS_PER_PAGE)) return null;

		const before = $state.snapshot(page);
		// A made chart gets its id here; the text that points at it by name follows.
		const ids = made.map((chart) => ({ name: chart.id, id: createId() }));
		const idOf = (name: string | undefined) => ids.find((it) => it.name === name)?.id ?? name;
		const own = (page.texts ?? []).filter((text) => text.role === undefined);
		const pages = laid.map((part, at): DocPage => {
			const next: DocPage = {
				id: at === 0 ? page.id : createId(),
				orientation: part.orientation,
				items: part.charts.map((entry): DocItem => {
					const source = before.items.find((it) => it.id === entry.id);
					const chart = { ...(entry.chart ?? source!.chart) };
					if (entry.marks?.length) chart.marks = entry.marks.map((mark) => ({ ...mark }));
					else delete chart.marks;
					const item: DocItem = {
						...source,
						id: idOf(entry.id)!,
						chart,
						frame: fitFrame(entry.frame, chart.aspect, part.orientation)
					};
					if (entry.closeUpOf !== undefined) item.closeUpOf = entry.closeUpOf;
					return item;
				})
			};
			const texts = [
				...(at === 0 ? $state.snapshot(own) : []),
				...part.texts.map((text) => {
					const added: DocText = { ...text, id: createId() };
					if (text.chartId !== undefined) added.chartId = idOf(text.chartId);
					return added;
				})
			]
				.slice(0, MAX_TEXTS_PER_PAGE)
				.map((text) => ({
					...text,
					frame: fitTextFrame(text.frame, part.orientation, text.rotation)
				}));
			if (texts.length > 0) next.texts = texts;
			// Arranged by the arranger while it holds charts alone; by hand with text among them.
			setLayout(
				next,
				texts.length > 0
					? { manual: true, template: part.template }
					: { layout: part.layout, template: part.template }
			);
			return next;
		});
		this.pages.splice(index, 1, ...pages);
		this.#scheduleSave();
		const added = pages.slice(1).map((next) => next.id);
		return once(() => {
			const at = this.pageIndex(pageId);
			if (at < 0 || added.some((id) => this.pageIndex(id) < 0)) return false;
			for (const id of added) this.#dropPage(this.pageIndex(id));
			this.pages[this.pageIndex(pageId)] = before;
			this.#scheduleSave();
			return true;
		});
	}

	// === Copy and paste ===

	/** A copy of the chart or text `id`, to paste on any page; null when there is none. */
	copyBlock(id: string): BlockCopy | null {
		for (const page of this.pages) {
			const item = page.items.find((it) => it.id === id);
			if (item) {
				const { chart, frame } = $state.snapshot(item);
				return { kind: 'chart', chart, frame };
			}
			const text = page.texts?.find((it) => it.id === id);
			if (text) {
				const { text: words, style, frame, rotation, table } = $state.snapshot(text);
				const copy: BlockCopy = { kind: 'text', text: words, style, frame };
				if (rotation) copy.rotation = rotation;
				if (table) copy.table = table;
				return copy;
			}
		}
		return null;
	}

	/**
	 * Put a copy on a page, at its own size (smaller only where the page itself is):
	 * where it was copied from if that is clear of everything, else in the free place
	 * nearest to there (`nearestFreePlace`). On a page with no room for it, it goes
	 * over what is there: its middle at `at` (where the pointer is on that page, mm),
	 * or without a pointer a little down and to the right of where it was. The page is
	 * hand-arranged from then on. Returns what was added; `'full'` when the page or
	 * the document holds no more; null for something that is no copy.
	 */
	pasteBlock(
		pageId: string,
		value: unknown,
		at?: { x: number; y: number }
	): { kind: BlockCopy['kind']; id: string } | 'full' | null {
		const page = this.page(pageId);
		const copy = page ? parseBlockCopy(value) : null;
		if (!page || !copy) return null;
		const { frame } = copy;
		if (copy.kind === 'chart') {
			const { chart } = copy;
			if (page.items.length >= MAX_ITEMS_PER_PAGE || this.chartCount >= MAX_CHARTS) return 'full';
			const sized = fitFrame(frame, chart.aspect, page.orientation);
			const item: DocItem = { id: createId(), chart, frame: pastePlace(page, sized, 0, at) };
			page.items.push(item);
			setLayout(page, { manual: true });
			this.#scheduleSave();
			return { kind: 'chart', id: item.id };
		}
		if ((page.texts?.length ?? 0) >= MAX_TEXTS_PER_PAGE) return 'full';
		const { text, style, rotation = 0, table } = copy;
		const sized = fitTextFrame(frame, page.orientation, rotation);
		const placed = pastePlace(page, sized, rotation, at);
		const pasted: Omit<DocText, 'id'> = { text, style, frame: placed, rotation };
		if (table) pasted.table = table;
		const id = this.addText(pageId, pasted);
		return id ? { kind: 'text', id } : 'full';
	}

	/**
	 * Replace the document with the saved one. Data that does not parse is ignored:
	 * a broken page or chart is dropped, the rest kept. Returns whether anything loaded.
	 */
	load(): boolean {
		const pages = readDocument(this.#storage);
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
		if (this.#storage) writeDocument(this.#storage, $state.snapshot(this.pages));
	}
}

function emptyPage(orientation: PageOrientation): DocPage {
	return { id: createId(), orientation, items: [] };
}

/** Turn a text to `degrees`; an upright one carries no `rotation`. */
function setRotation(text: DocText, degrees: number) {
	const rotation = normalizeRotation(degrees);
	if (rotation === 0) delete text.rotation;
	else text.rotation = rotation;
}

/**
 * Where a pasted `frame` (turned `rotation`, already the size it will be) goes on
 * `page`: see `pasteBlock`. What it takes up on the page is what is placed.
 */
function pastePlace(
	page: DocPage,
	frame: Rect,
	rotation: number,
	at: { x: number; y: number } | undefined
): Rect {
	const box = contentBox(page.orientation);
	const others = [...page.items.map((it) => it.frame), ...(page.texts ?? []).map(textBounds)];
	const bounds = rotatedBounds(frame, rotation);
	const clear = !others.some((other) => overlaps(bounds, other, GUTTER_MM));
	let place = clear ? bounds : nearestFreePlace(bounds, others, page.orientation);
	if (!place && at) {
		// No room: over what is there, under the pointer.
		place = clampPosition({ ...bounds, x: at.x - bounds.w / 2, y: at.y - bounds.h / 2 }, box);
	}
	if (!place) {
		// And with no pointer, off whatever lies exactly where it was, so that it shows.
		place = bounds;
		const taken = (it: Rect) =>
			others.some((other) => Math.abs(other.x - it.x) < 0.5 && Math.abs(other.y - it.y) < 0.5);
		for (let i = 0; i < MAX_ITEMS_PER_PAGE && taken(place); i++) {
			const next = clampPosition(
				{ ...place, x: place.x + PASTE_OFFSET_MM, y: place.y + PASTE_OFFSET_MM },
				box
			);
			if (sameFrame(next, place)) break;
			place = next;
		}
	}
	return { ...frame, x: frame.x + place.x - bounds.x, y: frame.y + place.y - bounds.y };
}

function hasText(page: Pick<DocPage, 'texts'>): boolean {
	return (page.texts?.length ?? 0) > 0;
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
 * layout, no memo, no template), so a change that passes only `manual` forgets the
 * layout (its frames are no longer the arranger's), the turn memo, and the template
 * the page was laid out as (it is no longer what that made).
 */
function setLayout(
	page: DocPage,
	{
		manual,
		layout,
		turnMemo,
		template
	}: { manual?: boolean; layout?: PageLayout; turnMemo?: TurnMemo; template?: PageTemplate }
) {
	if (manual) page.manual = true;
	else delete page.manual;
	if (layout) page.layout = layout;
	else delete page.layout;
	if (turnMemo) page.turnMemo = turnMemo;
	else delete page.turnMemo;
	if (template) page.template = { ...template };
	else delete page.template;
}

/**
 * Where a text is on its page once the page is turned from `from` to `to`: it keeps
 * its place in the content box, which is as far across and down it as before, and
 * its share of the width; turning back puts it where it was.
 */
function turnedTextFrame(
	text: Pick<DocText, 'frame' | 'rotation'>,
	from: PageOrientation,
	to: PageOrientation
): Rect {
	const was = contentBox(from);
	const box = contentBox(to);
	const { x, y, w, h } = text.frame;
	return fitTextFrame(
		{
			x: box.x + ((x - was.x) * box.w) / was.w,
			y: box.y + ((y - was.y) * box.h) / was.h,
			w: (w * box.w) / was.w,
			h
		},
		to,
		text.rotation
	);
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

/** `fn` the first time; false every time after. */
function once(fn: () => boolean): () => boolean {
	let done = false;
	return () => {
		if (done) return false;
		done = true;
		return fn();
	};
}
