/**
 * A drag of one of the pinhole frame's handles, from the press to the release.
 *
 * A move draws nothing itself: it keeps the pointer, marks the drag pending and
 * asks for a frame, and the page's render loop applies the latest position once
 * a frame (`flush`). Shift is re-read on its own key events, so pressing it
 * without moving snaps at once. Escape, a lost window or a hidden tab put the
 * frame back as it was; a release, a cancel or a lost capture keep it.
 */

import {
	beginPinholeDrag,
	HANDLE_CURSOR,
	pinholeDragRequest,
	pinholeLimits,
	pxPerFrac,
	resolvePinholeResize,
	type FrameHandle,
	type FrameRect,
	type PinholeDragOrigin,
	type PinholeLimits,
	type PinholeShape
} from '$lib/math/pinhole-frame';

/** Class on <html> while a handle is dragged; pins the cursor page-wide. */
const RESIZING_CLASS = 'pinhole-resizing';

/** What a drag reads of the overlay, and what it tells it. */
export interface PinholeDragHost {
	/** The overlay's root: the frame's centre is the middle of its box. */
	root(): HTMLElement | null;
	shape(): PinholeShape;
	frame(): FrameRect;
	/** Side of the square chart surface, and the clipping area around it, CSS px. */
	surfaceSizePx(): number;
	clipWidthPx(): number;
	clipHeightPx(): number;
	write(shape: PinholeShape): void;
	/** The view changed and the canvas needs a frame. */
	changed(): void;
	/** A drag ended: the readout stays a moment longer. */
	ended(): void;
}

interface DragSession {
	origin: PinholeDragOrigin;
	pointerId: number;
	target: HTMLElement;
	start: PinholeShape;
	limits: PinholeLimits;
	pointerX: number;
	pointerY: number;
	shift: boolean;
	/** A pointer or Shift change waiting for the next `flush()`. */
	pending: boolean;
}

export class PinholeDrag {
	/** The handle being dragged. */
	active = $state<FrameHandle | null>(null);
	/** The bounds the drag started with: they hold until it ends. */
	limits = $state.raw<PinholeLimits | null>(null);
	/** Shift has squared the frame. */
	squareSnap = $state(false);

	#host: PinholeDragHost;
	#session: DragSession | null = null;

	constructor(host: PinholeDragHost) {
		this.#host = host;
	}

	/** Whether a handle is held now. */
	get dragging(): boolean {
		return this.#session !== null;
	}

	/** Apply the latest drag position. Called by the page's render loop, once per frame. */
	flush = (): boolean => {
		if (!this.#session?.pending) return false;
		this.#session.pending = false;
		this.#apply(this.#session);
		return true;
	};

	#apply(drag: DragSession) {
		const request = pinholeDragRequest(drag.origin, drag.pointerX, drag.pointerY, drag.shift);
		const next = resolvePinholeResize(drag.start, request, drag.limits);
		this.#host.write(next);
		this.squareSnap = request.square && Math.abs(next.aspectRatio - 1) < 1e-6;
	}

