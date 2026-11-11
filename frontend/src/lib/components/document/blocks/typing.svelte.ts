/**
 * Typing in a text: what its field holds meanwhile, and the field itself, into
 * which a chip under the toolbar puts a field of the chart where the caret is.
 *
 * When typing begins the field takes the words, the focus and the selection. Made
 * during the component's init: it watches for that from an effect of its own.
 */

import { tick } from 'svelte';
import type { FieldName } from '$lib/document/text';

export class Typing {
	/** What the field holds. */
	draft = $state('');
	/** The field, while it is there. */
	input = $state<HTMLTextAreaElement>();

	/** `editing`: whether the text is being typed in; `words`: what it says. */
	constructor(editing: () => boolean, words: () => string) {
		let was = false;
		$effect(() => {
			const now = editing();
			if (now === was) return;
			was = now;
			if (now) this.#begin(words());
		});
	}

	/** A field of the chart, in place of what is selected in the field; the focus back in it. */
	insert(field: FieldName): void {
		const input = this.input;
		if (!input) return;
		input.setRangeText(`{${field}}`, input.selectionStart, input.selectionEnd, 'end');
		this.draft = input.value;
		input.focus({ preventScroll: true });
	}

	#begin(words: string): void {
		this.draft = words;
		void tick().then(() => {
			const input = this.input;
			if (!input) return;
			input.focus({ preventScroll: true });
			input.select();
		});
	}
}
