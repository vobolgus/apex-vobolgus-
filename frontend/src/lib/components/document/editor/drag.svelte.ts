/**
 * The pointer drag of the page editor, as a small state machine: at rest, or one
 * session going on from a press to its release.
 *
 * What a drag does is its session's (`drag-sessions.ts`): carry a block, resize a
 * chart, set a text's width, turn it. This is what they have in common, and all of
 * it that touches the DOM: the pointer is captured, its moves are applied once a
 * frame, a press must travel a little before it drags, Shift shows the lines, and
 * the release writes the document and plays the block to rest. A drag cancelled
 * (Escape, the pointer lost) wrote nothing; the block eases back where it was.
 *
 * One drag at a time: while one goes on, a second press begins nothing, and the
 * rest of the editor asks `active` before it changes anything.
 */

import { tick } from 'svelte';
import { findBlock, isChart } from '$lib/document/blocks';
import type { ResizeAnchor, SnapGuide } from '$lib/document/geometry';
import type { DocBlock, DocPage, TypesetBlock } from '$lib/document/types';
import { prefersReducedMotion } from '$lib/ui/motion';
import type { Point } from '../editor-geometry';
import type { PointerActions, TextSide } from './actions';
import { holdBlock } from './block-geometry';
import type { EditorContext } from './context.svelte';
import {
	carrySession,
	cornerResizeSession,
	turnSession,
	widthResizeSession,
	type DragSession,
	type Press
} from './drag-sessions';
import { pageDrag, type DragView, type GuideFlash, type PageDrag } from './drag-view';

/** A press must travel this far, px, before it drags: a click selects without snapping. */
const DRAG_SLOP_PX = 3;
/** How long the guides a keyboard nudge lands on stay drawn, ms. */
const FLASH_MS = 700;
/** The snap-back after a drag let go off every page. */
const RETURN_MS = 200;
/** How long a block let go over a page takes to come to rest in its place. */
const SETTLE_MS = 220;

/** The drag going on: its session, and the pointer that drives it. */
interface Active {
	session: DragSession;
	blockId: string;
	pointerId: number;
	element: HTMLElement;
	listeners: AbortController;
	/** Screen px at the press. */
	start: Point;
	/** The press has travelled past the slop: it is a drag. */
	moved: boolean;
	/** Shift is held: the lines the block would snap to are shown. */
	shift: boolean;
	/** The pointer's last applied position: Shift pressed with the pointer at rest redraws from it. */
	last: Point | null;
	/** The pointer's latest position, applied once per frame. */
	pending: Point | null;
	frameRequest: number;
}

function isSide(handle: ResizeAnchor | TextSide): handle is TextSide {
	return handle === 'w' || handle === 'e';
}

export class DragController implements PointerActions {
	readonly #editor: EditorContext;
	#active: Active | null = null;
	/** What the drag going on shows; null at rest, and until a press has become a drag. */
	view = $state.raw<DragView | null>(null);
	/** A block easing back after a drag that was let go off every page, or cancelled. */
	returningId = $state<string | null>(null);
	/** A block coming to rest after it was let go over a page. */
	settlingId = $state<string | null>(null);
	/** A block is off its place: in the hand, or on its way to rest or back. */
	readonly carrying = $derived(
		(this.view !== null && this.view.kind !== 'resizing') ||
			this.settlingId !== null ||
			this.returningId !== null
	);
	#flash = $state.raw<GuideFlash | null>(null);
	#flashTimer: ReturnType<typeof setTimeout> | undefined;
	/** Set for the click a drag's release ends in. */
	#swallowClick = false;

	constructor(editor: EditorContext) {
		this.#editor = editor;
	}

	/** A drag is going on, or a press that may become one. */
	get active(): boolean {
		return this.#active !== null;
	}

	// === Presses ===

