/**
 * Type as the editor shows it: set in the faces loaded so far, and a table read
 * from the catalogues as they are now. The one place where the pure layouts
 * (`text.ts`, `table.ts`) meet the global state they read: each call reads
 * `textFonts.epoch`, so a layout made inside an effect or a `$derived` is made
 * again when a face arrives, and the catalogue store, so it is made again when a
 * catalogue does. The document's export is set the same way, once what it needs
 * has arrived (`typesetRequest`).
 */

import { loadMessier } from '$lib/api/catalog';
import type { DocumentRequest } from '$lib/api/wire/request';
import { typesetOf } from '$lib/document/blocks';
import { documentRequest } from '$lib/document/render';
import {
	blockLayout,
	boundTableContent,
	narrowestTableWidth,
	tableWidth,
	type Sky
} from '$lib/document/table';
import { layoutText, type Sheets, type TextLayout } from '$lib/document/text';
import type { DocPage, TableBlock, TextStyle, TypesetBlock } from '$lib/document/types';
import { loadTextFonts, measureText, textFonts } from '$lib/renderer/text-measure.svelte';
import { catalog } from '$lib/state/catalog.svelte';

/** What the tables read: the catalogues, as far as they have loaded. */
function loadedSky(): Sky {
	return { messier: catalog.messier, stars: catalog.stars };
}

/** `text` laid out with the loaded faces; inside an effect or a `$derived`, made again when one arrives. */
export function measuredLayout(text: string, style: TextStyle, widthMm: number): TextLayout {
	void textFonts.epoch;
	return layoutText(text, style, widthMm, measureText);
}

/** How tall `text` sets with the loaded faces, mm: the measure a template lays a page out with. */
export function measuredHeight(text: string, style: TextStyle, widthMm: number): number {
	return measuredLayout(text, style, widthMm).height;
}

/**
 * The document as the backend is asked for it (`documentRequest`), once what its
 * type needs has arrived: lines broken in a fallback font would break elsewhere in
 * the PDF, and a table of Messier objects lists none without their catalogue.
 */
export async function typesetRequest(pages: readonly DocPage[]): Promise<DocumentRequest> {
	const type = pages.flatMap(typesetOf);
	await loadTextFonts(type.map((block) => block.style));
	if (type.some((block) => block.kind === 'table' && block.table.source === 'messier')) {
		await loadMessier();
	}
	return documentRequest(pages, measureText, loadedSky());
}

/**
 * What a block shows, laid out `widthMm` wide (its own width when not given): a
 * text with its fields read from its chart, or a table read from it and from the
 * catalogues. Made again when a face or a catalogue arrives; a table of Messier
 * objects asks for their catalogue on the way. `pages` is the document, for a block
 * that reads a chart on another page than its own.
 */
export function shownLayout(
	page: Pick<DocPage, 'blocks'>,
	block: TypesetBlock,
	widthMm: number = block.frame.w,
	pages?: Sheets
): TextLayout {
	void textFonts.epoch;
	if (block.kind === 'table' && block.table.source === 'messier' && catalog.messier.length === 0) {
		void loadMessier();
	}
	return blockLayout(page, block, widthMm, measureText, loadedSky(), pages);
}

/** What of a table says how wide it sets: a table yet to be put on a page has no more. */
type TableShape = Pick<TableBlock, 'table' | 'style' | 'chartId' | 'frame' | 'rotation'>;

/** The width a table likes to be (`tableWidth`), with the loaded faces and catalogues, mm. */
export function likedTableWidth(
	page: Pick<DocPage, 'blocks'>,
	table: TableShape,
	pages?: Sheets
): number {
	void textFonts.epoch;
	const content = boundTableContent(page, table, loadedSky(), pages);
	return tableWidth(content, table.style, measureText);
}

/** The narrowest a table can be made with nothing of it outside its width (`narrowestTableWidth`), mm. */
export function leastTableWidth(
	page: Pick<DocPage, 'blocks'>,
	table: TableShape,
	pages?: Sheets
): number {
	void textFonts.epoch;
	const content = boundTableContent(page, table, loadedSky(), pages);
	return narrowestTableWidth(content, table.style, measureText);
}
