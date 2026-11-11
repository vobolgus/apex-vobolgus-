/**
 * The PDF document: its pages and the blocks on them (charts, texts, tables), kept
 * in localStorage.
 *
 * Change it through the methods: they keep every frame inside its page's content
 * box (a chart's at its aspect), and save. Saves are debounced, so a drag may call
 * `setFrame` on every move; `flush` writes a pending save at once. Nothing is
 * read from storage until `load` (call it on mount, so the server render and
 * hydration agree on an empty document). How the document is written and read back
 * is `storage.ts`'s.
 *
 * A block is put on a page, moved, taken off, copied and pasted by one method
 * whatever its kind (`addBlock`, `setFrame`, `moveBlock`, `removeBlock`, `copyBlock`,
 * `pasteBlock`); where the kinds differ (how a frame is fitted, which limit holds)
 * each of those says so in one place. What only one kind has is its own method: a
 * chart is added by the arranger (`addChart`), a text or a table is set in type
 * (`updateTypeset`) and as tall as its lines (`setTextHeight`).
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
import { blockBounds, chartsOf, findBlock, insertBlock, layerIndex, typesetOf } from './blocks';
import {
	clampPosition,
	contentBox,
	fitFrame,
	GUTTER_MM,
	keptFrame,
	nearestFreePlace,
	overlaps
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
	MAX_TEXTS_PER_PAGE
} from './text';
import { layTemplate, type LaidPage, type TemplateOptions } from './templates';
import type {
	BlockCopy,
	BlockKind,
	ChartBlock,
	ChartSnapshot,
	DocBlock,
	DocPage,
	NewBlock,
	PageLayout,
	PageOrientation,
	PageTemplate,
	Rect,
	TableSpec,
	TextStyle,
	TurnMemo,
	TypesetBlock
} from './types';

/**
 * The backend's limits (backend/src/handlers/document.rs): a document past them
 * cannot be exported, so the editor does not build one.
 */
export const MAX_PAGES = 100;
export const MAX_ITEMS_PER_PAGE = 50;
export const MAX_CHARTS = 200;
const SAVE_DELAY_MS = 250;

/** What `updateTypeset` changes of a text or a table; a field left out stays as it is. */
export interface TypesetPatch {
	/** A text's words; a table has none to change. */
	text?: string;
	/** A table's spec; a text does not become a table by being told one. */
	table?: TableSpec;
	style?: TextStyle;
	frame?: Rect;
	/** The chart its fields read; null goes back to the nearest one. */
	chartId?: string | null;
	/** Degrees clockwise about its centre. */
	rotation?: number;
}

