// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentBox, GUTTER_MM, overlaps, rotatedBounds } from './geometry';
import { chartsOf, isBlank, typesetOf } from './blocks';
import { DocumentStore } from './document.svelte';
import { DOCUMENT_STORAGE_KEY } from './storage';
import { chart, expectInside, memoryStorage, saved, wordsOf } from './test-support';
import { DEFAULT_TEXT_STYLE, MAX_TEXT_CHARS, MAX_TEXTS_PER_PAGE, MIN_TEXT_WIDTH_MM } from './text';
import type { NewBlock, Rect, TextBlock } from './types';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('DocumentStore: text', () => {
	const style = { ...DEFAULT_TEXT_STYLE };

	function caption(frame: Rect = { x: 12, y: 200, w: 186, h: 6 }): NewBlock<TextBlock> {
		return { kind: 'text', text: 'Latitude {lat}', style, frame };
	}

	it('puts a text on a page, fitted in, and the page is hand-arranged from then on', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, caption({ x: 150, y: 400, w: 500, h: 6 }))!;
		const [page] = doc.pages;
		expect(typesetOf(page)).toHaveLength(1);
		expect(typesetOf(page)[0]).toEqual({
			kind: 'text',
			id,
			text: 'Latitude {lat}',
			style,
			frame: { x: 12, y: 279, w: 186, h: 6 }
		});
		expect(page.manual).toBe(true);
		expect(isBlank(page)).toBe(false);
		expect(doc.chartCount).toBe(0);
		expect(doc.addBlock('nowhere', caption())).toBeNull();
	});

	it('holds a text to the length and a page to the number the backend takes', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, { ...caption(), text: 'x'.repeat(MAX_TEXT_CHARS + 10) })!;
		expect(wordsOf(typesetOf(doc.pages[0])[0])).toHaveLength(MAX_TEXT_CHARS);
		doc.updateTypeset(pageId, id, { text: 'y'.repeat(MAX_TEXT_CHARS + 1) });
		expect(wordsOf(typesetOf(doc.pages[0])[0])).toHaveLength(MAX_TEXT_CHARS);
		for (let i = 1; i < MAX_TEXTS_PER_PAGE; i++)
			expect(doc.addBlock(pageId, caption())).not.toBeNull();
		expect(doc.addBlock(pageId, caption())).toBeNull();
		expect(typesetOf(doc.pages[0])).toHaveLength(MAX_TEXTS_PER_PAGE);
	});

	it('changes the words, the style, the frame and the chart a text reads', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, caption())!;
		expect(
			doc.updateTypeset(pageId, id, {
				text: 'φ = {lat}',
				style: { ...style, bold: true, size: 18 },
				frame: { x: 100, y: 20, w: 5, h: 9 },
				chartId: 'chart-b'
			})
		).toBe(true);
		expect(typesetOf(doc.pages[0])[0]).toEqual({
			kind: 'text',
			id,
			text: 'φ = {lat}',
			style: { ...style, bold: true, size: 18 },
			frame: { x: 100, y: 20, w: MIN_TEXT_WIDTH_MM, h: 9 },
			chartId: 'chart-b'
		});
		doc.updateTypeset(pageId, id, { chartId: null });
		expect(typesetOf(doc.pages[0])[0]).not.toHaveProperty('chartId');
		expect(doc.updateTypeset(pageId, 'gone', { text: 'x' })).toBe(false);
	});

	it('follows the height a text is laid out at without forgetting a turn', () => {
		const doc = new DocumentStore(null);
		doc.addChart(chart());
		const [page] = doc.pages;
		const id = doc.addBlock(page.id, caption({ x: 12, y: 260, w: 186, h: 6 }))!;
		doc.setOrientation(page.id, 'landscape');
		const memo = page.turnMemo;
		expect(memo).toBeDefined();
		doc.setTextHeight(page.id, id, 17);
		expect(typesetOf(page)[0].frame.h).toBe(17);
		expect(page.turnMemo).toBe(memo);
		// A height that pushes it past the foot of the content box moves it up.
		doc.setTextHeight(page.id, id, 60);
		const { y, h } = typesetOf(page)[0].frame;
		expect(y + h).toBeLessThanOrEqual(contentBox('landscape').y + contentBox('landscape').h + 1e-9);
	});

	it('turns the text with the page, and back to where it was', () => {
		const doc = new DocumentStore(null);
		doc.addChart(chart());
		const [page] = doc.pages;
		const frame = { x: 12, y: 250, w: 186, h: 6 };
		doc.addBlock(page.id, caption(frame));
		doc.addBlock(page.id, caption({ x: 105, y: 20, w: 93, h: 6 }));
		doc.setOrientation(page.id, 'landscape');
		const box = contentBox('landscape');
		// The full width stays the full width; the half on the right stays the half on the right.
		expect(typesetOf(page)[0].frame).toMatchObject({ x: box.x, w: box.w });
		expect(typesetOf(page)[1].frame.x + typesetOf(page)[1].frame.w).toBeCloseTo(box.x + box.w);
		expect(typesetOf(page)[1].frame.w).toBeCloseTo(box.w / 2);
		for (const text of typesetOf(page)) expectInside(text.frame, page);
		expect(page.manual).toBe(true);
		doc.setOrientation(page.id, 'portrait');
		expect(typesetOf(page)[0].frame.x).toBeCloseTo(frame.x);
		expect(typesetOf(page)[0].frame.y).toBeCloseTo(frame.y);
		expect(typesetOf(page)[0].frame.w).toBeCloseTo(frame.w);
		expect(page.manual).toBe(true);
	});

	it('moves a text to another page, where it reads the nearest chart or goes on reading its own', () => {
		const doc = new DocumentStore(null);
		const first = doc.addPage();
		const second = doc.addPage('landscape');
		const id = doc.addBlock(first, { ...caption(), chartId: 'chart-a' })!;
		expect(doc.moveBlock(id, second, { x: 200, y: 150, w: 186, h: 6 })).toBe(true);
		expect(typesetOf(doc.pages[0])).toEqual([]);
		const moved = typesetOf(doc.pages[1])[0];
		// Told a chart, it goes on reading it from the other page.
		expect(moved).toMatchObject({ id, text: 'Latitude {lat}', chartId: 'chart-a' });
		expectInside(moved.frame, doc.pages[1]);
		expect(doc.pages[1].manual).toBe(true);
		// On its own page a move is a change of frame.
		expect(doc.moveBlock(id, second, { x: 12, y: 12, w: 100, h: 6 })).toBe(true);
		expect(typesetOf(doc.pages[1])[0].frame).toEqual({ x: 12, y: 12, w: 100, h: 6 });
		expect(doc.moveBlock('gone', first, moved.frame)).toBe(false);
	});

	it('keeps the sky of a text moved to a page with no chart, and lets go of it on a page with one', () => {
		const doc = new DocumentStore(null);
		doc.addChart(chart());
		const [withChart] = doc.pages;
		const skyId = chartsOf(withChart)[0].id;
		const bare = doc.addPage();
		const other = doc.addPage();
		doc.pages[2].blocks.push({
			kind: 'chart',
			id: 'other',
			chart: chart(),
			frame: { x: 12, y: 12, w: 90, h: 90 }
		});
		const frame = { x: 12, y: 250, w: 100, h: 6 };

		// It read the nearest chart of its page; on a page with none it is told that one.
		const table = doc.addBlock(withChart.id, {
			kind: 'table',
			style,
			frame,
			table: { source: 'messier', rows: 5 }
		})!;
		expect(doc.moveBlock(table, bare, frame)).toBe(true);
		expect(typesetOf(doc.pages[1])[0].chartId).toBe(skyId);
		// Moved on to a page with a chart, it still reads the one it was told.
		expect(doc.moveBlock(table, other, frame)).toBe(true);
		expect(typesetOf(doc.pages[2])[0].chartId).toBe(skyId);

		// One that read the nearest and lands by a chart reads the nearest there.
		const words = doc.addBlock(withChart.id, caption(frame))!;
		expect(doc.moveBlock(words, other, frame)).toBe(true);
		expect(typesetOf(doc.pages[2])[1]).not.toHaveProperty('chartId');
		// From a page with no chart to another with none, there is nothing to keep.
		const lone = doc.addBlock(bare, caption(frame))!;
		const empty = doc.addPage();
		expect(doc.moveBlock(lone, empty, frame)).toBe(true);
		expect(typesetOf(doc.pages[3])[0]).not.toHaveProperty('chartId');
	});

	it('turns a text about its centre, fitted to the page by what it takes up', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, caption({ x: 12, y: 120, w: 186, h: 6 }))!;
		const text = () => typesetOf(doc.pages[0])[0];
		expect(text()).not.toHaveProperty('rotation');

		expect(doc.updateTypeset(pageId, id, { rotation: 90 })).toBe(true);
		expect(text().rotation).toBe(90);
		// The same centre, the same size: on its side it fits where it stood.
		expect(text().frame).toEqual({ x: 12, y: 120, w: 186, h: 6 });
		expect(rotatedBounds(text().frame, 90)).toMatchObject({ x: 102, y: 30, w: 6, h: 186 });

		// 450° is 90°, 360° is upright again, and upright carries no rotation.
		doc.updateTypeset(pageId, id, { rotation: -270 });
		expect(text().rotation).toBe(90);
		doc.updateTypeset(pageId, id, { rotation: 360 });
		expect(text()).not.toHaveProperty('rotation');

		// Turned at the edge, it is moved in until what it takes up is on the page.
		doc.updateTypeset(pageId, id, { frame: { x: 12, y: 14, w: 186, h: 6 } });
		doc.updateTypeset(pageId, id, { rotation: -90 });
		const box = contentBox('portrait');
		const taken = rotatedBounds(text().frame, -90);
		expect(taken.y).toBeCloseTo(box.y);
		expect(taken.h).toBeCloseTo(186);

		// Its height changes from its own top-left corner: here the bottom-left of what it takes up.
		const before = rotatedBounds(text().frame, -90);
		doc.setTextHeight(pageId, id, 18);
		const after = rotatedBounds(text().frame, -90);
		expect(after.w).toBeCloseTo(18);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y + after.h).toBeCloseTo(before.y + before.h);
	});

	it('keeps the turn through a save, a move to another page and an Undo', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const first = doc.addPage();
		const second = doc.addPage();
		const id = doc.addBlock(first, { ...caption({ x: 40, y: 100, w: 100, h: 6 }), rotation: 180 })!;
		expect(typesetOf(doc.pages[0])[0].rotation).toBe(180);
		doc.moveBlock(id, second, { x: 40, y: 100, w: 100, h: 6 });
		expect(typesetOf(doc.pages[1])[0].rotation).toBe(180);
		const restore = doc.removeBlock(second, id);
		expect(restore()).toBe(true);
		expect(typesetOf(doc.pages[1])[0].rotation).toBe(180);
		doc.flush();
		const again = new DocumentStore(storage);
		again.load();
		expect(typesetOf(again.pages[1])[0].rotation).toBe(180);
		// What does not read as an angle is upright.
		const raw = saved(storage);
		(typesetOf(raw.pages[1])[0] as { rotation: unknown }).rotation = 'sideways';
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		const odd = new DocumentStore(storage);
		odd.load();
		expect(typesetOf(odd.pages[1])[0]).not.toHaveProperty('rotation');
	});

	it('removes a text and puts it back once', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const a = doc.addBlock(pageId, caption())!;
		const b = doc.addBlock(pageId, { ...caption(), text: 'second' })!;
		const restore = doc.removeBlock(pageId, a);
		expect(typesetOf(doc.pages[0]).map((it) => it.id)).toEqual([b]);
		expect(restore()).toBe(true);
		expect(typesetOf(doc.pages[0]).map((it) => it.id)).toEqual([a, b]);
		expect(restore()).toBe(false);
		expect(doc.removeBlock(pageId, 'gone')()).toBe(false);
		const gone = doc.removeBlock(pageId, b);
		doc.removePage(pageId);
		expect(gone()).toBe(false);
	});

	it('gives Add to PDF the free space of a page with text, and never its place', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		doc.addBlock(pageId, caption({ x: 12, y: 12, w: 186, h: 10 }));
		const result = doc.addChart(chart());
		expect(result).toMatchObject({ pageId, newPage: false, relaid: false });
		const [page] = doc.pages;
		expect(page.manual).toBe(true);
		expect(overlaps(chartsOf(page)[0].frame, typesetOf(page)[0].frame, GUTTER_MM)).toBe(false);
		expectInside(chartsOf(page)[0].frame, page);
		// Taken back, the text stays.
		expect(result.undo()).toBe(true);
		expect(chartsOf(page)).toEqual([]);
		expect(typesetOf(page)).toHaveLength(1);
		expect(page.manual).toBe(true);
	});
});
