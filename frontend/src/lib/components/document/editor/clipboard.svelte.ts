/**
 * Copy, cut and paste in the page editor.
 *
 * ⌘C / ⌘X on the selected block puts a copy on the system clipboard under a type of
 * its own (a text's words also as plain text, to paste anywhere), and keeps it here
 * as well, for a browser that hands back only the plain text. ⌘V puts a copied
 * block on the page being shown; words from anywhere else become a new text there.
 *
 * A field's clipboard is its own: typing in a text copies and pastes words.
 */

import { tick } from 'svelte';
import type { Point } from '../editor-geometry';
import type { BlockOperations } from './block-operations.svelte';
import type { EditorContext } from './context.svelte';
import type { DragController } from './drag.svelte';
import { wordsAsText } from './new-blocks';

/** The clipboard type a copied chart or text travels under. */
const CLIP_TYPE = 'application/x-skycharts-block';

/** Whether a clipboard event is a field's own. */
function inField(target: EventTarget | null): boolean {
	return Boolean((target as Element | null)?.closest?.('input, textarea, select'));
}

export class ClipboardController {
	readonly #editor: EditorContext;
	readonly #drag: DragController;
	readonly #blocks: BlockOperations;
	/** The last chart or text copied here, as JSON, with the plain text that went with it. */
	#copied: { json: string; plain: string } | null = null;
	/** Where the pointer last was, screen px: a copy with no room on the page is pasted under it. */
	pointer: Point | null = null;

	constructor(editor: EditorContext, drag: DragController, blocks: BlockOperations) {
		this.#editor = editor;
		this.#drag = drag;
		this.#blocks = blocks;
	}

	/** ⌘C / ⌘X on the block with the focus on the page shown; a cut also removes it. */
	copy(event: ClipboardEvent): void {
		const { store, stage, focus, announce } = this.#editor;
		if (inField(event.target) || this.#drag.active) return;
		const selectedId = focus.selectedId();
		const block = stage.current?.blocks.find((it) => it.id === selectedId);
		const copy = block && store.copyBlock(block.id);
		if (!block || !copy) return;
		event.preventDefault();
		const json = JSON.stringify(copy);
		const plain = copy.kind === 'text' ? copy.text : '';
		this.#copied = { json, plain };
		event.clipboardData?.setData(CLIP_TYPE, json);
		event.clipboardData?.setData('text/plain', plain);
		if (event.type === 'cut') this.#blocks.remove(block);
		else announce(copy.kind === 'chart' ? 'Chart copied' : 'Text copied');
	}

	/** ⌘V on the page shown. The toast's Undo takes what was pasted off again. */
	paste(event: ClipboardEvent): void {
		const { store, stage, focus, announce, notify } = this.#editor;
		const page = stage.current;
		if (inField(event.target) || this.#drag.active || !page) return;
		const plain = event.clipboardData?.getData('text/plain') ?? '';
		let json = event.clipboardData?.getData(CLIP_TYPE) ?? '';
		if (!json && this.#copied && plain === this.#copied.plain) json = this.#copied.json;
		if (!json && plain.trim() === '') return;
		event.preventDefault();
		let copy: unknown;
		try {
			copy = json ? JSON.parse(json) : wordsAsText(page, plain, this.#blocks.nextStyle);
		} catch {
			return;
		}
		const number = stage.index + 1;
		const pasted = store.pasteBlock(page.id, copy, stage.pointOn(page.id, this.pointer));
		if (pasted === 'full') {
			announce(`Page ${number} holds no more`);
			notify(`Page ${number} is full: nothing was pasted`);
			return;
		}
		if (!pasted) return;
		const what = pasted.kind === 'chart' ? 'Chart' : 'Text';
		announce(`${what} pasted`);
		notify(`${what} pasted`, () => {
			store.removeBlock(page.id, pasted.id);
			if (this.#editor.isOpen) void tick().then(() => focus.paper());
		});
		void tick().then(() => focus.block(pasted.id));
	}
}
