import { describe, expect, it } from 'vitest';
import { contentBox, GUTTER_MM } from '$lib/document/geometry';
import { DEFAULT_TABLE } from '$lib/document/table';
import { chart } from '$lib/document/test-support';
import { DEFAULT_TEXT_STYLE, MAX_TEXT_CHARS } from '$lib/document/text';
import type { DocPage, TextStyle } from '$lib/document/types';
import { measuredLayout } from '../typeset.svelte';
import { NEW_TEXT, newTable, newText, wordsAsText } from './new-blocks';

const BOX = contentBox('portrait');
const BOLD: TextStyle = { ...DEFAULT_TEXT_STYLE, bold: true, italic: true, size: 18 };

function page(...blocks: DocPage['blocks']): DocPage {
	return { id: 'p', orientation: 'portrait', blocks };
}

/** A disc over the left of the page's top, leaving room beside it. */
function discAtTop(): DocPage['blocks'][number] {
	return { kind: 'chart', id: 'a', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } };
}

describe('newText', () => {
	it('starts at the top of an empty page, as wide as it, as tall as its line', () => {
		const text = newText(page(), BOLD);
		expect(text.kind).toBe('text');
		expect(text.text).toBe(NEW_TEXT);
		expect(text.style).toBe(BOLD);
		expect(text.frame).toEqual({
			x: BOX.x,
			y: BOX.y,
			w: BOX.w,
			h: measuredLayout(NEW_TEXT, BOLD, BOX.w).height
		});
	});

	it('takes the topmost free place, a gutter clear of what is there', () => {
		const text = newText(page(discAtTop()), DEFAULT_TEXT_STYLE);
		expect(text.frame.y).toBe(BOX.y);
		expect(text.frame.x).toBeCloseTo(12 + 90 + GUTTER_MM);
		expect(text.frame.x + text.frame.w).toBeCloseTo(BOX.x + BOX.w);
	});
});

describe('newTable', () => {
	it('lists the Messier objects, set like the last text but never bold or italic', () => {
		const table = newTable(page(), BOLD, []);
		expect(table.kind).toBe('table');
		expect(table.table).toEqual(DEFAULT_TABLE);
		expect(table.table).not.toBe(DEFAULT_TABLE);
		expect(table.style).toEqual({ ...BOLD, bold: false, italic: false });
	});

	it('stands at the left margin of a clear page, no wider than it likes to be', () => {
		const table = newTable(page(), DEFAULT_TEXT_STYLE, []);
		expect(table.frame.x).toBe(BOX.x);
		expect(table.frame.y).toBe(BOX.y);
		expect(table.frame.w).toBeLessThanOrEqual(BOX.w);
		expect(table.frame.h).toBeGreaterThan(0);
	});

	it('goes to the far end of the room beside something already there', () => {
		const table = newTable(page(discAtTop()), DEFAULT_TEXT_STYLE, []);
		expect(table.frame.y).toBe(BOX.y);
		expect(table.frame.x + table.frame.w).toBeCloseTo(BOX.x + BOX.w);
		expect(table.frame.x).toBeGreaterThanOrEqual(12 + 90 + GUTTER_MM - 1e-9);
	});
});

describe('wordsAsText', () => {
	it('keeps the words as lines, whatever ended them where they were copied', () => {
		const copy = wordsAsText(page(), '  M 31\r\nM 33\rM 42\n\n', DEFAULT_TEXT_STYLE);
		expect(copy).toMatchObject({
			kind: 'text',
			text: 'M 31\nM 33\nM 42',
			style: DEFAULT_TEXT_STYLE
		});
	});

	it('takes no more than a text holds', () => {
		const copy = wordsAsText(page(), 'a'.repeat(MAX_TEXT_CHARS + 50), DEFAULT_TEXT_STYLE);
		expect(copy.kind === 'text' && copy.text.length).toBe(MAX_TEXT_CHARS);
	});

	it('is as tall as the words are at the width of the place found for them', () => {
		const words = 'A long line of words that wraps where the page is narrow. '.repeat(4);
		const beside = wordsAsText(page(discAtTop()), words, DEFAULT_TEXT_STYLE);
		const room = BOX.w - 90 - GUTTER_MM;
		expect(beside.frame.w).toBeCloseTo(room);
		expect(beside.frame.h).toBe(
			measuredLayout(words.trim(), DEFAULT_TEXT_STYLE, beside.frame.w).height
		);
		const alone = wordsAsText(page(), words, DEFAULT_TEXT_STYLE);
		expect(alone.frame.w).toBe(BOX.w);
		expect(beside.frame.h).toBeGreaterThanOrEqual(alone.frame.h);
	});
});
