import { describe, expect, it } from 'vitest';
import { DEFAULT_TABLE } from '$lib/document/table';
import { chart } from '$lib/document/test-support';
import { DEFAULT_TEXT_STYLE } from '$lib/document/text';
import type { ChartBlock, DocPage, TableBlock, TextBlock } from '$lib/document/types';
import { linkedChartId, otherCharts, readingOf, readsAChart } from './reads';

function disc(id: string, x: number, y: number): ChartBlock {
	return { kind: 'chart', id, chart: chart(), frame: { x, y, w: 60, h: 60 } };
}

function text(words: string, over: Partial<TextBlock> = {}): TextBlock {
	return {
		kind: 'text',
		id: 't',
		text: words,
		style: DEFAULT_TEXT_STYLE,
		frame: { x: 12, y: 80, w: 60, h: 6 },
		...over
	};
}

const TABLE: TableBlock = {
	kind: 'table',
	id: 'tb',
	table: DEFAULT_TABLE,
	style: DEFAULT_TEXT_STYLE,
	frame: { x: 120, y: 80, w: 60, h: 20 }
};

/** Two charts side by side, a text under the left one and a table under the right. */
const TWO: DocPage = {
	id: 'p1',
	orientation: 'portrait',
	blocks: [disc('left', 12, 12), disc('right', 120, 12), text('{lst}'), TABLE]
};
const ONE: DocPage = { id: 'p2', orientation: 'portrait', blocks: [disc('lone', 12, 12)] };
const NONE: DocPage = { id: 'p3', orientation: 'portrait', blocks: [] };
const PAGES = [TWO, ONE, NONE];

describe('otherCharts', () => {
	it('names the charts of every other page by its page and its place on it', () => {
		expect(otherCharts(ONE, PAGES)).toEqual([
			{ id: 'left', label: 'Page 1 · chart 1' },
			{ id: 'right', label: 'Page 1 · chart 2' }
		]);
		expect(otherCharts(TWO, PAGES)).toEqual([{ id: 'lone', label: 'Page 2 · chart 1' }]);
		expect(otherCharts(TWO, [TWO])).toEqual([]);
	});
});

describe('readsAChart', () => {
	it('is so for a table, and for a text with fields', () => {
		expect(readsAChart(TABLE, '')).toBe(true);
		expect(readsAChart(text(''), 'Sidereal time {lst}')).toBe(true);
		expect(readsAChart(text('{lst}'), 'No fields here')).toBe(false);
	});
});

describe('readingOf', () => {
	const others = otherCharts(TWO, PAGES);

	it('reads the nearest chart of its page, by its place there', () => {
		expect(readingOf(TWO, text('{lst}'), PAGES, others)).toEqual({
			at: 0,
			pinned: false,
			other: null
		});
		expect(readingOf(TWO, TABLE, PAGES, others)).toEqual({ at: 1, pinned: false, other: null });
	});

	it('reads the chart of its page it was told, pinned to it', () => {
		const told = text('{lst}', { chartId: 'right' });
		expect(readingOf(TWO, told, PAGES, others)).toEqual({ at: 1, pinned: true, other: null });
	});

	it('reads a chart of another page it was told, which is not on its own', () => {
		const told = { ...TABLE, chartId: 'lone' };
		expect(readingOf(TWO, told, PAGES, others)).toEqual({ at: null, pinned: false, other: 'lone' });
	});

	it('reads nothing on a page of its own with no chart named', () => {
		const alone = { ...NONE, blocks: [TABLE] };
		expect(readingOf(alone, TABLE, PAGES, otherCharts(alone, PAGES))).toEqual({
			at: null,
			pinned: false,
			other: null
		});
	});
});

describe('linkedChartId', () => {
	it('is the chart a selected text with fields or a table reads, with two charts on the page', () => {
		expect(linkedChartId(TWO, PAGES, text('{lst}'), null)).toBe('left');
		expect(linkedChartId(TWO, PAGES, TABLE, null)).toBe('right');
	});

	it('is none for a text without fields, unless it is being typed in', () => {
		const plain = text('Words alone');
		expect(linkedChartId(TWO, PAGES, plain, null)).toBeNull();
		expect(linkedChartId(TWO, PAGES, plain, 'other')).toBeNull();
		expect(linkedChartId(TWO, PAGES, plain, plain.id)).toBe('left');
	});

	it('is none with one chart on the page or nothing selected', () => {
		const page = { ...ONE, blocks: [...ONE.blocks, TABLE] };
		expect(linkedChartId(page, PAGES, TABLE, null)).toBeNull();
		expect(linkedChartId(TWO, PAGES, undefined, null)).toBeNull();
	});
});
