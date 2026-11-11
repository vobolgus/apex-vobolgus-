/**
 * What goes on in the pages panel's list: the keys between its thumbnails, a page
 * added from ⊕ and one deleted from its ⊖ (each with its motion, `list-motion.ts`),
 * the Undo that brings a page back and where the focus goes meanwhile, and the page
 * the panel is asked to show after Add to PDF, with where the chart flying there
 * lands. Every look into the list's DOM is here.
 *
 * Keyboard: ↑/↓ (Home/End) move between thumbnails, Delete or Backspace deletes the
 * focused page. Keys handled here stop propagating, so the window-level sky
 * rotation does not act on them too.
 */

import { tick } from 'svelte';
import type { DocumentStore } from '$lib/document/document.svelte';
import { Announcer } from '$lib/ui/announcer.svelte';
import type { Box, Landing, LandingTarget } from '../flight/flight';
import type { PickerAnchor } from '../templates/pick.svelte';
import { flash, growIn, makeRoom, reducedMotion, shrinkOut } from './list-motion';

/** What a page in the list asks of the panel. */
export interface PageCellActions {
	/** Open the editor on it. */
	open(pageId: string): void;
	/** A key on its thumbnail. */
	keydown(event: KeyboardEvent, pageId: string): void;
	remove(pageId: string): void;
	/** Lay it out as a template, beside the button the click was on. */
	pickTemplate(event: MouseEvent, pageId: string): void;
}

interface PagesListHost {
	readonly store: DocumentStore;
	/** Show a toast, with an Undo when `undo` is given. */
	notify(message: string, undo?: () => void): void;
	/** The last page was deleted from the keyboard: the panel is gone, so the focus needs a home. */
	emptied(): void;
}

/** The panel's slide, as in the CSS: a flash on a page waits for it. */
const SLIDE_MS = 220;
/** A pointer has moved once it is this far from where a page appeared under it, px. */
const QUIET_MOVE_PX = 4;
/** The deepest the list fades at an edge that pages run under, px. */
const EDGE_FADE_PX = 20;

export class PagesList {
	readonly #host: PagesListHost;
	/** The list, once it is there. */
	element = $state<HTMLOListElement>();
	/** Polite live region: a page added from ⊕ has no other cue but the flash. */
	readonly voice = new Announcer();
	/**
	 * A page that came to lie under a pointer which did not move: the one ⊕ just
	 * added, where ⊕ itself was a moment ago. Until the pointer does move it is not
	 * treated as hovered: no lift, no ⊖. Otherwise a click on ⊕ answers with a page
	 * that grows in, lifts and sprouts a delete button all at once, none of which the
	 * hand asked for.
	 */
	quietPageId = $state<string | null>(null);
	/** Pages on their way out: a second ⊖ on one of them, mid-exit, is ignored. */
	readonly #leaving: string[] = [];
	readonly #count: number;

	constructor(host: PagesListHost) {
		this.#host = host;
		this.#count = $derived(host.store.pages.length);
	}

	// === Keys ===

	keydown = (event: KeyboardEvent, pageId: string): void => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const buttons = this.#thumbs();
		const current = buttons.indexOf(event.currentTarget as HTMLButtonElement);
		let next: number;
		switch (event.key) {
			case 'ArrowDown':
				next = Math.min(current + 1, buttons.length - 1);
				break;
			case 'ArrowUp':
				next = Math.max(current - 1, 0);
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = buttons.length - 1;
				break;
			case 'Delete':
			case 'Backspace':
				event.preventDefault();
				event.stopPropagation();
				this.remove(pageId);
				return;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
		buttons[next]?.focus();
		buttons[next]?.scrollIntoView?.({ block: 'nearest' });
	};

	// === Adding and deleting ===

