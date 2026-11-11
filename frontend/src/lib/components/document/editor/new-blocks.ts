/**
 * What the editor puts on a page itself: a new text, a new table, and words from
 * the clipboard as a text. Each starts in the topmost free place of its page, set
 * like the last text was (`style`), as tall as its lines measure. No DOM beyond
 * that measure.
 */

import { contentBox } from '$lib/document/geometry';
import { DEFAULT_TABLE } from '$lib/document/table';
import { MAX_TEXT_CHARS, newTextFrame, type Sheets } from '$lib/document/text';
import { likedTableWidth, measuredLayout, shownLayout } from '$lib/document/text-fonts.svelte';
import type {
	BlockCopy,
	DocPage,
	NewBlock,
	TableBlock,
	TextBlock,
	TextStyle
} from '$lib/document/types';

/** What a new text says until it is typed over. */
export const NEW_TEXT = 'Text';

type Page = Pick<DocPage, 'orientation' | 'blocks'>;

/** A new text: as wide as the free place it is given. */
export function newText(page: Page, style: TextStyle): NewBlock<TextBlock> {
	const width = contentBox(page.orientation).w;
	const { height } = measuredLayout(NEW_TEXT, style, width);
	return { kind: 'text', text: NEW_TEXT, style, frame: newTextFrame(page, height) };
}

/**
 * A new table: the names of the Messier objects on the chart nearest to it, as on
 * a SkyGen worksheet, as wide as it likes to be (so that a second stands beside
 * it), never bold or italic. `pages` is the document, for a table that reads a
 * chart on another page.
 */
export function newTable(page: Page, lastStyle: TextStyle, pages: Sheets): NewBlock<TableBlock> {
	const style = { ...lastStyle, bold: false, italic: false };
	const table = { ...DEFAULT_TABLE };
	const box = contentBox(page.orientation);
	const draft: TableBlock = { kind: 'table', id: '', style, table, frame: box };
	// As tall as its rows; the place found for it may be narrower, but a table's rows are its rows.
	const height = shownLayout(page, draft, box.w, pages).height;
	const place = newTextFrame(page, height);
	const w = Math.min(place.w, likedTableWidth(page, { ...draft, frame: place }, pages));
	// Beside something already there it goes to the far end of the room, as the second
	// table of a SkyGen worksheet stands at the right margin.
	const x = place.x > box.x + 1e-6 ? place.x + place.w - w : place.x;
	return { kind: 'table', style, table, frame: { ...place, x, w } };
}

/** Words from the clipboard as a text to paste. */
export function wordsAsText(page: Page, words: string, style: TextStyle): BlockCopy {
	const text = words.replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT_CHARS);
	const full = contentBox(page.orientation).w;
	const place = newTextFrame(page, measuredLayout(text, style, full).height);
	// The place may be narrower than the page, and the words taller for it.
	const frame = { ...place, h: measuredLayout(text, style, place.w).height };
	return { kind: 'text', text, style, frame };
}
