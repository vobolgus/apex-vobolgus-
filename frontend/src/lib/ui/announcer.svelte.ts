/**
 * The words of a polite live region. They are cleared first and come back once
 * `settle` has passed, by when the region has been seen empty: so the same words
 * twice are read twice.
 */

import { tick } from 'svelte';

export class Announcer {
	message = $state('');
	readonly #settle: () => Promise<unknown>;

	/** `settle`: how long the region stays empty; one update by default. */
	constructor(settle: () => Promise<unknown> = tick) {
		this.#settle = settle;
	}

	say = (message: string): void => {
		this.message = '';
		void this.#settle().then(() => (this.message = message));
	};
}