	/**
	 * ⊕: a page is added at the end and grows into the list, and that is all. The
	 * flash and the bump that `reveal` gives a page are for Add to PDF, when the eye
	 * is on the chart and has to be led to the panel; here it is already on the spot.
	 */
	add = async (event?: MouseEvent): Promise<void> => {
		const { store } = this.#host;
		if (!store.canAddPage) return;
		const pageId = store.addPage();
		this.voice.say(`Page ${store.pageIndex(pageId) + 1} added`);
		// A click from the keyboard has no place of its own (detail 0): wait for the first move.
		this.#quietUntilPointerMoves(
			pageId,
			event && event.detail > 0 ? { x: event.clientX, y: event.clientY } : null
		);
		await tick();
		const cell = this.#cell(pageId);
		if (!cell) return;
		const reduce = reducedMotion();
		cell.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
		if (!reduce) growIn(cell, this.element);
	};

	/**
	 * Delete a page. Where it can be shown, the page first closes up, so the panel
	 * shortens instead of jumping; then it goes, with an Undo that brings it back the
	 * way new pages arrive.
	 */
	remove = (pageId: string): void => {
		const index = this.#host.store.pageIndex(pageId);
		if (index < 0 || this.#leaving.includes(pageId)) return;
		const hadFocus = this.element?.contains(document.activeElement) ?? false;
		const cell = this.#cell(pageId);
		const exit = cell ? shrinkOut(cell) : null;
		if (!exit) {
			void this.#removeNow(pageId, index, hadFocus);
			return;
		}
		this.#leaving.push(pageId);
		void exit.then(() => {
			this.#leaving.splice(this.#leaving.indexOf(pageId), 1);
			return this.#removeNow(pageId, index, hadFocus);
		});
	};

	async #removeNow(pageId: string, index: number, hadFocus: boolean): Promise<void> {
		const undo = this.#host.store.removePage(pageId);
		this.#host.notify(`Page ${index + 1} deleted`, () => {
			if (!undo()) return;
			void this.#focusRestored(pageId);
			void tick().then(() => {
				const restored = this.#cell(pageId);
				if (restored && !reducedMotion()) growIn(restored, this.element);
			});
		});
		if (!hadFocus) return;
		// The focused button went with its page: give the focus to the page now in its place.
		await tick();
		const buttons = this.#thumbs();
		const next = buttons[Math.min(index, buttons.length - 1)];
		if (next) next.focus();
		else this.#host.emptied();
	}

	/**
	 * After an undo, the restored page's thumbnail takes the focus when the focus
	 * was in the panel or went with the toast's Undo button; elsewhere it stays.
	 */
	async #focusRestored(pageId: string): Promise<void> {
		const before = document.activeElement;
		await tick();
		const lost = !before?.isConnected || document.activeElement === document.body;
		if (!lost && !this.element?.contains(before)) return;
		this.#host.store.panelOpen = true;
		await tick();
		this.#cell(pageId)?.querySelector<HTMLElement>('.thumb')?.focus();
	}

	/** Hold a page quiet until the pointer has moved a few px from where it is now. */
	#quietUntilPointerMoves(pageId: string, at: { x: number; y: number } | null): void {
		this.quietPageId = pageId;
		let from = at;
		const onMove = (event: PointerEvent) => {
			from ??= { x: event.clientX, y: event.clientY };
			// A layout change alone can fire a move with the pointer where it was: not that.
			if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < QUIET_MOVE_PX) return;
			window.removeEventListener('pointermove', onMove);
			if (this.quietPageId === pageId) this.quietPageId = null;
		};
		window.addEventListener('pointermove', onMove);
	}

	// === Add to PDF ===

	/**
	 * Show a page: open the panel if it was collapsed, scroll its thumbnail into
	 * view and flash it.
	 *
	 * With a `landing` a copy of the chart is about to fly here. The thumbnail is
	 * then brought into view at once (the copy needs a target that stays put), a new
	 * page makes its entrance, and the flash waits for the copy to land. Returns
	 * where the copy lands, measured before anything here starts to move; null when
	 * there is no such chart to land on.
	 */
	async reveal(pageId: string, landing?: Landing): Promise<LandingTarget | null> {
		const { store } = this.#host;
		const opening = !store.panelOpen;
		store.panelOpen = true;
		await tick();
		const cell = this.#cell(pageId);
		if (!cell) return null;
		const reduce = reducedMotion();
		cell.scrollIntoView?.({ block: 'nearest', behavior: reduce || landing ? 'auto' : 'smooth' });
		const target = landing ? chartTarget(cell, landing.blockId) : null;
		if (landing && !reduce) {
			// The first page arrives with the panel, which slides in with it (`growIn` leaves it be).
			if (landing.newPage) growIn(cell, this.element);
			else makeRoom(cell, landing);
		}
		// After the slide-in and the landing, so the flash is seen.
		const delay = reduce ? 0 : Math.max(opening ? SLIDE_MS : 0, landing?.ms ?? 0);
		flash(cell, delay, !reduce);
		return target;
	}

	/**
	 * Where every chart is on the thumbnails just now, by item id. The page takes
	 * this before an Add and hands it back in the `landing`, so the charts the Add
	 * moves can be played from where they were.
	 */
	chartBoxes(): Record<string, Box> {
		const boxes: Record<string, Box> = {};
		for (const chart of this.element?.querySelectorAll<HTMLElement>('.chart') ?? []) {
			const id = chart.dataset.itemId;
			if (id) boxes[id] = chart.getBoundingClientRect();
		}
		return boxes;
	}

	// === The template picker ===

	/**
	 * Where a page's template picker stands, for the button on its thumbnail that
	 * asked for it: beside the panel, at the height of the thumbnail.
	 */
	pickerAnchor(button: HTMLElement): PickerAnchor | null {
		const thumb = button.closest('.thumb-wrap');
		const dock = button.closest('.dock');
		if (!thumb || !dock) return null;
		const { top, bottom, left } = thumb.getBoundingClientRect();
		return { left, top, bottom, right: dock.getBoundingClientRect().right };
	}

	// === The list's edges ===

	/**
	 * Keep the list's fades right as it scrolls and as it, or what it holds, changes
	 * size: an attachment on the list. Reading the page count has this run again when
	 * a page is added or removed, so the new page is watched as well.
	 */
	edgeFades = (list: HTMLElement): (() => void) => {
		void this.#count;
		const update = () => updateEdgeFades(list);
		update();
		list.addEventListener('scroll', update, { passive: true });
		// The list's own box (the window got shorter) and every page in it (one was turned,
		// or is growing in). jsdom has no ResizeObserver, and nothing to scroll either.
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
		observer?.observe(list);
		for (const cell of list.children) observer?.observe(cell);
		return () => {
			list.removeEventListener('scroll', update);
			observer?.disconnect();
		};
	};

	#thumbs(): HTMLButtonElement[] {
		return this.element
			? Array.from(this.element.querySelectorAll<HTMLButtonElement>('.thumb'))
			: [];
	}

	#cell(pageId: string): HTMLElement | undefined {
		const cells = this.element?.querySelectorAll<HTMLElement>('[data-page-id]') ?? [];
		return Array.from(cells).find((cell) => cell.dataset.pageId === pageId);
	}
}

