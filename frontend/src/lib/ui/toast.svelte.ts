/**
 * One toast at a time: a short message, optionally with an Undo.
 *
 * `show` replaces whatever is up and starts a 6 s timeout. The timeout pauses
 * while the pointer or the focus is on the toast (`pause`/`resume`), so a slow
 * reader or a keyboard user still reaches Undo. `undo` runs the action once and
 * dismisses the toast.
 */

export const TOAST_DURATION_MS = 6000;

export interface ToastItem {
	/** Distinct per `show`, so the same message twice is still a new toast. */
	id: number;
	message: string;
	undo?: () => void;
}

export class ToastStore {
	current = $state<ToastItem | null>(null);

	readonly #durationMs: number;
	#nextId = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;
	/** Time left on the current toast while it is paused. */
	#remainingMs = 0;
	#deadline = 0;
	#paused = false;

	constructor(durationMs = TOAST_DURATION_MS) {
		this.#durationMs = durationMs;
	}

	/** Show `message` (with an Undo when `undo` is given); returns the toast's id. */
	show(message: string, undo?: () => void): number {
		this.#nextId += 1;
		this.current = undo ? { id: this.#nextId, message, undo } : { id: this.#nextId, message };
		// A new toast is a new element: the pointer or focus that paused the old one is gone.
		this.#paused = false;
		this.#remainingMs = this.#durationMs;
		this.#start();
		return this.#nextId;
	}

	/** Hide the toast; with an `id`, only if that toast is still the one showing. */
	dismiss(id?: number): void {
		if (!this.current || (id !== undefined && this.current.id !== id)) return;
		this.#clearTimer();
		this.#paused = false;
		this.current = null;
	}

	/** Run the current toast's undo (once) and hide it. Returns whether there was one. */
	undo(): boolean {
		const undo = this.current?.undo;
		if (!undo) return false;
		this.dismiss();
		undo();
		return true;
	}

	/** Stop the clock, e.g. while the pointer is over the toast. */
	pause(): void {
		if (this.#paused) return;
		this.#paused = true;
		if (this.#timer !== null) {
			this.#remainingMs = Math.max(0, this.#deadline - Date.now());
			this.#clearTimer();
		}
	}

	/** Restart the clock with the time that was left. */
	resume(): void {
		if (!this.#paused) return;
		this.#paused = false;
		if (this.current) this.#start();
	}

	#start() {
		this.#clearTimer();
		this.#deadline = Date.now() + this.#remainingMs;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.current = null;
		}, this.#remainingMs);
	}

	#clearTimer() {
		if (this.#timer === null) return;
		clearTimeout(this.#timer);
		this.#timer = null;
	}
}

/** The page's toast; components get `notify` from the page rather than importing this. */
export const toast = new ToastStore();
