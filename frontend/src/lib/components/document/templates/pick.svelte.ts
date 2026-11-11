/**
 * The template picker's flow, for whoever opens one (the pages panel, the page
 * editor): which page is being laid out and where its picker stands, and the page
 * laid out as the picker's choice. What a host does around that is its own: where
 * the focus goes, what is said aloud, which page is selected.
 */

import type { DocumentStore } from '$lib/document/document.svelte';
import type { LaidPage, TemplateInfo } from '$lib/document/templates';
import type { DocPage } from '$lib/document/types';

/** What the picker stands beside or under, window px. */
export interface PickerAnchor {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A page being laid out as a template, and what its picker stands by. */
interface TemplatePick {
	pageId: string;
	anchor: PickerAnchor;
}

/** A page laid out as a template: what to say of it, and the way back. */
interface AppliedTemplate {
	/** "Page 2 laid out as “Worksheet”, on 2 pages". */
	message: string;
	/** What to say once it is taken back: "Page 2 as it was". */
	restored: string;
	/** Puts the page back as it was (once) and says whether it did. */
	restore: () => boolean;
}

export class TemplatePicking {
	readonly #store: () => DocumentStore;
	/** Set while the picker is open: the page, and what its picker stands by. */
	picking = $state<TemplatePick | null>(null);
	/** The page the picker lays out, while it is still there. */
	readonly page: DocPage | undefined;

	constructor(store: () => DocumentStore) {
		this.#store = store;
		this.page = $derived(this.picking ? store().page(this.picking.pageId) : undefined);
	}

	/** Open the picker for a page, by `anchor`. */
	open(pageId: string, anchor: PickerAnchor): void {
		this.picking = { pageId, anchor };
	}

	close = (): void => {
		this.picking = null;
	};

	/**
	 * The picker's choice: the page laid out as `template`, on as many pages as `laid`
	 * has. Null when the document did not take it (`DocumentStore.layPage`).
	 */
	apply(pageId: string, template: TemplateInfo, laid: LaidPage[]): AppliedTemplate | null {
		const store = this.#store();
		const number = store.pageIndex(pageId) + 1;
		const restore = store.layPage(pageId, laid);
		if (!restore) return null;
		const pages = laid.length > 1 ? `, on ${laid.length} pages` : '';
		return {
			message: `Page ${number} laid out as “${template.name}”${pages}`,
			restored: `Page ${number} as it was`,
			restore
		};
	}
}
