/**
 * What is done to a block of the page editor without a drag: its keys and its
 * toolbar, and for a text or a table what its field and its tools change.
 *
 * A chart, a text and a table are added to, moved between pages, stepped in size
 * and removed alike; where they differ (a chart's size is its frame, a text's its
 * type; a chart is placed clear of the others, a text where it was) the kind is
 * asked here, in the operation. The text being typed in is kept here too, and how
 * the last one was set, which the next starts as.
 *
 * Nothing here changes the document while a drag goes on.
 */

import { tick } from 'svelte';
import { loadMessier } from '$lib/api/catalog';
import { chartsOf, findBlock, isChart, layerIndex } from '$lib/document/blocks';
import { contentBox, stepSize } from '$lib/document/geometry';
import { hasRoom } from '$lib/document/page';
import { lookOf } from '$lib/document/table';
import { DEFAULT_TEXT_STYLE, quarterTurn, stepTextSize } from '$lib/document/text';
import { likedTableWidth } from '$lib/document/text-fonts.svelte';
import type { DocBlock, DocPage, TableSpec, TextStyle, TypesetBlock } from '$lib/document/types';
import { spokenSize, type Point } from '../editor-geometry';
import type { BlockActions } from './actions';
import { frameOnPage, nudgedFrame } from './block-geometry';
import { blockCommand, repeatsWhenHeld, type BlockCommand } from './block-keys';
import type { EditorContext } from './context.svelte';
import type { DragController } from './drag.svelte';
import { newTable, newText } from './new-blocks';

export class BlockOperations implements BlockActions {
	readonly #editor: EditorContext;
	readonly #drag: DragController;
	/** The text being typed in. */
	editingId = $state<string | null>(null);
	/** How the last text was set: the next one starts the same. */
	#lastStyle: TextStyle = DEFAULT_TEXT_STYLE;

	constructor(editor: EditorContext, drag: DragController) {
		this.#editor = editor;
		this.#drag = drag;
	}