	carry(event: PointerEvent, block: DocBlock): void {
		const { store, stage } = this.#editor;
		// The current page's, or a neighbour's it is grabbed from.
		const page = findBlock(store.pages, block.id)?.page;
		const boxes = stage.pageBoxes();
		if (!page || !boxes.some((b) => b.id === page.id) || !this.#claim(event)) return;
		// A neighbour's block is not focusable; it takes the focus once it lands on the current page.
		(event.currentTarget as HTMLElement).focus({ preventScroll: true });
		this.#begin(event, block.id, carrySession(store, this.#press(event, block, page.id)));
	}

	resize(event: PointerEvent, block: DocBlock, handle: ResizeAnchor | TextSide): void {
		const { store, stage, focus } = this.#editor;
		if (!this.#claim(event)) return;
		event.stopPropagation();
		focus.block(block.id);
		const press = this.#press(event, block, stage.current!.id);
		// A chart by a corner, its aspect kept; a text or a table by a side, its height its lines'.
		if (isChart(block)) {
			if (!isSide(handle)) this.#begin(event, block.id, cornerResizeSession(store, press, handle));
		} else if (isSide(handle)) {
			this.#begin(event, block.id, widthResizeSession(store, press, handle));
		}
	}

	turn(event: PointerEvent, block: TypesetBlock): void {
		const { store, stage, focus } = this.#editor;
		const element = focus.element(block.id);
		if (!element || !this.#claim(event)) return;
		event.stopPropagation();
		focus.block(block.id);
		const rect = element.getBoundingClientRect();
		const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		const press = this.#press(event, block, stage.current!.id);
		this.#begin(event, block.id, turnSession(store, press, centre));
	}

	/** A press that may start a drag: the primary button, and no drag already going. */
	#claim(event: PointerEvent): boolean {
		if (this.#active || !this.#editor.stage.current) return false;
		if (event.pointerType === 'mouse' && event.button !== 0) return false;
		// No text selection, no native image drag; the focus is set by hand instead.
		event.preventDefault();
		return true;
	}

	#press(event: PointerEvent, block: DocBlock, pageId: string): Press {
		const { stage } = this.#editor;
		return {
			pageId,
			block: holdBlock(block),
			start: { x: event.clientX, y: event.clientY },
			scale: stage.layout.scale,
			boxes: stage.pageBoxes()
		};
	}

	// === The session ===

	#begin(event: PointerEvent, blockId: string, session: DragSession): void {
		const element = event.currentTarget as HTMLElement;
		const listeners = new AbortController();
		const { signal } = listeners;
		this.#active = {
			session,
			blockId,
			pointerId: event.pointerId,
			element,
			listeners,
			start: { x: event.clientX, y: event.clientY },
			moved: false,
			shift: event.shiftKey,
			last: null,
			pending: null,
			frameRequest: 0
		};
		try {
			element.setPointerCapture(event.pointerId);
		} catch {
			// No capture (a synthetic event): the listeners below still see the pointer.
		}
		element.addEventListener('pointermove', (e) => this.#handleMove(e), { signal });
		element.addEventListener('pointerup', (e) => this.#handleUp(e), { signal });
		element.addEventListener('pointercancel', () => this.cancel(), { signal });
		element.addEventListener('lostpointercapture', () => this.cancel(), { signal });
		// Shift pressed or let go with the pointer at rest shows or hides the lines at once.
		const handleShift = (keyEvent: KeyboardEvent) => {
			const active = this.#active;
			if (!active || keyEvent.key !== 'Shift') return;
			active.shift = keyEvent.type === 'keydown';
			if (active.last) this.#update(active, active.last);
		};
		window.addEventListener('keydown', handleShift, { signal, capture: true });
		window.addEventListener('keyup', handleShift, { signal, capture: true });
	}

	#handleMove(event: PointerEvent): void {
		const active = this.#active;
		if (!active || event.pointerId !== active.pointerId) return;
		active.shift = event.shiftKey;
		active.pending = { x: event.clientX, y: event.clientY };
		if (!active.frameRequest) {
			active.frameRequest = requestAnimationFrame(() => {
				if (this.#active !== active) return;
				active.frameRequest = 0;
				this.#applyPending(active);
			});
		}
	}

	#applyPending(active: Active): void {
		const point = active.pending;
		active.pending = null;
		if (point) this.#update(active, point);
	}

	#handleUp(event: PointerEvent): void {
		const active = this.#active;
		if (!active || event.pointerId !== active.pointerId) return;
		cancelAnimationFrame(active.frameRequest);
		active.frameRequest = 0;
		active.pending = { x: event.clientX, y: event.clientY };
		this.#applyPending(active);
		this.#commit(active);
	}

