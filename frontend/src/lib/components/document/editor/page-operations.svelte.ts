/**
 * What is done to a whole page in the editor: shown, added, deleted while empty,
 * turned, and laid out as a template through the picker.
 *
 * As with a block, nothing here changes the document while a drag goes on.
 */

import { tick } from 'svelte';
import { isBlank } from '$lib/document/blocks';
import type { LaidPage, TemplateInfo } from '$lib/document/templates';
import type { PageOrientation } from '$lib/document/types';
import { TemplatePicking } from '../templates/pick.svelte';
import { measuredHeight } from '../typeset.svelte';
import type { PageActions } from './actions';
import type { BlockOperations } from './block-operations.svelte';
import type { EditorContext } from './context';
import type { DragController } from './drag.svelte';

export class PageOperations implements PageActions {
	readonly #editor: EditorContext;
	readonly #drag: DragController;
	readonly #blocks: BlockOperations;
	/** The template picker, while it is open: it stands under the button that asked for it. */
	readonly templates: TemplatePicking;

	constructor(editor: EditorContext, drag: DragController, blocks: BlockOperations) {
		this.#editor = editor;
		this.#drag = drag;
		this.#blocks = blocks;
		this.templates = new TemplatePicking(() => editor.store);
	}

	show(pageId: string): void {
		this.#editor.stage.show(pageId);
	}

	/** A new page at the end, shown. */
	add(): void {
		const { store, stage, announce } = this.#editor;
		if (this.#drag.active || !store.canAddPage) return;
		stage.show(store.addPage());
		announce(`Page ${stage.pages.length} added`);
	}

	/**
	 * Delete an empty page (its label's button, or Delete with the focus on the page).
	 * A page with charts or text on it is not deleted from here: they are removed one
	 * by one, or the page is deleted in the pages panel. The page that takes its place is
	 * shown; with none left the editor closes. The toast's Undo brings it back.
	 */
	remove(pageId: string): void {
		const { store, stage, focus, announce, notify } = this.#editor;
		const page = store.page(pageId);
		if (this.#drag.active || !page || !isBlank(page)) return;
		const number = store.pageIndex(pageId) + 1;
		const restore = store.removePage(pageId);
		notify(`Page ${number} deleted`, () => {
			if (!restore() || !this.#editor.isOpen) return;
			stage.show(pageId, false, true);
			announce(`Page ${number} restored`);
			void tick().then(() => focus.paper());
		});
		// The button went with its page: the focus goes to the page now shown.
		void tick().then(() => focus.paper());
	}

	/**
	 * Turns a page. One a template laid out is laid out by it the other way, with the
	 * measure the picker laid it out with, so its text is given the room its lines take.
	 */
	setOrientation(pageId: string, orientation: PageOrientation): void {
		if (this.#drag.active) return;
		this.#editor.store.setOrientation(pageId, orientation, measuredHeight);
	}

	/** Open the template picker for a page, under the button that asked for it. */
	pickTemplate(pageId: string, button: HTMLElement): void {
		if (this.#drag.active) return;
		this.#blocks.editingId = null;
		const { left, top, right, bottom } = button.getBoundingClientRect();
		this.templates.open(pageId, { left, top, right, bottom });
	}

	/** The picker's choice: the page laid out as `template`, on as many pages as `laid` has. */
	applyTemplate(pageId: string, template: TemplateInfo, laid: LaidPage[]): void {
		const { focus, announce, notify } = this.#editor;
		const applied = this.templates.apply(pageId, template, laid);
		if (!applied) return;
		announce(applied.message);
		notify(applied.message, () => {
			if (!applied.restore() || !this.#editor.isOpen) return;
			announce(applied.restored);
			void tick().then(() => focus.paper());
		});
		void tick().then(() => focus.paper());
	}
}