	/** How a text added now is set: like the last one. */
	get nextStyle(): TextStyle {
		return { ...this.#lastStyle };
	}

	/** The page a block is on: the current one, or a neighbour. */
	#pageOf(blockId: string): DocPage | undefined {
		return findBlock(this.#editor.store.pages, blockId)?.page;
	}

	// === Adding ===

	/**
	 * A new text on the page, in the topmost free place there and as wide as it, set
	 * like the last one; it opens for typing with its word selected.
	 */
	addText(pageId: string): void {
		const { store, announce } = this.#editor;
		const page = store.page(pageId);
		if (this.#drag.active || !page) return;
		if (!hasRoom(page, 'text')) {
			announce('This page holds no more text');
			return;
		}
		const textId = store.addBlock(page.id, newText(page, this.nextStyle));
		if (!textId) return;
		this.editingId = textId;
		announce('Text added. Type to replace it');
	}

	/**
	 * A new table on the page, in the topmost free place there (`newTable`). It is
	 * selected, its toolbar open to say what it should list.
	 */
	async addTable(pageId: string): Promise<void> {
		const { store, focus, announce } = this.#editor;
		// Its width is that of its names: have them before it is measured.
		await loadMessier();
		const page = store.page(pageId);
		if (this.#drag.active || !page) return;
		if (!hasRoom(page, 'table')) {
			announce('This page holds no more text');
			return;
		}
		const tableId = store.addBlock(page.id, newTable(page, this.#lastStyle, store.pages));
		if (!tableId) return;
		announce('Table added');
		void tick().then(() => focus.block(tableId));
	}

	// === Keys ===

	/** A key on a selected block. It goes no further once it is one of the block's own. */
	keydown(event: KeyboardEvent, block: DocBlock): void {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		// While a text is typed in, the keys are its field's.
		if (!isChart(block) && this.editingId !== null) return;
		const command = blockCommand(event, block.kind);
		if (!command) return;
		event.preventDefault();
		event.stopPropagation();
		if (this.#drag.active || (event.repeat && !repeatsWhenHeld(command, block.kind))) return;
		this.#run(command, block);
	}

	#run(command: BlockCommand, block: DocBlock): void {
		switch (command.do) {
			case 'nudge':
				return this.#nudge(block, command.delta);
			case 'step':
				return this.step(block, command.direction);
			case 'toPage':
				return this.toPage(block, command.by);
			case 'remove':
				return this.remove(block);
			case 'edit':
				if (!isChart(block)) this.edit(block);
				return;
			case 'turn':
				if (!isChart(block)) this.turn(block, command.direction);
		}
	}

	// === Any block ===

	/** Moves by `delta` mm, held to the page, and shows the lines it lands on. */
	#nudge(block: DocBlock, delta: Point): void {
		const { store, stage, announce } = this.#editor;
		const page = stage.current;
		if (!page) return;
		const { frame, guides } = nudgedFrame(page, block, delta);
		store.setFrame(page.id, block.id, frame);
		announce(`${Math.round(frame.x)}, ${Math.round(frame.y)} mm`);
		this.#drag.flash(page.id, guides);
	}

	/** One step larger or smaller: a chart through its sizes, a text through those of its type. */
	step(block: DocBlock, direction: 1 | -1): void {
		const { store, announce } = this.#editor;
		const page = this.#pageOf(block.id);
		if (this.#drag.active || !page) return;
		const atLimit = direction > 0 ? 'Already the largest size' : 'Already the smallest size';
		if (isChart(block)) {
			const frame = stepSize(block.frame, block.chart.aspect, page.orientation, direction);
			if (!frame) return announce(atLimit);
			store.setFrame(page.id, block.id, frame);
			announce(spokenSize(frame));
		} else {
			const size = stepTextSize(block.style.size, direction);
			if (size === null) return announce(atLimit);
			this.restyle(block, { ...block.style, size });
			announce(`${size} points`);
		}
	}

	/** To the page before or after (`frameOnPage`), which is then the one shown. */
	toPage(block: DocBlock, by: 1 | -1): void {
		const { store, stage, focus, announce } = this.#editor;
		if (this.#drag.active) return;
		const target = stage.pages[stage.index + by];
		const number = stage.index + by + 1;
		if (!target) {
			announce(by < 0 ? 'No page before this one' : 'No page after this one');
			return;
		}
		if (!store.moveBlock(block.id, target.id, frameOnPage(block, target))) {
			announce(isChart(block) ? `Page ${number} is full` : `Page ${number} holds no more text`);
			return;
		}
		stage.show(target.id, false, true);
		announce(`${isChart(block) ? 'Chart' : 'Text'} moved to page ${number}`);
		void tick().then(() => focus.block(block.id));
	}

	/**
	 * Take a block off its page. The toast's Undo (its button or ⌘Z) puts it back on
	 * its page, which the editor shows, with the focus on it; nothing is said if it
	 * did not come back, or the editor has closed meanwhile.
	 */
	remove(block: DocBlock): void {
		const { store, stage, focus, announce, notify } = this.#editor;
		const page = this.#pageOf(block.id);
		// A text or a table stays where it is while a drag goes on.
		if (!page || (!isChart(block) && this.#drag.active)) return;
		const pageId = page.id;
		const what = isChart(block) ? 'Chart' : 'Text';
		const at = layerIndex(page, block.id);
		if (this.editingId === block.id) this.editingId = null;
		const restore = store.removeBlock(pageId, block.id);
		notify(`${what} removed`, () => {
			if (!restore() || !this.#editor.isOpen) return;
			if (pageId !== stage.current?.id) stage.show(pageId, false, true);
			announce(`${what} restored`);
			void tick().then(() => focus.block(block.id));
		});
		// After a chart the focus goes to the one that took its place, else the one before;
		// after a text, and with no chart left, to the page.
		void tick().then(() => (isChart(block) ? focus.blockAt(at) : focus.paper()));
	}

	// === Text and tables ===

	/** A quarter turn, to the next right angle: clockwise, or back with −1. */
	turn(block: TypesetBlock, direction: 1 | -1 = 1): void {
		const { store, announce } = this.#editor;
		const page = this.#pageOf(block.id);
		if (!page || this.#drag.active) return;
		const rotation = quarterTurn(block.rotation ?? 0, direction);
		store.updateTypeset(page.id, block.id, { rotation });
		announce(rotation === 0 ? 'Upright' : `Turned to ${rotation} degrees`);
	}

	restyle(block: TypesetBlock, style: TextStyle): void {
		const page = this.#pageOf(block.id);
		if (!page || this.#drag.active) return;
		this.#lastStyle = { ...style };
		this.#editor.store.updateTypeset(page.id, block.id, { style });
	}

	/** A table's words are read from its chart: there is nothing in it to type. */
	edit(block: TypesetBlock): void {
		if (!this.#drag.active && block.kind === 'text') this.editingId = block.id;
	}

	/** Typing is over. A text left empty is taken off the page: there is nothing of it to keep. */
	commitText(block: TypesetBlock, value: string): void {
		const { store, focus } = this.#editor;
		if (this.editingId === block.id) this.editingId = null;
		const page = this.#pageOf(block.id);
		if (!page) return;
		if (value.trim() === '') {
			store.removeBlock(page.id, block.id);
			// If the focus was on its way to the text itself, it has nowhere to land.
			void tick().then(() => {
				if (!focus.isInside()) focus.paper();
			});
		} else if (block.kind === 'text' && value !== block.text) {
			store.updateTypeset(page.id, block.id, { text: value });
		}
	}

	setHeight(block: TypesetBlock, height: number): void {
		const page = this.#pageOf(block.id);
		if (page) this.#editor.store.setTextHeight(page.id, block.id, height);
	}

	/** Which chart a text's fields read: `chartId`, or the nearest again with null. */
	bind(block: TypesetBlock, chartId: string | null): void {
		const { store, announce } = this.#editor;
		const page = this.#pageOf(block.id);
		if (!page || this.#drag.active) return;
		store.updateTypeset(page.id, block.id, { chartId });
		const at = chartsOf(page).findIndex((chart) => chart.id === chartId);
		announce(
			chartId === null
				? 'Reads the nearest chart'
				: at < 0
					? 'Reads a chart on another page'
					: `Reads chart ${at + 1}`
		);
	}

	/**
	 * A table lists something else, or looks another way, or has more or fewer rows.
	 * What it lists and how it looks decide how wide it likes to be, so those two
	 * set its width again; the rows leave the width as it was made.
	 */
	async setTable(block: TypesetBlock, table: TableSpec): Promise<void> {
		const { store } = this.#editor;
		if (block.kind !== 'table') return;
		if (table.source === 'messier') await loadMessier();
		const page = this.#pageOf(block.id);
		if (!page || this.#drag.active) return;
		const same = block.table.source === table.source && lookOf(block.table) === lookOf(table);
		if (same) {
			store.updateTypeset(page.id, block.id, { table });
			return;
		}
		const liked = likedTableWidth(page, { ...block, table }, store.pages);
		const w = Math.min(contentBox(page.orientation).w, liked);
		store.updateTypeset(page.id, block.id, { table, frame: { ...block.frame, w } });
	}
}
