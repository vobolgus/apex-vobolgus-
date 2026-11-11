/**
 * The stage of the page editor: which page is shown in the middle, the pages either
 * side of it, and where the three sit on screen.
 *
 * The page shown follows the `pageId` the editor was opened on and moves on its own
 * from there (`show`, `step`). When it disappears from under the editor, the page
 * that took its place in the document is shown.
 *
 * Made while its component is set up: it keeps an effect of its own.
 */

import { tick } from 'svelte';
import type { DocumentStore } from '$lib/document/document.svelte';
import { pageSize } from '$lib/document/geometry';
import type { DocPage } from '$lib/document/types';
import type { EditorFocus } from './focus';
import {
	containsPoint,
	editorLayout,
	offsetBox,
	type EditorLayout,
	screenToMm,
	type Box,
	type PageBox,
	type Point,
	type Size,
	type SlotRole
} from './screen-geometry';

/** Stage size before the first measurement (and in tests, which have no layout). */
const FALLBACK_STAGE: Size = { w: 1200, h: 640 };

/** A page on the stage: which of the three it is, and its paper in stage px. */
interface Slot {
	role: SlotRole;
	page: DocPage;
	/** 1-based. */
	number: number;
	box: Box;
}

interface StageHost {
	readonly store: DocumentStore;
	/** The page to open on; null keeps the editor closed. */
	readonly pageId: string | null;
	readonly focus: EditorFocus;
	readonly announce: (message: string) => void;
	/** A drag is going on: the pages stay put under it. */
	readonly isDragging: () => boolean;
}

export class EditorStage {
	readonly #host: StageHost;
	/** The stage's element, for its size and its place on screen. */
	element = $state<HTMLElement>();
	size = $state<Size>(FALLBACK_STAGE);
	/** The page shown in the middle; follows `pageId` and moves on its own. */
	#currentId: string | null;
	/** Where the page shown was, for when it disappears from under the editor. */
	#lastIndex = 0;

	readonly pages: DocPage[];
	readonly index: number;
	readonly current: DocPage | null;
	readonly prev: DocPage | null;
	readonly next: DocPage | null;
	readonly layout: EditorLayout;
	readonly slots: Slot[];

	constructor(host: StageHost) {
		this.#host = host;
		this.#currentId = $derived(host.pageId);
		this.pages = $derived(host.store.pages);
		this.index = $derived.by(() => {
			const found = this.#currentId === null ? -1 : host.store.pageIndex(this.#currentId);
			return found >= 0 ? found : Math.min(this.#lastIndex, this.pages.length - 1);
		});
		this.current = $derived(this.pages[this.index] ?? null);
		this.prev = $derived(this.index > 0 ? this.pages[this.index - 1] : null);
		this.next = $derived(this.pages[this.index + 1] ?? null);
		this.layout = $derived(
			editorLayout(this.size, {
				prev: this.prev ? pageSize(this.prev.orientation) : null,
				current: pageSize(this.current?.orientation ?? 'portrait'),
				next: this.next ? pageSize(this.next.orientation) : null
			})
		);
		this.slots = $derived.by(() => {
			const list: Slot[] = [];
			const add = (role: SlotRole, page: DocPage | null, at: number) => {
				const box = this.layout.slots[role];
				if (page && box) list.push({ role, page, number: at + 1, box });
			};
			add('prev', this.prev, this.index - 1);
			add('current', this.current, this.index);
			add('next', this.next, this.index + 1);
			return list;
		});
		$effect(() => {
			if (this.index >= 0) this.#lastIndex = this.index;
		});
	}

	/** Show page `id`; `quiet` when the caller says something itself. */
	show(id: string, focusStrip = false, quiet = false): void {
		const at = this.#host.store.pageIndex(id);
		// Mid-drag (a second finger on the strip) the pages stay put under the chart.
		if (at < 0 || this.#host.isDragging()) return;
		if (id !== this.current?.id && !quiet) {
			this.#host.announce(`Page ${at + 1} of ${this.pages.length}`);
		}
		this.#currentId = id;
		if (focusStrip) void tick().then(() => this.#host.focus.strip());
	}

	/** The page `by` pages on from the one shown, if there is one. */
	step(by: number, focusStrip: boolean): void {
		const page = this.pages[this.index + by];
		if (page) this.show(page.id, focusStrip);
	}

	/** The stage as it is now; before it has a size, the fallback. */
	measure(): void {
		const element = this.element;
		if (!element) return;
		const { clientWidth: w, clientHeight: h } = element;
		this.size = w > 0 && h > 0 ? { w, h } : FALLBACK_STAGE;
	}

	/** Every page on the stage, screen px. */
	pageBoxes(): PageBox[] {
		const origin = this.element?.getBoundingClientRect() ?? { left: 0, top: 0 };
		return this.slots.map((slot) => ({
			id: slot.page.id,
			box: offsetBox(slot.box, origin.left, origin.top)
		}));
	}

	/** Where the screen point `point` is on the page `pageId`, mm; undefined off its paper, or with no point. */
	pointOn(pageId: string, point: Point | null): Point | undefined {
		const box = this.pageBoxes().find((b) => b.id === pageId)?.box;
		if (!box || !point || !containsPoint(box, point)) return undefined;
		return screenToMm(point, box, this.layout.scale);
	}
}