	#update(active: Active, point: Point): void {
		active.last = point;
		const travelled = Math.hypot(point.x - active.start.x, point.y - active.start.y);
		if (!active.moved && travelled < DRAG_SLOP_PX) return;
		active.moved = true;
		const view = active.session.update(point, active.shift);
		if (view) this.view = view;
	}

	#commit(active: Active): void {
		const { focus, announce } = this.#editor;
		const view = this.view;
		const { blockId } = active;
		// Where the block is on screen as it is let go: it settles from there.
		const held = active.moved ? (focus.element(blockId)?.getBoundingClientRect() ?? null) : null;
		this.end();
		if (!active.moved || !view) return;
		// The click this release ends in must not make the page it was grabbed on current.
		this.#swallowClick = true;
		setTimeout(() => (this.#swallowClick = false));
		const outcome = active.session.commit(view);
		if (outcome.say) announce(outcome.say);
		if (outcome.rest === 'settle') this.#settle(blockId, held);
		else if (outcome.rest === 'return') this.#return(blockId);
		if (outcome.changedPage) {
			// Its element is gone with it: the focus goes to it on the current page, else stays here.
			void tick().then(() => {
				if (!focus.blockOnCurrent(blockId)) focus.paper();
			});
		}
	}

	/** Escape mid-drag, or the pointer lost: nothing was written, and the block goes back. */
	cancel(): void {
		const active = this.#active;
		if (!active) return;
		const moved = active.moved && this.view !== null;
		this.end();
		if (moved) this.#return(active.blockId);
	}

	/** Let go of the pointer and of the view, whatever the drag was doing. */
	end(): void {
		const active = this.#active;
		if (!active) return;
		this.#active = null;
		cancelAnimationFrame(active.frameRequest);
		active.listeners.abort();
		try {
			if (active.element.hasPointerCapture?.(active.pointerId)) {
				active.element.releasePointerCapture(active.pointerId);
			}
		} catch {
			// Already released.
		}
		this.view = null;
	}

	/** The editor closes: no drag, and no lines left drawn. */
	reset(): void {
		this.end();
		clearTimeout(this.#flashTimer);
		this.#flash = null;
	}

	// === Coming to rest ===

	/**
	 * The block has been let go and is already where it belongs in the document;
	 * on screen it is played there from where the hand left it (`held`), so that it
	 * comes to rest instead of jumping the last of the way. Its element may be a new
	 * one, on another page: found again once the page has drawn it.
	 */
	#settle(blockId: string, held: DOMRect | null): void {
		if (!held || prefersReducedMotion()) return;
		this.settlingId = blockId;
		const done = () => {
			if (this.settlingId === blockId) this.settlingId = null;
		};
		void tick().then(() => {
			const element = this.#editor.focus.element(blockId);
			if (!element || typeof element.animate !== 'function') return done();
			const rest = element.getBoundingClientRect();
			if (rest.width <= 0) return done();
			const dx = held.left + held.width / 2 - (rest.left + rest.width / 2);
			const dy = held.top + held.height / 2 - (rest.top + rest.height / 2);
			const scale = held.width / rest.width;
			const move = element.animate(
				[{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }],
				{ duration: SETTLE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
			);
			move.onfinish = done;
			move.oncancel = done;
		});
	}

	#return(blockId: string): void {
		this.returningId = blockId;
		setTimeout(() => {
			if (this.returningId === blockId) this.returningId = null;
		}, RETURN_MS);
	}

	// === What the pages draw ===

	/** What `page` draws for the drag going on (or the guides of the last nudge). */
	pageDrag(page: DocPage): PageDrag | null {
		return pageDrag(page.id, this.view, this.#flash);
	}

	/** Draw the lines a keyboard nudge landed on, on `pageId`, for a moment; none clears them. */
	flash(pageId: string, guides: SnapGuide[]): void {
		clearTimeout(this.#flashTimer);
		this.#flash = guides.length > 0 ? { pageId, guides } : null;
		if (this.#flash) this.#flashTimer = setTimeout(() => (this.#flash = null), FLASH_MS);
	}

	/** In the capture phase of the editor's clicks: the click a drag's release ends in goes no further. */
	swallowClick(event: MouseEvent): void {
		if (!this.#swallowClick) return;
		this.#swallowClick = false;
		event.stopPropagation();
		event.preventDefault();
	}
}
