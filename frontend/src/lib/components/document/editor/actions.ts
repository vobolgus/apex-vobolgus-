/**
 * What a page in the editor, and a chart or a text on it, may ask of the editor:
 * one object handed down in place of a callback for every button and handle.
 *
 * Three groups, each a controller's own face (`PageOperations`, `DragController`,
 * `BlockOperations`), and with them what a page reads of the drag going on to draw
 * itself (`DragState`). An action takes the block it is about; where a chart and a
 * text differ, the controller behind it tells them apart by `kind`, and what only
 * one kind has (typing, a table's spec) takes only that kind.
 */

import type { ResizeAnchor } from '$lib/document/geometry';
import type {
	ChartBlock,
	DocBlock,
	DocPage,
	PageOrientation,
	TableBlock,
	TableSpec,
	TextBlock,
	TextStyle,
	TypesetBlock
} from '$lib/document/types';
import type { PageDrag } from './drag-view';

/** The side of a text a width handle is on. */
export type TextSide = 'w' | 'e';

/** What is done to a page from its label and its paper. */
export interface PageActions {
	/** Show the page in the middle. */
	show(pageId: string): void;
	/** A new page at the end, shown. */
	add(): void;
	setOrientation(pageId: string, orientation: PageOrientation): void;
	/** Delete the page; one with anything on it stays. */
	remove(pageId: string): void;
	/** Open the template picker under `button`. */
	pickTemplate(pageId: string, button: HTMLElement): void;
}

/** Presses that become drags once the pointer has gone far enough. */
export interface PointerActions {
	/** On a block itself: it is carried, on its page or to another. */
	carry(event: PointerEvent, block: DocBlock): void;
	/** On a handle: a chart's corner, which keeps its aspect, or a side of a text or a table. */
	resize(event: PointerEvent, block: ChartBlock, corner: ResizeAnchor): void;
	resize(event: PointerEvent, block: TypesetBlock, side: TextSide): void;
	/** On the knob over a text or a table: it turns about its centre. */
	turn(event: PointerEvent, block: TypesetBlock): void;
}

/** What a drag is doing just now, for a page to draw: read, never written. */
export interface DragState {
	/** What `page` draws for the drag going on, or for the lines of the last nudge. */
	pageDrag(page: DocPage): PageDrag | null;
	/** A block easing back after a drag that was let go off every page. */
	readonly returningId: string | null;
	/** A block coming to rest after it was let go over a page. */
	readonly settlingId: string | null;
	/** A block is being carried somewhere in the editor: the others go quiet. */
	readonly carrying: boolean;
}

/** What is done to a block without a drag: its keys, its toolbar, its field. */
export interface BlockActions {
	/** The text being typed in. */
	readonly editingId: string | null;
	/** A new text on the page, open for typing. */
	addText(pageId: string): void;
	/** A new table on the page, selected. */
	addTable(pageId: string): void;
	/** A key pressed with the block selected. */
	keydown(event: KeyboardEvent, block: DocBlock): void;
	/** Take it off its page; the toast's Undo brings it back. */
	remove(block: DocBlock): void;
	/** One step larger or smaller: a chart's size, a text's type. */
	step(block: DocBlock, direction: 1 | -1): void;
	/** To the page before or after. */
	toPage(block: DocBlock, by: 1 | -1): void;
	/** A quarter turn clockwise. */
	turn(block: TypesetBlock): void;
	restyle(block: TypesetBlock, style: TextStyle): void;
	/** Start typing in it. */
	edit(block: TextBlock): void;
	/** Typing is over: what it says now. */
	commitText(block: TextBlock, value: string): void;
	/** Its lines are this tall now, mm. */
	setHeight(block: TypesetBlock, height: number): void;
	/** Read the chart `chartId` whatever is nearer, or with null the nearest again. */
	bind(block: TypesetBlock, chartId: string | null): void;
	/** A table lists something else, or in more or fewer rows. */
	setTable(block: TableBlock, table: TableSpec): void;
}

export interface EditorActions {
	pages: PageActions;
	pointer: PointerActions;
	blocks: BlockActions;
	drag: DragState;
}