	#requestFrame(drag: DragSession) {
		drag.pending = true;
		this.#host.changed();
	}

	/** A press on `handle`'s hit area: the drag begins, with the pointer captured. */
	start = (event: PointerEvent, handle: FrameHandle): void => {
		const root = this.#host.root();
		if (event.button !== 0 || !event.isPrimary || this.#session || !root) return;
		// The sky's input (`SkyInput`) already ignores non-canvas targets; this also
		// keeps the page from treating the press as anything but a resize.
		event.stopPropagation();
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		const box = root.getBoundingClientRect();
		const start: PinholeShape = { ...this.#host.shape() };
		const surfaceSizePx = this.#host.surfaceSizePx();
		this.#session = {
			origin: beginPinholeDrag(
				handle,
				event.clientX,
				event.clientY,
				box.left + box.width / 2,
				box.top + box.height / 2,
				this.#host.frame(),
				pxPerFrac(surfaceSizePx)
			),
			pointerId: event.pointerId,
			target,
			start,
			limits: pinholeLimits(
				surfaceSizePx,
				this.#host.clipWidthPx(),
				this.#host.clipHeightPx(),
				start
			),
			pointerX: event.clientX,
			pointerY: event.clientY,
			shift: event.shiftKey,
			pending: false
		};
		this.limits = this.#session.limits;
		this.active = handle;
		const html = document.documentElement;
		html.style.setProperty('--pinhole-resize-cursor', HANDLE_CURSOR[handle]);
		html.classList.add(RESIZING_CLASS);
		target.addEventListener('pointermove', this.#onPointerMove);
		target.addEventListener('pointerup', this.#onPointerUp);
		target.addEventListener('pointercancel', this.#onPointerEnd);
		target.addEventListener('lostpointercapture', this.#onPointerEnd);
		window.addEventListener('pointerdown', this.#onOtherPointerDown, true);
		window.addEventListener('keydown', this.#onKey);
		window.addEventListener('keyup', this.#onKey);
		window.addEventListener('blur', this.#onWindowBlur);
		document.addEventListener('visibilitychange', this.#onVisibilityChange);
	};

	#onPointerMove = (event: PointerEvent) => {
		const session = this.#session;
		if (!session || event.pointerId !== session.pointerId) return;
		session.pointerX = event.clientX;
		session.pointerY = event.clientY;
		session.shift = event.shiftKey;
		this.#requestFrame(session);
	};

	#onPointerUp = (event: PointerEvent) => {
		const session = this.#session;
		if (!session || event.pointerId !== session.pointerId) return;
		if (event.clientX !== session.pointerX || event.clientY !== session.pointerY) {
			session.pointerX = event.clientX;
			session.pointerY = event.clientY;
			session.pending = true;
		}
		this.end(true);
	};

	#onPointerEnd = (event: PointerEvent) => {
		if (this.#session && event.pointerId === this.#session.pointerId) this.end(true);
	};

	/** A second finger (or pen) during a handle drag must not start a sky drag. */
	#onOtherPointerDown = (event: PointerEvent) => {
		if (this.#session && event.pointerId !== this.#session.pointerId) {
			event.stopPropagation();
			event.preventDefault();
		}
	};

	/** Shift is re-read on its own key events, so pressing it without moving snaps at once. */
	#onKey = (event: KeyboardEvent) => {
		const session = this.#session;
		if (!session) return;
		if (event.key === 'Escape' && event.type === 'keydown') {
			this.end(false);
			return;
		}
		if (event.key !== 'Shift') return;
		const shift = event.type === 'keydown';
		if (session.shift === shift) return;
		session.shift = shift;
		this.#requestFrame(session);
	};

	// Losing the window or the tab mid-drag cancels the resize.
	#onWindowBlur = () => {
		this.end(false);
	};

	#onVisibilityChange = () => {
		if (document.hidden) this.end(false);
	};

	/** Finish the drag, keeping the result (`commit`) or restoring the start state. */
	end(commit: boolean): void {
		const drag = this.#session;
		if (!drag) return;
		this.#session = null;
		if (!commit) {
			this.#host.write(drag.start);
		} else if (drag.pending) {
			this.#apply(drag);
		}
		const { target } = drag;
		target.removeEventListener('pointermove', this.#onPointerMove);
		target.removeEventListener('pointerup', this.#onPointerUp);
		target.removeEventListener('pointercancel', this.#onPointerEnd);
		target.removeEventListener('lostpointercapture', this.#onPointerEnd);
		window.removeEventListener('pointerdown', this.#onOtherPointerDown, true);
		window.removeEventListener('keydown', this.#onKey);
		window.removeEventListener('keyup', this.#onKey);
		window.removeEventListener('blur', this.#onWindowBlur);
		document.removeEventListener('visibilitychange', this.#onVisibilityChange);
		if (target.hasPointerCapture(drag.pointerId)) target.releasePointerCapture(drag.pointerId);
		const html = document.documentElement;
		html.classList.remove(RESIZING_CLASS);
		html.style.removeProperty('--pinhole-resize-cursor');
		this.active = null;
		this.limits = null;
		this.squareSnap = false;
		this.#host.ended();
		this.#host.changed();
	}
}
