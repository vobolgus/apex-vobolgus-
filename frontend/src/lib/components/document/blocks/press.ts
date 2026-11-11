/**
 * Which control on a block a press began on.
 *
 * A tap that selects a block reveals its handles and its toolbar, and the click the
 * tap ends in lands on whichever control is now under the finger: a pointer click
 * counts only on the control it was pressed on. (Keys and screen readers click with
 * `detail` 0.) One guard a block, shared by everything on it: a press on the block
 * itself clears it, so a click after it counts nowhere.
 *
 * The block's frame makes it (`providePressGuard`); the tools on the block find it
 * (`pressGuard`).
 */

import { createContext } from 'svelte';

export class PressGuard {
	#on: EventTarget | null = null;

	/** A press began on the control the event is handled on. */
	begin(event: Event): void {
		this.#on = event.currentTarget;
	}

	/**
	 * A press on a tool: it keeps the focus where it is (the toolbar stays, the keys
	 * and the typing go on), and goes no further, to the block that would be carried.
	 */
	hold(event: PointerEvent): void {
		event.preventDefault();
		event.stopPropagation();
		this.begin(event);
	}

	/** A press began on the block itself, on no control. */
	clear(): void {
		this.#on = null;
	}

	/** Whether this click counts: from the keys, or on the control the press began on. Asked once a click. */
	counts(event: MouseEvent): boolean {
		const here = event.detail === 0 || this.#on === event.currentTarget;
		this.#on = null;
		return here;
	}
}

const [pressGuard, setPressGuard] = createContext<PressGuard>();

/** The guard of the block being made, for the controls on it. */
export function providePressGuard(): PressGuard {
	return setPressGuard(new PressGuard());
}

export { pressGuard };