/** How far a copy pasted with no room and no pointer stands off what is in its place, mm down and right. */
const PASTE_OFFSET_MM = 5;
export interface AddChartResult {
	pageId: string;
	blockId: string;
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
		return this.pages.reduce((sum, page) => sum + chartsOf(page).length, 0);
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
		const item: ChartBlock = {
			kind: 'chart',
			id: createId(),
			chart: $state.snapshot(chart),
			frame: plan.items.find((placed) => placed.index < 0)!.frame
		};
		if (thumb) item.thumb = thumb;
		placeCharts(page, plan.items, item);
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
				const current = chartsOf(target);
				const charts = chartsOf(before).map(({ id, frame }) => {
					const restored = current.find((it) => it.id === id)!;
					restored.frame = frame;
					return restored;
				});
				target.blocks = [...charts, ...typesetOf(target)];
				setLayout(target, before);
			}
			this.#scheduleSave();
			return true;
		});
		return { pageId: page.id, blockId: item.id, newPage, relaid: plan.relaid, undo };
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
			if (this.chartCount + chartsOf(removed).length > MAX_CHARTS) return false;
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
		placeCharts(page, plan.items);
		const type = typesetOf(page);
		for (const text of type) text.frame = turnedTextFrame(text, from, orientation);
		setLayout(page, type.length > 0 ? { ...plan, manual: true } : plan);
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
		const own = chartsOf(page);
		const type = typesetOf(page);
		const items = charts.map((placed) =>
			placed.chart ? undefined : own.find((item) => item.id === placed.id)
		);
		const roled = type.filter((text) => text.role !== undefined);
		// Each laid text is one of the page's: the same part and words, of the same chart
		// where the part belongs to one (a caption, a key).
		const found = texts.map((placed) =>
			roled.findIndex(
				(text) =>
					text.role === placed.role &&
					sameWords(text, placed) &&
					(placed.chartId === undefined || text.chartId === placed.chartId)
			)
		);
		const each = (list: readonly unknown[]) => list.every((it, i) => list.indexOf(it) === i);
		const whole =
			!dropped?.length &&
			items.length === own.length &&
			items.every((item) => item !== undefined) &&
			each(items) &&
			found.length === roled.length &&
			found.every((index) => index >= 0) &&
			each(found);
		if (!whole) return false;

		const from = page.orientation;
		page.orientation = orientation;
		const placed = items.map((item, i) => {
			item!.frame = fitFrame(charts[i].frame, item!.chart.aspect, orientation);
			return item!;
		});
		page.blocks = [...placed, ...type];
		for (const text of type) {
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

	// === Blocks ===

	/**
	 * Put a block on a page, in its layer (a chart under the type, a text or a table
	 * over the charts), its frame fitted to the page as its kind is (`fittedFrame`);
	 * the page is hand-arranged from then on. Returns the block's id, or null for a
	 * page that is not there or holds no more of the kind (`hasRoom`), or a chart past
	 * `MAX_CHARTS`.
	 */
	addBlock(pageId: string, block: NewBlock): string | null {
		const page = this.page(pageId);
		if (!page || !this.#takes(page, block.kind)) return null;
		const frame = fittedFrame(block, block.frame, page.orientation);
		return this.#put(page, { ...$state.snapshot(block), frame });
	}

	/** Whether `page` takes another block of `kind`: it has room, and the document for a chart. */
	#takes(page: DocPage, kind: BlockKind): boolean {
		return hasRoom(page, kind) && (kind !== 'chart' || this.chartCount < MAX_CHARTS);
	}

	/** `block` on `page` as it is given, with an id of its own: see `addBlock`. */
	#put(page: DocPage, block: NewBlock): string {
		const added: DocBlock = { ...block, id: createId() };
		if (added.kind === 'text') added.text = added.text.slice(0, MAX_TEXT_CHARS);
		if (added.kind !== 'chart') setRotation(added, added.rotation ?? 0);
		insertBlock(page, added);
		setLayout(page, { manual: true });
		this.#scheduleSave();
		return added.id;
	}

	/**
	 * Set a block's frame, kept inside the content box as its kind is: a chart at its
	 * aspect (width wins), a text or a table at its turn (`updateTypeset`). A chart's
	 * frame that changes makes the page hand-arranged; one that does not changes nothing.
	 */
	setFrame(pageId: string, blockId: string, frame: Rect): boolean {
		const page = this.page(pageId);
		const block = page?.blocks.find((it) => it.id === blockId);
		if (!page || !block) return false;
		if (block.kind !== 'chart') return this.updateTypeset(pageId, blockId, { frame });
		const fitted = fittedFrame(block, frame, page.orientation);
		if (sameFrame(fitted, block.frame)) return true;
		block.frame = fitted;
		setLayout(page, { manual: true });
		this.#scheduleSave();
		return true;
	}

	/**
	 * Move a block to `toPageId` (on top of its layer there) at `frame`, fitted like
	 * `setFrame`. A page that holds no more of its kind takes none (`hasRoom`).
	 *
	 * A text or a table told which chart to read goes on reading it, from the other
	 * page; one that read the nearest reads the nearest where it lands, and on a page
	 * with no chart the one it read before, so that a table moved to a page of its own
	 * still lists its sky.
	 */
	moveBlock(blockId: string, toPageId: string, frame: Rect): boolean {
		const from = findBlock(this.pages, blockId)?.page;
		const to = this.page(toPageId);
		if (!from || !to) return false;
		if (from === to) return this.setFrame(toPageId, blockId, frame);
		const index = from.blocks.findIndex((it) => it.id === blockId);
		const moved = $state.snapshot(from.blocks[index]);
		if (!hasRoom(to, moved.kind)) return false;
		if (moved.kind !== 'chart') {
			const read = boundItem(from, moved, this.pages);
			if (chartsOf(to).length === 0 && read) moved.chartId = read.id;
		}
		from.blocks.splice(index, 1);
		setLayout(from, { manual: from.manual });
		moved.frame = fittedFrame(moved, frame, to.orientation);
		insertBlock(to, moved);
		setLayout(to, { manual: true });
		this.#scheduleSave();
		return true;
	}

	/**
	 * Delete a block; the returned function puts it back on its page, at its place in
	 * its layer (once, if that page still exists and the limits leave room) and says
	 * whether it did. A chart comes back as it was (`keptFrame`) to a page arranged as
	 * it is now; a text or a table is fitted in again, to a page arranged by hand.
	 */
	removeBlock(pageId: string, blockId: string): () => boolean {
		const page = this.page(pageId);
		const index = page ? layerIndex(page, blockId) : -1;
		if (!page || index < 0) return () => false;
		const at = page.blocks.findIndex((it) => it.id === blockId);
		const removed = $state.snapshot(page.blocks[at]);
		page.blocks.splice(at, 1);
		setLayout(page, { manual: page.manual });
		this.#scheduleSave();
		return once(() => {
			const target = this.page(pageId);
			if (!target || findBlock(this.pages, removed.id) || !hasRoom(target, removed.kind)) {
				return false;
			}
			if (removed.kind === 'chart') {
				if (this.chartCount >= MAX_CHARTS) return false;
				removed.frame = keptFrame(removed.frame, removed.chart.aspect, target.orientation);
			} else {
				removed.frame = fittedFrame(removed, removed.frame, target.orientation);
			}
			insertBlock(target, removed, index);
			setLayout(target, { manual: removed.kind === 'chart' ? target.manual : true });
			this.#scheduleSave();
			return true;
		});
	}

	// === Text and tables ===

	/**
	 * Change a text or a table: what it says or lists, how it is set, where it is, the
	 * chart its fields read (`chartId: null` goes back to the nearest one), how far it
	 * is turned (`rotation`, degrees clockwise about its centre). Its frame is fitted
	 * to the page at its turn; the height follows the lines later (`setTextHeight`).
	 */
	updateTypeset(pageId: string, blockId: string, patch: TypesetPatch): boolean {
		const page = this.page(pageId);
		const text = page ? typesetOf(page).find((it) => it.id === blockId) : undefined;
		if (!page || !text) return false;
		const { frame, rotation } = text;
		if (patch.text !== undefined && text.kind === 'text') {
			text.text = patch.text.slice(0, MAX_TEXT_CHARS);
		}
		if (patch.style) text.style = { ...patch.style };
		if (patch.table && text.kind === 'table') {
			text.table = parseTableSpec(patch.table) ?? text.table;
		}
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
	 * The height a text or a table turned out to be when it was laid out: only the box
	 * kept for it follows, from its own top-left corner down (`anchoredFrame`); nothing
	 * on the page has been arranged, and neither a turn of the page nor its template is
	 * forgotten.
	 */
	setTextHeight(pageId: string, blockId: string, height: number): void {
		const page = this.page(pageId);
		const text = page ? typesetOf(page).find((it) => it.id === blockId) : undefined;
		if (!page || !text || !(height > 0) || Math.abs(text.frame.h - height) <= 1e-6) return;
		const { frame, rotation = 0 } = text;
		text.frame = fitTextFrame(
			anchoredFrame(frame, rotation, frame.w, height),
			page.orientation,
			rotation
		);
		this.#scheduleSave();
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
		const charts = chartsOf(page);
		const whole =
			kept.length + dropped.length === charts.length &&
			charts.every((item) => kept.includes(item.id) !== dropped.includes(item.id));
		if (!whole || this.pages.length + laid.length - 1 > MAX_PAGES) return null;
		if (this.chartCount - dropped.length + made.length > MAX_CHARTS) return null;
		if (laid.some((part) => part.charts.length > MAX_ITEMS_PER_PAGE)) return null;

		const before = $state.snapshot(page);
		// A made chart gets its id here; the text that points at it by name follows.
		const ids = made.map((chart) => ({ name: chart.id, id: createId() }));
		const idOf = (name: string | undefined) => ids.find((it) => it.name === name)?.id ?? name;
		const own = typesetOf(page).filter((text) => text.role === undefined);
		const pages = laid.map((part, at): DocPage => {
			const id = at === 0 ? page.id : createId();
			const items = part.charts.map((entry): ChartBlock => {
				const source = chartsOf(before).find((it) => it.id === entry.id);
				const chart = { ...(entry.chart ?? source!.chart) };
				if (entry.marks?.length) chart.marks = entry.marks.map((mark) => ({ ...mark }));
				else delete chart.marks;
				const item: ChartBlock = {
					...source,
					kind: 'chart',
					id: idOf(entry.id)!,
					chart,
					frame: fitFrame(entry.frame, chart.aspect, part.orientation)
				};
				if (entry.closeUpOf !== undefined) item.closeUpOf = entry.closeUpOf;
				return item;
			});
			const texts = [
				...(at === 0 ? $state.snapshot(own) : []),
				...part.texts.map((text) => {
					const added: TypesetBlock = { ...text, id: createId() };
					if (text.chartId !== undefined) added.chartId = idOf(text.chartId);
					return added;
				})
			]
				.slice(0, MAX_TEXTS_PER_PAGE)
				.map((text) => ({
					...text,
					frame: fitTextFrame(text.frame, part.orientation, text.rotation)
				}));
			const next: DocPage = { id, orientation: part.orientation, blocks: [...items, ...texts] };
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

	/** A copy of the block `id`, to paste on any page; null when there is none. */
	copyBlock(id: string): BlockCopy | null {
		const found = findBlock(this.pages, id);
		if (!found) return null;
		const block = $state.snapshot(found.block);
		if (block.kind === 'chart') return { kind: 'chart', chart: block.chart, frame: block.frame };
		const { style, frame, rotation } = block;
		const copy: BlockCopy =
			block.kind === 'text'
				? { kind: 'text', text: block.text, style, frame }
				: { kind: 'table', table: block.table, style, frame };
		if (rotation) copy.rotation = rotation;
		return copy;
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
	): { kind: BlockKind; id: string } | 'full' | null {
		const page = this.page(pageId);
		const copy = page ? parseBlockCopy(value) : null;
		if (!page || !copy) return null;
		if (!this.#takes(page, copy.kind)) return 'full';
		const rotation = copy.kind === 'chart' ? 0 : (copy.rotation ?? 0);
		const sized = fittedFrame(copy, copy.frame, page.orientation);
		const place = pastePlace(page, sized, rotation, at);
		// A chart is where it was put; type is fitted once more there, at its turn.
		const frame = copy.kind === 'chart' ? place : fittedFrame(copy, place, page.orientation);
		return { kind: copy.kind, id: this.#put(page, { ...copy, frame }) };
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
	return { id: createId(), orientation, blocks: [] };
}

/** Whether `page` takes another block of `kind`: charts and type each have their limit. */
function hasRoom(page: DocPage, kind: BlockKind): boolean {
	return kind === 'chart'
		? chartsOf(page).length < MAX_ITEMS_PER_PAGE
		: typesetOf(page).length < MAX_TEXTS_PER_PAGE;
}

/**
 * `frame` as `block` may have it on a page turned `o`: a chart's at its aspect inside
 * the content box (`fitFrame`), a text's or a table's at its turn (`fitTextFrame`).
 */
function fittedFrame(
	block: Pick<ChartBlock, 'kind' | 'chart'> | Pick<TypesetBlock, 'kind' | 'rotation'>,
	frame: Rect,
	o: PageOrientation
): Rect {
	return block.kind === 'chart'
		? fitFrame(frame, block.chart.aspect, o)
		: fitTextFrame(frame, o, block.rotation);
}

/** Whether a page's text says what a template's does: a table has no words of its own. */
function sameWords(
	a: Pick<TypesetBlock, 'kind'> & { text?: string },
	b: Pick<TypesetBlock, 'kind'> & { text?: string }
): boolean {
	return a.kind === b.kind && a.text === b.text;
}

/** Turn a text or a table to `degrees`; an upright one carries no `rotation`. */
function setRotation(text: Pick<TypesetBlock, 'rotation'>, degrees: number) {
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
	const others = page.blocks.map(blockBounds);
	const bounds = blockBounds({ frame, rotation });
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

/**
 * Put a page's charts in the arranger's order with its frames (copied), under the
 * type as ever; `added` is the chart Add brings (index −1). The charts keep their
 * identity.
 */
function placeCharts(page: DocPage, plan: readonly PlacedChart[], added?: ChartBlock) {
	const charts = chartsOf(page);
	const placed = plan.map(({ index, frame }) => {
		const item = index < 0 ? added! : charts[index];
		item.frame = { ...frame };
		return item;
	});
	page.blocks = [...placed, ...typesetOf(page)];
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
	text: Pick<TypesetBlock, 'frame' | 'rotation'>,
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
	const items = chartsOf(page).map((it) => [it.id, it.frame]);
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