/**
 * Fade the list at an edge only as far as pages run under it: by how much there
 * is to scroll that way, up to `EDGE_FADE_PX`. So the fade grows in as the list
 * starts to scroll instead of appearing, and is gone at either end.
 */
function updateEdgeFades(list: HTMLElement): void {
	const above = list.scrollTop;
	const below = list.scrollHeight - list.clientHeight - list.scrollTop;
	list.style.setProperty('--fade-top', `${Math.max(0, Math.min(EDGE_FADE_PX, above))}px`);
	list.style.setProperty('--fade-bottom', `${Math.max(0, Math.min(EDGE_FADE_PX, below))}px`);
}

/** How far the panel is slid out of place just now, px (negative: to the left). */
function slideOffset(inside: HTMLElement): number {
	const dock = inside.closest<HTMLElement>('.dock');
	if (!dock || typeof DOMMatrixReadOnly !== 'function') return 0;
	return new DOMMatrixReadOnly(getComputedStyle(dock).transform).m41;
}

/**
 * Where a chart sits on its page's thumbnail once the panel is at rest, and how
 * its corners are rounded there: the place the copy flying in on Add to PDF comes
 * to a stop. Measured with the panel's slide taken out, so a panel still on its
 * way in gives the place it is heading for.
 */
function chartTarget(cell: HTMLElement, blockId: string): LandingTarget | null {
	const chart = Array.from(cell.querySelectorAll<HTMLElement>('.chart')).find(
		(element) => element.dataset.itemId === blockId
	);
	if (!chart) return null;
	const rect = chart.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return null;
	return {
		box: new DOMRect(rect.x - slideOffset(chart), rect.y, rect.width, rect.height),
		corner: getComputedStyle(chart).borderTopLeftRadius
	};
}
