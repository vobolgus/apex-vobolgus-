// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aloneFrame } from './arrange';
import { contentBox, GUTTER_MM, overlaps, rotatedBounds } from './geometry';
import { chartsOf, isBlank, typesetOf } from './blocks';
import { createId, DocumentStore, MAX_CHARTS, MAX_PAGES } from './document.svelte';
import { MAX_ITEMS_PER_PAGE } from './page';
import { DOCUMENT_STORAGE_KEY, FIRST_SHAPE_STORAGE_KEY, type DocumentStorage } from './storage';
import { layTemplate } from './templates';
import { chart, expectInside, memoryStorage, saved, specOf, wordsOf } from './test-support';
import { DEFAULT_TEXT_STYLE, MAX_TEXT_CHARS, MAX_TEXTS_PER_PAGE, MIN_TEXT_WIDTH_MM } from './text';
import type { ChartBlock, DocPage, NewBlock, Rect, TextBlock } from './types';

/** A chart filling a portrait page's content box: nothing else fits beside it. */
function fullItem(id: string): ChartBlock {
	return { kind: 'chart', id, chart: chart(186 / 273), frame: { x: 12, y: 12, w: 186, h: 273 } };
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('DocumentStore', () => {
	it('starts empty with the panel open', () => {
		const doc = new DocumentStore(null);
		expect(doc.pages).toEqual([]);
		expect(doc.pageCount).toBe(0);
		expect(doc.chartCount).toBe(0);
		expect(doc.selectedPageId).toBeNull();
		expect(doc.panelOpen).toBe(true);
	});

	describe('addChart', () => {
		it('opens a portrait page for the first disc, at the full width, centred', () => {
			const doc = new DocumentStore(null);
			const result = doc.addChart(chart(), 'data:image/png;base64,AAAA');
			expect(result).toMatchObject({ newPage: true, relaid: false });
			expect(doc.pageCount).toBe(1);
			const [page] = doc.pages;
			expect(result.pageId).toBe(page.id);
			expect(page.orientation).toBe('portrait');
			expect(chartsOf(page)).toHaveLength(1);
			expect(chartsOf(page)[0]).toMatchObject({
				id: result.blockId,
				frame: { x: 12, y: 55.5, w: 186, h: 186 },
				thumb: 'data:image/png;base64,AAAA'
			});
		});

		it('opens a landscape page for a wide pinhole, a portrait one for anything else', () => {
			for (const aspect of [1.61, 3]) {
				const doc = new DocumentStore(null);
				doc.addChart(chart(aspect));
				expect(doc.pages[0].orientation, `${aspect}`).toBe('landscape');
				expect(chartsOf(doc.pages[0])[0].frame).toEqual(aloneFrame(aspect, 'landscape'));
			}
			for (const snapshot of [chart(), { ...chart(1.61), aspect: 1 }, chart(0.6)]) {
				const doc = new DocumentStore(null);
				doc.addChart(snapshot);
				expect(doc.pages[0].orientation).toBe('portrait');
			}
		});

		it('lays a page out again to fit a second disc, keeping each chart’s thumbnail', () => {
			const doc = new DocumentStore(null);
			const first = doc.addChart(chart(), 'data:image/png;base64,FIRST');
			const second = doc.addChart(chart(), 'data:image/png;base64,SECOND');
			expect(second).toMatchObject({ pageId: first.pageId, newPage: false, relaid: true });
			expect(chartsOf(doc.pages[0])).toMatchObject([
				{ id: first.blockId, frame: { x: 38.25, y: 12, w: 133.5, h: 133.5 } },
				{ id: second.blockId, frame: { x: 38.25, y: 151.5, w: 133.5, h: 133.5 } }
			]);
			expect(chartsOf(doc.pages[0]).map((it) => it.thumb)).toEqual([
				'data:image/png;base64,FIRST',
				'data:image/png;base64,SECOND'
			]);
			expect(doc.pages[0].layout).toEqual({ tree: { dir: 'V', kids: [0, 1] }, sizing: 'uniform' });
			// A third disc gets a page of its own: two discs a page.
			expect(doc.addChart(chart())).toMatchObject({ newPage: true });
			expect(doc.chartCount).toBe(3);
		});

		it('uses an empty page that is already there, as it is', () => {
			const doc = new DocumentStore(null);
			const pageId = doc.addPage('landscape');
			expect(doc.addChart(chart())).toMatchObject({ pageId, newPage: false, relaid: false });
			expect(doc.pages[0].orientation).toBe('landscape');
			expect(chartsOf(doc.pages[0])[0].frame).toEqual({ x: 55.5, y: 12, w: 186, h: 186 });
		});

		it('moves nothing on a hand-arranged page: the chart takes its free spot', () => {
			const doc = new DocumentStore(null);
			const { pageId, blockId } = doc.addChart(chart());
			doc.setFrame(pageId, blockId, { x: 12, y: 12, w: 120, h: 120 });
			expect(doc.addChart(chart(3))).toMatchObject({ pageId, relaid: false });
			const [disc, strip] = chartsOf(doc.pages[0]).map((it) => it.frame);
			expect(disc).toEqual({ x: 12, y: 12, w: 120, h: 120 });
			expect(strip).toEqual({ x: 12, y: 180.5, w: 186, h: 62 });
			expect(doc.pages[0].manual).toBe(true);
			expect(doc.pages[0].layout).toBeUndefined();
		});

		it('undoes an Add that laid the page out again: every frame, the order and the layout', () => {
			const doc = new DocumentStore(null);
			doc.addChart(chart());
			doc.addChart(chart(1.61));
			const page = doc.pages[0];
			const before = JSON.parse(JSON.stringify(page));
			// The 1.61 joined the disc: both 164.7 wide.
			chartsOf(page).forEach((it) => expect(it.frame.w).toBeCloseTo(164.7, 1));

			const added = doc.addChart(chart(3));
			expect(added).toMatchObject({ pageId: page.id, newPage: false, relaid: true });
			expect(chartsOf(doc.pages[0])).toHaveLength(3);
			expect(doc.pages[0].layout).not.toEqual(before.layout);

			expect(added.undo()).toBe(true);
			expect(JSON.parse(JSON.stringify(doc.pages[0]))).toEqual(before);
			expect(added.undo()).toBe(false);
			expect(chartsOf(doc.pages[0])).toHaveLength(2);
		});

		it('undoes an Add that opened a page by removing it, and moves the selection off it', () => {
			const doc = new DocumentStore(null);
			doc.addChart(chart());
			doc.addChart(chart());
			const third = doc.addChart(chart());
			expect(third.newPage).toBe(true);
			doc.selectedPageId = third.pageId;
			expect(third.undo()).toBe(true);
			expect(doc.pageCount).toBe(1);
			expect(doc.selectedPageId).toBe(doc.pages[0].id);
			expect(doc.chartCount).toBe(2);
		});

		it('restores a turned page’s memo and hand flag when its Add is undone', () => {
			const doc = new DocumentStore(null);
			const { pageId, blockId } = doc.addChart(chart());
			doc.setFrame(pageId, blockId, { x: 12, y: 12, w: 120, h: 120 });
			doc.setOrientation(pageId, 'landscape');
			const before = JSON.parse(JSON.stringify(doc.pages[0]));
			expect(before.turnMemo.manual).toBe(true);
			const added = doc.addChart(chart());
			expect(added.pageId).toBe(pageId);
			expect(doc.pages[0].turnMemo).toBeUndefined();
			expect(added.undo()).toBe(true);
			expect(JSON.parse(JSON.stringify(doc.pages[0]))).toEqual(before);
			// The memo is back: turning back restores the hand layout.
			doc.setOrientation(pageId, 'portrait');
			expect(chartsOf(doc.pages[0])[0].frame).toEqual({ x: 12, y: 12, w: 120, h: 120 });
			expect(doc.pages[0].manual).toBe(true);
		});

		it('refuses the undo once the page has changed since the Add', () => {
			const doc = new DocumentStore(null);
			const first = doc.addChart(chart());
			const second = doc.addChart(chart());
			doc.setFrame(first.pageId, first.blockId, { x: 12, y: 12, w: 90, h: 90 });
			const items = JSON.stringify(chartsOf(doc.pages[0]));
			expect(second.undo()).toBe(false);
			expect(JSON.stringify(chartsOf(doc.pages[0]))).toBe(items);

			// Nor once the page is turned, or the chart is gone.
			const third = doc.addChart(chart());
			doc.setOrientation(third.pageId, 'landscape');
			expect(third.undo()).toBe(false);
			const fourth = doc.addChart(chart());
			doc.removeBlock(fourth.pageId, fourth.blockId);
			expect(fourth.undo()).toBe(false);
		});

		it('stores a frozen copy of the chart', () => {
			const doc = new DocumentStore(null);
			const source = chart(1.5);
			doc.addChart(source);
			source.view.orientation.x = 0.5;
			source.layers.planets = true;
			const stored = chartsOf(doc.pages[0])[0];
			expect(stored.chart.view.orientation.x).toBe(0);
			expect(stored.chart.layers.planets).toBe(false);
			expect(stored.frame.w / stored.frame.h).toBeCloseTo(1.5, 9);
			expect(stored).not.toHaveProperty('thumb');
		});
	});

	describe('pages', () => {
		it('appends empty pages, portrait unless asked', () => {
			const doc = new DocumentStore(null);
			const a = doc.addPage();
			const b = doc.addPage('landscape');
			expect(doc.pages.map((p) => [p.id, p.orientation, chartsOf(p).length])).toEqual([
				[a, 'portrait', 0],
				[b, 'landscape', 0]
			]);
			expect(doc.page(b)?.orientation).toBe('landscape');
			expect(doc.pageIndex(b)).toBe(1);
			expect(doc.pageIndex('nope')).toBe(-1);
		});

		it('removes a page and undoes it in place, once', () => {
			const doc = new DocumentStore(null);
			const a = doc.addPage();
			const b = doc.addPage();
			const c = doc.addPage();
			doc.addChart(chart());
			const items = JSON.stringify(chartsOf(doc.page(a)!));
			doc.selectedPageId = a;

			const undo = doc.removePage(a);
			expect(doc.pages.map((p) => p.id)).toEqual([b, c]);
			expect(doc.selectedPageId).toBe(b);

			expect(undo()).toBe(true);
			expect(doc.pages.map((p) => p.id)).toEqual([a, b, c]);
			expect(JSON.stringify(chartsOf(doc.page(a)!))).toBe(items);
			expect(doc.selectedPageId).toBe(a);

			doc.removePage(c);
			expect(undo()).toBe(false);
			expect(doc.pages.map((p) => p.id)).toEqual([a, b]);
		});

		it('selects the previous page when the last one is removed, and nothing when none is left', () => {
			const doc = new DocumentStore(null);
			const a = doc.addPage();
			const b = doc.addPage();
			doc.selectedPageId = b;
			doc.removePage(b);
			expect(doc.selectedPageId).toBe(a);
			doc.removePage(a);
			expect(doc.selectedPageId).toBeNull();
		});

		it('ignores an unknown page', () => {
			const doc = new DocumentStore(null);
			doc.addPage();
			doc.removePage('nope')();
			expect(doc.pageCount).toBe(1);
		});

		it('turns a page: a column of charts becomes a row, and turning back restores it', () => {
			const doc = new DocumentStore(null);
			const id = doc.addPage();
			doc.addChart(chart());
			doc.setFrame(id, chartsOf(doc.pages[0])[0].id, { x: 12, y: 12, w: 133.5, h: 133.5 });
			doc.addChart(chart());
			doc.setFrame(id, chartsOf(doc.pages[0])[1].id, { x: 12, y: 151.5, w: 133.5, h: 133.5 });
			expect(doc.pages[0].manual).toBe(true);

			doc.setOrientation(id, 'landscape');
			const page = doc.pages[0];
			expect(page.orientation).toBe('landscape');
			expect(chartsOf(page).map((item) => item.frame)).toEqual([
				{ x: 12, y: 38.25, w: 133.5, h: 133.5 },
				{ x: 151.5, y: 38.25, w: 133.5, h: 133.5 }
			]);
			// A turn re-flows the page: it is the arranger's again, and remembers the hand layout.
			expect(page.manual).toBeUndefined();
			expect(page.layout).toEqual({ tree: { dir: 'H', kids: [0, 1] }, sizing: 'uniform' });
			expect(page.turnMemo).toMatchObject({ orientation: 'portrait', manual: true });

			doc.setOrientation(id, 'portrait');
			expect(chartsOf(doc.pages[0]).map((item) => item.frame)).toEqual([
				{ x: 12, y: 12, w: 133.5, h: 133.5 },
				{ x: 12, y: 151.5, w: 133.5, h: 133.5 }
			]);
			expect(doc.pages[0].manual).toBe(true);
			expect(doc.pages[0].layout).toBeUndefined();
		});

		it('lays a turned page out afresh once something else changed on it', () => {
			const doc = new DocumentStore(null);
			const { pageId } = doc.addChart(chart());
			doc.addChart(chart());
			doc.setOrientation(pageId, 'landscape');
			expect(doc.pages[0].turnMemo).toBeDefined();
			const [first] = chartsOf(doc.pages[0]);
			doc.removeBlock(pageId, first.id);
			expect(doc.pages[0].turnMemo).toBeUndefined();
			expect(doc.pages[0].layout).toBeUndefined();
			doc.setOrientation(pageId, 'portrait');
			expect(chartsOf(doc.pages[0])[0].frame).toEqual({ x: 12, y: 55.5, w: 186, h: 186 });
		});

		it('turns a page of more than eight charts with rotateLayout, and back', () => {
			const doc = new DocumentStore(null);
			const id = doc.addPage();
			const discs = Array.from({ length: 9 }, (_, i) => ({
				kind: 'chart' as const,
				id: `d${i}`,
				chart: chart(),
				frame: { x: 12 + (i % 3) * 63, y: 12 + Math.floor(i / 3) * 63, w: 57, h: 57 }
			}));
			doc.page(id)!.blocks.push(...discs);
			doc.setOrientation(id, 'landscape');
			const turned = chartsOf(doc.pages[0]).map((it) => it.frame);
			turned.forEach((frame) => expectInside(frame, doc.pages[0]));
			doc.setOrientation(id, 'portrait');
			expect(chartsOf(doc.pages[0]).map((it) => it.frame)).toEqual(discs.map((d) => d.frame));
		});

		it('scales a chart down into a turned page', () => {
			const doc = new DocumentStore(null);
			doc.addChart(chart(186 / 273));
			const page = doc.pages[0];
			expect(chartsOf(page)[0].frame.h).toBeCloseTo(273, 9);
			doc.setOrientation(page.id, 'landscape');
			const { frame } = chartsOf(doc.pages[0])[0];
			expectInside(frame, doc.pages[0]);
			expect(frame.h).toBeCloseTo(186, 9);
			expect(frame.w / frame.h).toBeCloseTo(186 / 273, 9);
		});
	});

	describe('items', () => {
		it('keeps an updated frame inside the page at the chart aspect', () => {
			const doc = new DocumentStore(null);
			doc.addPage();
			const { pageId, blockId } = doc.addChart(chart(2));
			expect(doc.setFrame(pageId, blockId, { x: 150, y: 270, w: 100, h: 10 })).toBe(true);
			const { frame } = chartsOf(doc.pages[0])[0];
			expect(frame).toEqual({ x: 98, y: 235, w: 100, h: 50 });
			expect(doc.setFrame(pageId, 'nope', frame)).toBe(false);
			expect(doc.setFrame('nope', blockId, frame)).toBe(false);
		});

		it('moves a chart onto another page, fitted there', () => {
			const doc = new DocumentStore(null);
			const from = doc.addPage();
			const to = doc.addPage('landscape');
			const { blockId } = doc.addChart(chart());
			expect(chartsOf(doc.pages[0])).toHaveLength(1);

			expect(doc.moveBlock(blockId, to, { x: 200, y: 100, w: 186, h: 186 })).toBe(true);
			expect(chartsOf(doc.page(from)!)).toEqual([]);
			const moved = chartsOf(doc.page(to)!);
			expect(moved.map((item) => item.id)).toEqual([blockId]);
			expect(moved[0].frame).toEqual({ x: 99, y: 12, w: 186, h: 186 });
			expect(moved[0].chart).toEqual(chart());
			// A drop is a hand arrangement of the page it lands on; the page it left is not.
			expect(doc.page(to)!.manual).toBe(true);
			expect(doc.page(from)!.manual).toBeUndefined();
		});

		it('makes a page hand-arranged on a drag, and forgets its layout and turn', () => {
			const doc = new DocumentStore(null);
			const { pageId, blockId } = doc.addChart(chart());
			doc.addChart(chart());
			doc.setOrientation(pageId, 'landscape');
			const page = doc.pages[0];
			expect(page.layout).toBeDefined();
			expect(page.turnMemo).toBeDefined();
			// Putting it where it is changes nothing.
			doc.setFrame(pageId, blockId, { ...chartsOf(page).find((it) => it.id === blockId)!.frame });
			expect(page.manual).toBeUndefined();
			expect(page.layout).toBeDefined();

			doc.setFrame(pageId, blockId, { x: 12, y: 12, w: 90, h: 90 });
			expect(page.manual).toBe(true);
			expect(page.layout).toBeUndefined();
			expect(page.turnMemo).toBeUndefined();
			// Deleting a chart is no hand arrangement.
			const other = doc.addPage();
			doc.addChart(chart());
			doc.removeBlock(other, chartsOf(doc.page(other)!)[0].id);
			expect(doc.page(other)!.manual).toBeUndefined();
		});

		it('moves within a page like an update', () => {
			const doc = new DocumentStore(null);
			const { pageId, blockId } = doc.addChart(chart());
			expect(doc.moveBlock(blockId, pageId, { x: 20, y: 30, w: 90, h: 90 })).toBe(true);
			expect(chartsOf(doc.pages[0])[0].frame).toEqual({ x: 20, y: 30, w: 90, h: 90 });
			expect(doc.moveBlock('nope', pageId, { x: 0, y: 0, w: 90, h: 90 })).toBe(false);
			expect(doc.moveBlock(blockId, 'nope', { x: 0, y: 0, w: 90, h: 90 })).toBe(false);
		});

		it('removes a chart and undoes it at its place, once', () => {
			const doc = new DocumentStore(null);
			const pageId = doc.addPage();
			doc.page(pageId)!.blocks.push(
				...['a', 'b', 'c'].map((id, i) => ({
					kind: 'chart' as const,
					id,
					chart: chart(3),
					frame: { x: 12, y: 12 + i * 68, w: 186, h: 62 }
				}))
			);
			const page = () => doc.pages[0];

			const undo = doc.removeBlock(pageId, 'b');
			expect(chartsOf(page()!).map((i) => i.id)).toEqual(['a', 'c']);
			expect(undo()).toBe(true);
			expect(chartsOf(page()!).map((i) => i.id)).toEqual(['a', 'b', 'c']);
			expect(chartsOf(page()!)[1].frame).toEqual({ x: 12, y: 80, w: 186, h: 62 });
			expect(undo()).toBe(false);
			expect(chartsOf(page()!)).toHaveLength(3);
		});

		it('does not bring a chart back once its page is gone', () => {
			const doc = new DocumentStore(null);
			const { pageId, blockId } = doc.addChart(chart());
			const undo = doc.removeBlock(pageId, blockId);
			doc.removePage(pageId);
			expect(undo()).toBe(false);
			expect(doc.pages).toEqual([]);
			expect(doc.removeBlock(pageId, blockId)).toBeTypeOf('function');
		});
	});

	describe('limits', () => {
		it('matches the backend: 100 pages, 50 charts on a page, 200 in all', () => {
			expect([MAX_PAGES, MAX_ITEMS_PER_PAGE, MAX_CHARTS]).toEqual([100, 50, 200]);
		});

		it('has room for pages up to the limit', () => {
			const doc = new DocumentStore(null);
			for (let i = 0; i < MAX_PAGES - 1; i++) doc.addPage();
			expect(doc.canAddPage).toBe(true);
			doc.addPage();
			expect(doc.canAddPage).toBe(false);
		});

		it('says why a chart cannot be added', () => {
			const doc = new DocumentStore(null);
			expect(doc.addChartBlocker(chart())).toBeNull();
			for (let i = 0; i < MAX_PAGES; i++) doc.addPage();
			// The pages are empty: a chart still fits on one.
			expect(doc.addChartBlocker(chart())).toBeNull();
			for (const page of doc.pages) {
				page.blocks.push(...Array.from({ length: 2 }, (_, i) => fullItem(`${page.id}-${i}`)));
			}
			// 200 charts.
			expect(doc.addChartBlocker(chart())).toBe('charts');
			doc.pages.forEach((page) => page.blocks.splice(1));
			// 100 full pages and no room for a new one.
			expect(doc.addChartBlocker(chart())).toBe('pages');
		});

		it('blocks only the charts that would need a page past the limit', () => {
			const doc = new DocumentStore(null);
			for (let i = 0; i < MAX_PAGES; i++) doc.addPage();
			for (const page of doc.pages) {
				page.blocks.push({
					kind: 'chart',
					id: `${page.id}-d`,
					chart: chart(),
					frame: aloneFrame(1, 'portrait')
				});
			}
			// A 3:1 joins a disc page under its disc; a 2:5 beside one would be too small.
			expect(doc.addChartBlocker(chart(3))).toBeNull();
			expect(doc.addChartBlocker(chart(0.4))).toBe('pages');
		});

		it('moves no chart onto a full page', () => {
			const doc = new DocumentStore(null);
			const { blockId } = doc.addChart(chart());
			const full = doc.addPage();
			doc
				.page(full)!
				.blocks.push(...Array.from({ length: MAX_ITEMS_PER_PAGE }, (_, i) => fullItem(`f-${i}`)));
			expect(doc.moveBlock(blockId, full, { x: 12, y: 12, w: 90, h: 90 })).toBe(false);
			expect(chartsOf(doc.pages[0]).map((it) => it.id)).toEqual([blockId]);
		});

		it('brings no page back past the page limit', () => {
			const doc = new DocumentStore(null);
			const first = doc.addPage();
			const undo = doc.removePage(first);
			for (let i = 0; i < MAX_PAGES; i++) doc.addPage();
			expect(undo()).toBe(false);
			expect(doc.pageCount).toBe(MAX_PAGES);
		});
	});

	describe('storage', () => {
		it('saves after a change and loads it back', () => {
			vi.useFakeTimers();
			const storage = memoryStorage();
			const doc = new DocumentStore(storage);
			doc.addChart(chart(), 'data:image/png;base64,AAAA');
			doc.addPage('landscape');
			expect(storage.writes).toBe(0);
			vi.runAllTimers();
			expect(storage.writes).toBe(1);

			const again = new DocumentStore(storage);
			expect(again.load()).toBe(true);
			expect(again.pages).toEqual(doc.pages);
			expect(saved(storage).pages).toHaveLength(2);
		});

		it('writes once for a burst of changes, and at once on flush', () => {
			vi.useFakeTimers();
			const storage = memoryStorage();
			const doc = new DocumentStore(storage);
			const { pageId, blockId } = doc.addChart(chart());
			for (let x = 12; x < 60; x++) doc.setFrame(pageId, blockId, { x, y: 12, w: 90, h: 90 });
			vi.runAllTimers();
			expect(storage.writes).toBe(1);
			expect(chartsOf(saved(storage).pages[0])[0].frame.x).toBe(59);

			doc.setFrame(pageId, blockId, { x: 20, y: 12, w: 90, h: 90 });
			doc.flush();
			expect(storage.writes).toBe(2);
			expect(chartsOf(saved(storage).pages[0])[0].frame.x).toBe(20);
			vi.runAllTimers();
			expect(storage.writes).toBe(2);
		});

		it('survives a storage that throws', () => {
			const broken: DocumentStorage = {
				getItem: () => {
					throw new Error('SecurityError');
				},
				setItem: () => {
					throw new Error('SecurityError');
				},
				removeItem: () => {
					throw new Error('SecurityError');
				}
			};
			const doc = new DocumentStore(broken);
			expect(doc.load()).toBe(false);
			doc.addChart(chart());
			expect(() => doc.flush()).not.toThrow();
			expect(doc.pageCount).toBe(1);
		});

		it('clears a selection the loaded document does not have', () => {
			const storage = memoryStorage();
			storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify({ pages: [] }));
			const doc = new DocumentStore(storage);
			doc.selectedPageId = 'gone';
			expect(doc.load()).toBe(true);
			expect(doc.selectedPageId).toBeNull();
		});

		it('uses localStorage by default', () => {
			// Stubbed: Node's own half-made localStorage global can shadow jsdom's.
			const storage = memoryStorage();
			vi.stubGlobal('localStorage', storage);
			const doc = new DocumentStore();
			doc.addPage('landscape');
			doc.flush();
			expect(saved(storage).pages.map((p) => p.orientation)).toEqual(['landscape']);
			const again = new DocumentStore();
			expect(again.load()).toBe(true);
			expect(again.pages.map((p) => p.orientation)).toEqual(['landscape']);
		});

		it('works with no localStorage at all', () => {
			vi.stubGlobal('localStorage', undefined);
			const doc = new DocumentStore();
			expect(doc.load()).toBe(false);
			doc.addPage();
			expect(() => doc.flush()).not.toThrow();
		});
	});
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

describe('DocumentStore: tables', () => {
	const style = { ...DEFAULT_TEXT_STYLE };
	const frame = { x: 12, y: 100, w: 186, h: 40 };

	it('keeps a table as a block that is not typed, and changes what it lists', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, {
			kind: 'table',
			style,
			frame,
			table: { source: 'messier', rows: 10 }
		})!;
		const table = () => typesetOf(doc.pages[0])[0];
		expect(table()).toMatchObject({ kind: 'table', table: { source: 'messier', rows: 10 } });
		expect(table()).not.toHaveProperty('text');
		// How it looks is kept with it; a look there is not is the look of names.
		doc.updateTypeset(pageId, id, { table: { source: 'messier', look: 'details', rows: 10 } });
		expect(specOf(table())).toEqual({ source: 'messier', look: 'details', rows: 10 });
		doc.updateTypeset(pageId, id, {
			table: { source: 'messier', look: 'fancy' as never, rows: 10 }
		});
		expect(specOf(table())!.look).toBe('names');
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 25 } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 25 });
		// Rows are whole and within the limits; a source there is not is not taken.
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 900 } });
		expect(specOf(table())!.rows).toBe(40);
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 0 } });
		expect(specOf(table())!.rows).toBe(1);
		doc.updateTypeset(pageId, id, { table: { source: 'comets' as never, rows: 5 } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 1 });
		// Its language is kept when it is Russian; English is none said.
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 5, language: 'ru' } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 5, language: 'ru' });
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 1, language: 'en' } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 1 });
		// A text does not become a table by being told a spec.
		const words = doc.addBlock(pageId, { kind: 'text', text: 'Hello', style, frame })!;
		doc.updateTypeset(pageId, words, { table: { source: 'stars', rows: 5 } });
		expect(typesetOf(doc.pages[0])[1]).not.toHaveProperty('table');
		// Nor is a table typed in by being told words.
		doc.updateTypeset(pageId, id, { text: 'Hello' });
		expect(table()).not.toHaveProperty('text');
	});

	it('saves a table, copies and pastes it, and reads back only what is a table', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, {
			kind: 'table',
			style,
			frame,
			table: { source: 'stars', rows: 7 }
		})!;
		const copy = doc.copyBlock(id)!;
		expect(copy).toEqual({ kind: 'table', table: { source: 'stars', rows: 7 }, style, frame });
		const pasted = doc.pasteBlock(pageId, copy) as { kind: string; id: string };
		expect(pasted.kind).toBe('table');
		expect(specOf(typesetOf(doc.pages[0]).find((text) => text.id === pasted.id)!)).toEqual({
			source: 'stars',
			look: 'names',
			rows: 7
		});
		// A copy made when a table was a text with a spec and no words is still a table.
		const old = { kind: 'text', text: '', style, frame, table: { source: 'messier', rows: 4 } };
		const older = doc.pasteBlock(pageId, old) as { kind: string; id: string };
		expect(older.kind).toBe('table');
		expect(typesetOf(doc.pages[0]).find((text) => text.id === older.id)).toMatchObject({
			kind: 'table',
			table: { source: 'messier', look: 'names', rows: 4 }
		});
		doc.removeBlock(pageId, older.id);
		doc.flush();
		const raw = saved(storage);
		expect(typesetOf(raw.pages[0])[0]).toMatchObject({
			kind: 'table',
			table: { source: 'stars', rows: 7 }
		});
		expect(typesetOf(raw.pages[0])[0]).not.toHaveProperty('text');
		// A table whose spec does not read as one is no block at all; one that nearly does is put right.
		(typesetOf(raw.pages[0])[0] as { table: unknown }).table = { source: 'comets', rows: 7 };
		(typesetOf(raw.pages[0])[1] as { table: unknown }).table = { source: 'messier', rows: 3.4 };
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		const again = new DocumentStore(storage);
		again.load();
		expect(typesetOf(again.pages[0])).toHaveLength(1);
		expect(specOf(typesetOf(again.pages[0])[0])).toEqual({
			source: 'messier',
			look: 'names',
			rows: 3
		});
		// Saved in the first shape, where a table was a text with a spec, the same two read
		// back as they did then: the one with no table's spec as a text, the other as a table.
		const text = (id: string, table: unknown) => ({ id, text: '', style, frame, table });
		const first = {
			pages: [
				{
					id: 'p',
					orientation: 'portrait',
					items: [],
					texts: [
						text('a', { source: 'comets', rows: 7 }),
						text('b', { source: 'messier', rows: 3.4 })
					]
				}
			]
		};
		storage.data.delete(DOCUMENT_STORAGE_KEY);
		storage.data.set(FIRST_SHAPE_STORAGE_KEY, JSON.stringify(first));
		const before = new DocumentStore(storage);
		before.load();
		expect(typesetOf(before.pages[0])[0]).toMatchObject({ kind: 'text', text: '' });
		expect(typesetOf(before.pages[0])[0]).not.toHaveProperty('table');
		expect(typesetOf(before.pages[0])[1]).not.toHaveProperty('text');
		expect(specOf(typesetOf(before.pages[0])[1])).toEqual({
			source: 'messier',
			look: 'names',
			rows: 3
		});
	});
});

describe('DocumentStore: copy and paste', () => {
	const style = { ...DEFAULT_TEXT_STYLE };

	it('pastes a copied chart where it was when that is free, else clear of everything', () => {
		const doc = new DocumentStore(null);
		const first = doc.addPage();
		const second = doc.addPage();
		doc.addChart(chart());
		const [page, other] = doc.pages;
		expect(page.id).toBe(first);
		doc.setFrame(first, chartsOf(page)[0].id, { x: 12, y: 12, w: 90, h: 90 });
		const copy = doc.copyBlock(chartsOf(page)[0].id)!;
		expect(copy).toEqual({ kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } });

		// On another page its place is free.
		const there = doc.pasteBlock(second, copy);
		expect(there).toMatchObject({ kind: 'chart' });
		expect(chartsOf(other)).toHaveLength(1);
		expect(chartsOf(other)[0].frame).toEqual({ x: 12, y: 12, w: 90, h: 90 });
		expect(chartsOf(other)[0].id).not.toBe(chartsOf(page)[0].id);
		expect(other.manual).toBe(true);

		// On its own page the original is in it: the copy goes in the nearest free place, under
		// it and a gutter clear (as near as the place beside it, and lower wins).
		const here = doc.pasteBlock(first, copy) as { id: string };
		expect(chartsOf(page)).toHaveLength(2);
		const pasted = chartsOf(page).find((it) => it.id === here.id)!;
		expect(pasted.frame).toEqual({ x: 12, y: 108, w: 90, h: 90 });
		expect(doc.chartCount).toBe(3);
		// The copy is its own chart: changing one leaves the other.
		expect(pasted.chart).not.toBe(chartsOf(page)[0].chart);
	});

	it('pastes a copied text a little off the one in its place, turn and style kept', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, {
			kind: 'text',
			text: 'Key {lat}',
			style: { ...style, bold: true },
			frame: { x: 40, y: 100, w: 100, h: 6 },
			rotation: 180,
			chartId: 'chart-a'
		})!;
		const copy = doc.copyBlock(id)!;
		expect(copy).toEqual({
			kind: 'text',
			text: 'Key {lat}',
			style: { ...style, bold: true },
			frame: { x: 40, y: 100, w: 100, h: 6 },
			rotation: 180
		});
		const first = doc.pasteBlock(pageId, copy) as { id: string };
		const second = doc.pasteBlock(pageId, copy) as { id: string };
		const texts = typesetOf(doc.pages[0]);
		expect(texts.map((it) => it.id)).toEqual([id, first.id, second.id]);
		// Each in the free place nearest to the original: under it, then over it.
		expect(texts.map((it) => [it.frame.x, it.frame.y])).toEqual([
			[40, 100],
			[40, 112],
			[40, 88]
		]);
		expect(texts[1]).toMatchObject({ text: 'Key {lat}', rotation: 180, style: { bold: true } });
		// It reads the chart nearest to where it lands, not the one its original was told.
		expect(texts[1]).not.toHaveProperty('chartId');
		// An upright copy carries no turn.
		const plain = doc.copyBlock(
			doc.addBlock(pageId, { kind: 'text', text: 'x', style, frame: copy.frame })!
		)!;
		expect(plain).not.toHaveProperty('rotation');
	});

	it('keeps the size of a copy; with no room it goes over what is there, under the pointer', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const big = { kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 186, h: 186 } };
		expect(doc.pasteBlock(pageId, big)).toMatchObject({ kind: 'chart' });
		const [page] = doc.pages;
		// 81 mm are left under it: no place for another 186 mm disc, which is not made smaller.
		doc.pasteBlock(pageId, big, { x: 150, y: 250 });
		expect(chartsOf(page)[1].frame).toEqual({ x: 12, y: 99, w: 186, h: 186 });
		// In the middle of the page it is centred on the pointer.
		const small = { kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 60, h: 60 } };
		for (const it of chartsOf(page)) it.frame = { x: 12, y: 12, w: 186, h: 273 };
		doc.pasteBlock(pageId, small, { x: 100, y: 150 });
		expect(chartsOf(page)[2].frame).toEqual({ x: 70, y: 120, w: 60, h: 60 });
		// With no pointer over the page it stands off what is exactly in its place.
		doc.pasteBlock(pageId, small);
		expect(chartsOf(page)[3].frame).toEqual({ x: 17, y: 17, w: 60, h: 60 });

		// A text likewise: at its own width, its middle under the pointer.
		const words = { kind: 'text', text: 'x', style, frame: { x: 12, y: 12, w: 80, h: 6 } };
		doc.pasteBlock(pageId, words, { x: 105, y: 200 });
		expect(typesetOf(page)[0].frame).toEqual({ x: 65, y: 197, w: 80, h: 6 });
		// A copy from a larger page is only as much smaller as this page makes it.
		const wide = { kind: 'text', text: 'x', style, frame: { x: 12, y: 12, w: 273, h: 6 } };
		const other = doc.addPage();
		doc.pasteBlock(other, wide);
		expect(typesetOf(doc.pages[1])[0].frame).toEqual({ x: 12, y: 12, w: 186, h: 6 });
	});

	it('pastes nothing past the limits, and nothing that is no copy', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const text = { kind: 'text', text: 'x', style, frame: { x: 12, y: 12, w: 80, h: 6 } };
		for (let i = 0; i < MAX_TEXTS_PER_PAGE; i++)
			expect(doc.pasteBlock(pageId, text)).not.toBe('full');
		expect(doc.pasteBlock(pageId, text)).toBe('full');
		const item = { kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 40, h: 40 } };
		expect(doc.pasteBlock(pageId, item)).toMatchObject({ kind: 'chart' });
		// The page filled by hand: finding fifty free places is not what is tested here.
		for (let i = 1; i < MAX_ITEMS_PER_PAGE; i++) {
			doc.pages[0].blocks.push({
				kind: 'chart',
				id: `filler-${i}`,
				chart: chart(),
				frame: item.frame
			});
		}
		expect(doc.pasteBlock(pageId, item)).toBe('full');

		for (const bad of [
			null,
			'text',
			{ kind: 'table', frame: text.frame },
			{ ...text, frame: null },
			{ ...text, style: { ...style, font: 'comic' } },
			{ ...text, text: 7 },
			{ ...item, chart: { view: {} } }
		]) {
			expect(doc.pasteBlock(doc.addPage(), bad), JSON.stringify(bad)).toBeNull();
		}
		expect(doc.pasteBlock('nowhere', text)).toBeNull();
		expect(doc.copyBlock('gone')).toBeNull();
	});
});

describe('DocumentStore: templates', () => {
	/** A plain copy, to compare with later. */
	const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

	const style = { ...DEFAULT_TEXT_STYLE };

	/** A page with a disc and a frame, a text of its owner's and a title an earlier template left. */
	function mixed() {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const page = doc.pages[0];
		page.blocks.push(
			{
				kind: 'chart',
				id: 'disc',
				chart: chart(),
				frame: { x: 12, y: 12, w: 90, h: 90 },
				thumb: 'data:image/png;base64,AA'
			},
			{ kind: 'chart', id: 'frame', chart: chart(1.6), frame: { x: 108, y: 12, w: 90, h: 56.25 } }
		);
		const own = doc.addBlock(pageId, {
			kind: 'text',
			text: 'Mine',
			style,
			frame: { x: 12, y: 250, w: 80, h: 6 }
		})!;
		doc.addBlock(pageId, {
			kind: 'text',
			text: 'Сборная Москвы',
			style,
			frame: { x: 12, y: 270, w: 80, h: 6 },
			role: 'title'
		});
		doc.addPage('landscape');
		return { doc, pageId, own };
	}

	it('lays a page out as a template says: its charts placed, its text put there', () => {
		const { doc, pageId, own } = mixed();
		const laid = layTemplate('pair', doc.pages[0]);
		const undo = doc.layPage(pageId, laid);
		expect(undo).not.toBeNull();
		expect(doc.pageCount).toBe(2);
		const [page] = doc.pages;
		expect(page.id).toBe(pageId);
		expect(chartsOf(page).map((it) => [it.id, it.frame])).toEqual(
			laid[0].charts.map((placed) => [placed.id, placed.frame])
		);
		// The charts are the same charts: nothing of them is lost on the way.
		expect(chartsOf(page)[0]).toMatchObject({ id: 'disc', thumb: 'data:image/png;base64,AA' });
		// The owner's text stays where it was; the old title goes, its words kept by the new one.
		expect(typesetOf(page).map((text) => [text.role, wordsOf(text)])).toEqual([
			[undefined, 'Mine'],
			['title', 'Сборная Москвы'],
			['caption', 'Latitude {lat} · sidereal time {lst}'],
			['caption', 'Centre {ra}, {dec} · field {fov}']
		]);
		expect(typesetOf(page)[0]).toMatchObject({ id: own, frame: { x: 12, y: 250, w: 80, h: 6 } });
		expect(new Set(typesetOf(page).map((text) => text.id)).size).toBe(4);
		expect(typesetOf(page)[2].chartId).toBe('disc');
		expect(page.manual).toBe(true);
		expect(page.layout).toBeUndefined();
	});

	it("puts the charts past a page's places on new pages after it, and Undo takes them back", () => {
		const { doc, pageId } = mixed();
		const before = plain(doc.pages[0]);
		const undo = doc.layPage(
			pageId,
			layTemplate('caption', doc.pages[0], { orientation: 'landscape' })
		)!;
		expect(doc.pageCount).toBe(3);
		expect(doc.pages.map((page) => chartsOf(page).map((it) => it.id))).toEqual([
			['disc'],
			['frame'],
			[]
		]);
		expect(doc.pages.map((page) => page.orientation)).toEqual([
			'landscape',
			'landscape',
			'landscape'
		]);
		// The owner's text is on the first only; each has its title and caption.
		expect(typesetOf(doc.pages[0]).map((text) => text.role)).toEqual([
			undefined,
			'title',
			'caption'
		]);
		expect(typesetOf(doc.pages[1]).map((text) => text.role)).toEqual(['title', 'caption']);
		expect(doc.chartCount).toBe(2);
		for (const page of doc.pages.slice(0, 2)) {
			for (const item of chartsOf(page)) expectInside(item.frame, page);
		}

		expect(undo()).toBe(true);
		expect(doc.pageCount).toBe(2);
		expect(plain(doc.pages[0])).toEqual(before);
		expect(undo()).toBe(false);
	});

	it('leaves a page of charts alone to the arranger again', () => {
		const { doc, pageId, own } = mixed();
		doc.removeBlock(pageId, own);
		doc.layPage(pageId, layTemplate('charts', doc.pages[0]));
		const [page] = doc.pages;
		expect(typesetOf(page)).toEqual([]);
		expect(page.manual).toBeUndefined();
		expect(page.layout).toBeDefined();
		// With the owner's text still on it, the page stays hand-arranged.
		const kept = mixed();
		kept.doc.layPage(kept.pageId, layTemplate('charts', kept.doc.pages[0]));
		expect(typesetOf(kept.doc.pages[0]).map((text) => wordsOf(text))).toEqual(['Mine']);
		expect(kept.doc.pages[0].manual).toBe(true);
	});

	it('does nothing with a layout that is not of this page, or past the page limit', () => {
		const { doc, pageId } = mixed();
		const laid = layTemplate('caption', doc.pages[0]);
		const before = plain(doc.pages);
		expect(doc.layPage('nowhere', laid)).toBeNull();
		expect(doc.layPage(pageId, [])).toBeNull();
		expect(doc.layPage(pageId, [laid[0]])).toBeNull();
		expect(doc.layPage(pageId, [laid[0], laid[0]])).toBeNull();
		const stranger = { ...laid[1], charts: [{ id: 'other', frame: laid[1].charts[0].frame }] };
		expect(doc.layPage(pageId, [laid[0], stranger])).toBeNull();
		while (doc.canAddPage) doc.addPage();
		expect(doc.layPage(pageId, laid)).toBeNull();
		expect(plain(doc.pages.slice(0, 2))).toEqual(before);
		// One page for one page needs no room.
		expect(doc.layPage(pageId, layTemplate('pair', doc.pages[0]))).not.toBeNull();
	});

	it('adds the close-up a finder card makes, rings the sky, and replaces it the next time', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const [page] = doc.pages;
		page.blocks.push({
			kind: 'chart',
			id: 'sky',
			chart: chart(),
			frame: { x: 12, y: 55.5, w: 186, h: 186 }
		});
		const pleiades = { name: 'M 45 · Pleiades', raDeg: 56.85, decDeg: 24.12, fovDeg: 20 };
		const undo = doc.layPage(pageId, layTemplate('finder', page, { closeUp: pleiades }))!;
		expect(doc.pageCount).toBe(1);
		expect(doc.chartCount).toBe(2);
		const card = doc.pages[0];
		const [sky, close] = chartsOf(card);
		expect(sky.id).toBe('sky');
		expect(sky.chart.marks).toEqual([{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }]);
		// The close-up is a chart like any other, with an id of its own, known as this sky's.
		expect(close.id).not.toBe('close-up-of-sky');
		expect(close).toMatchObject({ closeUpOf: 'sky', chart: { aspect: 1.5 } });
		expect(close.chart.view).toMatchObject({ projection: 'pinhole', pinholeFovDeg: 20 });
		expect(close.chart.marks).toBeUndefined();
		expectInside(close.frame, card);
		// Its caption reads it, by the id it was given.
		expect(typesetOf(card).map((text) => [wordsOf(text), text.chartId])).toEqual([
			['Finder card', undefined],
			['Latitude {lat} · sidereal time {lst}', 'sky'],
			['M 45 · Pleiades · field {fov}', close.id]
		]);

		// Another object: the old close-up goes, the ring moves, nothing piles up.
		const andromeda = { name: 'M 31 · Andromeda Galaxy', raDeg: 10.68, decDeg: 41.27, fovDeg: 40 };
		const laid = layTemplate('finder', doc.pages[0], { closeUp: andromeda });
		expect(laid[0].dropped).toEqual([close.id]);
		expect(doc.layPage(pageId, laid)).not.toBeNull();
		expect(doc.chartCount).toBe(2);
		expect(chartsOf(doc.pages[0])[0].chart.marks).toEqual([
			{ raDeg: 10.68, decDeg: 41.27, radiusDeg: 20 }
		]);
		expect(chartsOf(doc.pages[0])[1].chart.view.pinholeFovDeg).toBe(40);
		expect(chartsOf(doc.pages[0])[1].id).not.toBe(close.id);
		expect(typesetOf(doc.pages[0]).map((text) => text.role)).toEqual([
			'title',
			'caption',
			'caption'
		]);

		// Laid out as anything else, the ring goes; the close-up stays, a chart of the page.
		doc.layPage(pageId, layTemplate('charts', doc.pages[0]));
		expect(chartsOf(doc.pages[0]).every((item) => item.chart.marks === undefined)).toBe(true);
		expect(chartsOf(doc.pages[0])).toHaveLength(2);

		// The first Undo is of the first card: it no longer applies to what the page is now...
		// but it does put the page back as it was before it, which is what it promises.
		expect(undo()).toBe(true);
		expect(chartsOf(doc.pages[0]).map((item) => item.id)).toEqual(['sky']);
		expect(chartsOf(doc.pages[0])[0].chart.marks).toBeUndefined();
	});

	it('makes no close-up past the chart limit, and reads marks and close-ups back from a save', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		doc.pages[0].blocks.push({
			kind: 'chart',
			id: 'sky',
			chart: chart(),
			frame: { x: 12, y: 12, w: 90, h: 90 }
		});
		const closeUp = { name: 'M 45', raDeg: 56.85, decDeg: 24.12, fovDeg: 20 };
		doc.layPage(pageId, layTemplate('finder', doc.pages[0], { closeUp }));
		doc.flush();
		const again = new DocumentStore(storage);
		again.load();
		expect(chartsOf(again.pages[0])[0].chart.marks).toEqual([
			{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }
		]);
		expect(chartsOf(again.pages[0])[1].closeUpOf).toBe('sky');
		// A mark that is no place on the sky is not read.
		const raw = saved(storage);
		(chartsOf(raw.pages[0])[0].chart as { marks: unknown }).marks = [
			{ raDeg: 1, decDeg: 2, radiusDeg: 3 },
			{ raDeg: 'east', decDeg: 2, radiusDeg: 3 },
			{ raDeg: 1, decDeg: 95, radiusDeg: 3 },
			{ raDeg: 1, decDeg: 2, radiusDeg: 0 },
			null
		];
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		const odd = new DocumentStore(storage);
		odd.load();
		expect(chartsOf(odd.pages[0])[0].chart.marks).toEqual([{ raDeg: 1, decDeg: 2, radiusDeg: 3 }]);

		// A document full of charts takes no close-up.
		const full = new DocumentStore(null);
		const first = full.addPage();
		full.pages[0].blocks.push({
			kind: 'chart',
			id: 'sky',
			chart: chart(),
			frame: { x: 12, y: 12, w: 90, h: 90 }
		});
		for (let p = 0; full.chartCount < MAX_CHARTS; p++) {
			full.addPage();
			const filler = full.pages[full.pages.length - 1];
			while (chartsOf(filler).length < MAX_ITEMS_PER_PAGE && full.chartCount < MAX_CHARTS) {
				filler.blocks.push({
					kind: 'chart',
					id: `f-${p}-${chartsOf(filler).length}`,
					chart: chart(),
					frame: { x: 12, y: 12, w: 40, h: 40 }
				});
			}
		}
		expect(full.layPage(first, layTemplate('finder', full.pages[0], { closeUp }))).toBeNull();
		expect(full.layPage(first, layTemplate('finder', full.pages[0]))).not.toBeNull();
	});

	it('does not undo once a page it made is gone', () => {
		const { doc, pageId } = mixed();
		const undo = doc.layPage(pageId, layTemplate('caption', doc.pages[0]))!;
		doc.removePage(doc.pages[1].id);
		expect(undo()).toBe(false);
	});

	it('remembers on each page the template that made it, and nothing for charts alone', () => {
		const { doc, pageId } = mixed();
		expect(doc.pages[0].template).toBeUndefined();
		const undo = doc.layPage(pageId, layTemplate('caption', doc.pages[0], { language: 'ru' }))!;
		expect(doc.pages.map((page) => page.template)).toEqual([
			{ id: 'caption', language: 'ru' },
			{ id: 'caption', language: 'ru' },
			undefined
		]);
		// Laid out as another, it is that one's; as charts alone, the arranger's, and no template's.
		doc.layPage(pageId, layTemplate('sheet', doc.pages[0]));
		expect(doc.pages[0].template).toEqual({ id: 'sheet', language: 'en' });
		const back = doc.layPage(pageId, layTemplate('charts', doc.pages[0]))!;
		expect(doc.pages[0].template).toBeUndefined();
		// An Undo puts the page back with what it remembered.
		expect(back()).toBe(true);
		expect(doc.pages[0].template).toEqual({ id: 'sheet', language: 'en' });
		expect(undo()).toBe(true);
		expect(doc.pages[0].template).toBeUndefined();
	});

	/** What a template placed on a page: its charts, and its texts by part. */
	const placed = (page: DocPage) => ({
		orientation: page.orientation,
		charts: chartsOf(page).map((item) => [item.id, item.frame]),
		texts: typesetOf(page)
			.filter((text) => text.role !== undefined)
			.map((text) => ({
				role: text.role,
				chartId: text.chartId,
				text: wordsOf(text),
				style: text.style,
				frame: text.frame,
				rotation: text.rotation
			}))
	});

	/** The page is `before` again; the owner's own texts, moved there and back, to a hair. */
	function expectBack(page: DocPage, before: DocPage) {
		const own = (it: DocPage) => typesetOf(it).filter((text) => text.role === undefined);
		const rest = (it: DocPage) => ({
			...plain(it),
			texts: plain(typesetOf(it)).map((text) => (text.role === undefined ? text.id : text))
		});
		expect(rest(page)).toEqual(rest(before));
		own(page).forEach((text, i) => {
			const was = own(before)[i];
			expect({ ...plain(text), frame: null }).toEqual({ ...was, frame: null });
			for (const side of ['x', 'y', 'w', 'h'] as const) {
				expect(text.frame[side]).toBeCloseTo(was.frame[side], 9);
			}
		});
	}

	it('turns a page as its template lays it out the other way, and back to the page it was', () => {
		const { doc, pageId, own } = mixed();
		doc.layPage(pageId, layTemplate('pair', doc.pages[0]));
		const [page] = doc.pages;
		const before = plain(page);
		// Stacked on a portrait page, each under the other's caption.
		expect(chartsOf(page)[1].frame.y).toBeGreaterThan(
			chartsOf(page)[0].frame.y + chartsOf(page)[0].frame.h
		);

		doc.setOrientation(pageId, 'landscape');
		// The page is what the template makes of these charts on a landscape page to begin with.
		const direct = mixed();
		direct.doc.layPage(
			direct.pageId,
			layTemplate('pair', direct.doc.pages[0], { orientation: 'landscape' })
		);
		expect(placed(page)).toEqual(placed(direct.doc.pages[0]));
		// Side by side under a title the width of the page, a caption under each.
		const [disc, frame] = chartsOf(page);
		expect(frame.frame.x).toBeGreaterThan(disc.frame.x + disc.frame.w);
		const [, title, first, second] = typesetOf(page);
		expect(title).toMatchObject({ role: 'title', text: 'Сборная Москвы' });
		expect(title.frame).toMatchObject({ x: 12, y: 12, w: 273 });
		expect(first.frame.y).toBeCloseTo(disc.frame.y + disc.frame.h + 2.5);
		expect(second.frame.y).toBeCloseTo(frame.frame.y + frame.frame.h + 2.5);
		for (const item of chartsOf(page)) expectInside(item.frame, page);
		// Not the arranger's turn of the same charts, which knows nothing of the text.
		const arranged = mixed();
		arranged.doc.layPage(arranged.pageId, layTemplate('pair', arranged.doc.pages[0]));
		delete arranged.doc.pages[0].template;
		arranged.doc.setOrientation(arranged.pageId, 'landscape');
		expect(placed(arranged.doc.pages[0]).charts).not.toEqual(placed(page).charts);

		// The texts are the same texts, the charts the same charts.
		expect(typesetOf(page).map((text) => text.id)).toEqual(
			typesetOf(before).map((text) => text.id)
		);
		expect(chartsOf(page)[0]).toMatchObject({ id: 'disc', thumb: 'data:image/png;base64,AA' });
		// The owner's own text keeps its place in the content box, as on any turn.
		const mine = typesetOf(page).find((text) => text.id === own)!;
		expect(mine.frame.x).toBeCloseTo(12);
		expect(mine.frame.w).toBeCloseTo((80 * 273) / 186);
		// Still that template's page, hand-arranged as any page with text, with no memo to keep.
		expect(page.template).toEqual({ id: 'pair', language: 'en' });
		expect(page.manual).toBe(true);
		expect(page.layout).toBeUndefined();
		expect(page.turnMemo).toBeUndefined();

		doc.setOrientation(pageId, 'portrait');
		expectBack(doc.pages[0], before);
		// And round again, to the same landscape page.
		doc.setOrientation(pageId, 'landscape');
		expect(placed(doc.pages[0])).toEqual(placed(direct.doc.pages[0]));
	});

	it('turns every template’s page to what the template makes of it, and back', () => {
		const pleiades = { name: 'M 45 · Pleiades', raDeg: 56.85, decDeg: 24.12, fovDeg: 20 };
		for (const id of ['caption', 'pair', 'finder', 'sheet'] as const) {
			for (const first of ['portrait', 'landscape'] as const) {
				const other = first === 'portrait' ? 'landscape' : 'portrait';
				const lay = (orientation: 'portrait' | 'landscape') => {
					const made = mixed();
					const options = { orientation, closeUp: pleiades, swap: true, language: 'ru' as const };
					made.doc.layPage(made.pageId, layTemplate(id, made.doc.pages[0], options));
					return made.doc;
				};
				const doc = lay(first);
				const direct = lay(other);
				// Every page it made, the ones after the first too.
				const made = doc.pages.filter((page) => page.template);
				expect(made.length, id).toBeGreaterThan(0);
				for (const [i, page] of made.entries()) {
					const where = `${id} ${first} page ${i + 1}`;
					const before = plain(page);
					doc.setOrientation(page.id, other);
					expect(page.template, where).toEqual(before.template);
					// A made close-up has an id of its own in each document: by place, then.
					const byPlace = (it: DocPage) => {
						const ids = chartsOf(it).map((item) => item.id);
						const at = (chartId: string | undefined) => (chartId ? ids.indexOf(chartId) : -1);
						const { charts, texts, orientation } = placed(it);
						return {
							orientation,
							charts: charts.map(([, frame]) => frame),
							texts: texts.map((text) => ({ ...text, chartId: at(text.chartId) }))
						};
					};
					expect(byPlace(page), where).toEqual(byPlace(direct.pages[i]));
					doc.setOrientation(page.id, first);
					expectBack(page, before);
				}
				expect(doc.pageCount, id).toBe(direct.pageCount);
			}
		}
	});

	it('turns a finder card with the close-up it has and the ring on its sky', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		doc.pages[0].blocks.push({
			kind: 'chart',
			id: 'sky',
			chart: chart(),
			frame: { x: 12, y: 55.5, w: 186, h: 186 }
		});
		const pleiades = { name: 'M 45 · Pleiades', raDeg: 56.85, decDeg: 24.12, fovDeg: 20 };
		doc.layPage(pageId, layTemplate('finder', doc.pages[0], { closeUp: pleiades }));
		const [page] = doc.pages;
		const before = plain(page);
		const [, closeUp] = chartsOf(before);
		expect(page.template).toEqual({ id: 'finder', language: 'en' });

		doc.setOrientation(pageId, 'landscape');
		// One page still, the same two charts: no new close-up, none sent to a page of its own.
		expect(doc.pageCount).toBe(1);
		expect(doc.chartCount).toBe(2);
		expect(chartsOf(page).map((item) => item.id)).toEqual(['sky', closeUp.id]);
		expect(plain(chartsOf(page)[1].chart)).toEqual(closeUp.chart);
		expect(chartsOf(page)[1].closeUpOf).toBe('sky');
		expect(chartsOf(page)[0].chart.marks).toEqual([{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }]);
		expect(chartsOf(page)[1].chart.marks).toBeUndefined();
		// The sky on the left now, the close-up beside it, each over its own caption.
		const [sky, close] = chartsOf(page);
		expect(close.frame.x).toBeGreaterThan(sky.frame.x + sky.frame.w);
		expect(sky.frame.w).toBeGreaterThan(close.frame.w);
		expect(typesetOf(page).map((text) => [text.role, wordsOf(text), text.chartId])).toEqual([
			['title', 'Finder card', undefined],
			['caption', 'Latitude {lat} · sidereal time {lst}', 'sky'],
			['caption', 'M 45 · Pleiades · field {fov}', closeUp.id]
		]);
		expect(typesetOf(page)[2].frame.y).toBeCloseTo(close.frame.y + close.frame.h + 2.5);
		expect(page.template).toEqual({ id: 'finder', language: 'en' });

		doc.setOrientation(pageId, 'portrait');
		expectBack(page, before);
	});

	it('keeps what a text says and how it is set through a turn, a sheet’s number too', () => {
		const { doc, pageId } = mixed();
		doc.layPage(pageId, layTemplate('sheet', doc.pages[0], { language: 'ru' }));
		const second = doc.pages[1];
		const [header, number, tasks, stars, messier, key] = typesetOf(second);
		expect(wordsOf(number)).toBe('№ 2');
		doc.updateTypeset(second.id, tasks.id, { text: 'Найдите Вегу.\nНайдите Денеб.' });
		doc.updateTypeset(second.id, header.id, { style: { ...header.style, size: 20 } });
		expect(second.template).toEqual({ id: 'sheet', language: 'ru' });

		doc.setOrientation(second.id, 'landscape');
		expect(typesetOf(second).map((text) => [text.id, wordsOf(text)])).toEqual([
			[header.id, 'Фамилия, имя ______________________   Класс ________'],
			[number.id, '№ 2'],
			[tasks.id, 'Найдите Вегу.\nНайдите Денеб.'],
			[stars.id, undefined],
			[messier.id, undefined],
			[key.id, '{ra} {dec}']
		]);
		expect(typesetOf(second)[0].style.size).toBe(20);
		// The number in the top right corner of the turned page, the key upside down at its foot.
		const box = contentBox('landscape');
		expect(typesetOf(second)[1].frame.x + typesetOf(second)[1].frame.w).toBeCloseTo(box.x + box.w);
		expect(typesetOf(second)[5].rotation).toBe(180);
		expect(typesetOf(second)[5].frame.y + typesetOf(second)[5].frame.h).toBeCloseTo(box.y + box.h);
		// The chart under both lines of the tasks, and over the key.
		const { frame } = chartsOf(second)[0];
		const under = typesetOf(second)[2].frame;
		expect(frame.y).toBeGreaterThanOrEqual(under.y + under.h + GUTTER_MM - 1e-6);
		expect(under.h).toBeCloseTo(2 * typesetOf(second)[2].style.size * (25.4 / 72) * 1.35);
		expect(frame.y + frame.h).toBeLessThan(typesetOf(second)[5].frame.y);
	});

	it('gives a templated page’s text the room its measure says, when a turn brings one', () => {
		const lay = () => {
			const made = mixed();
			made.doc.layPage(made.pageId, layTemplate('pair', made.doc.pages[0]));
			return made;
		};
		const plainly = lay();
		plainly.doc.setOrientation(plainly.pageId, 'landscape');
		const measured = lay();
		// Every text as tall as its size in mm: taller than a line of it.
		measured.doc.setOrientation(measured.pageId, 'landscape', (_text, style) => style.size);
		const title = (doc: DocumentStore) =>
			typesetOf(doc.pages[0]).find((text) => text.role === 'title')!;
		expect(title(measured.doc).frame.h).toBe(title(measured.doc).style.size);
		expect(title(measured.doc).frame.h).toBeGreaterThan(title(plainly.doc).frame.h);
		expect(chartsOf(measured.doc.pages[0])[0].frame.y).toBeGreaterThan(
			chartsOf(plainly.doc.pages[0])[0].frame.y
		);
	});

	it('forgets the template once a chart or a text is added, removed or moved by hand', () => {
		const style2 = { ...style, bold: true };
		/** A wide frame under a title and over its caption; a second page with a disc and a text. */
		const templated = () => {
			const doc = new DocumentStore(null);
			const pageId = doc.addPage();
			doc.pages[0].blocks.push({
				kind: 'chart',
				id: 'frame',
				chart: chart(1.6),
				frame: { x: 12, y: 12, w: 90, h: 56.25 }
			});
			doc.layPage(pageId, layTemplate('caption', doc.pages[0]));
			const otherId = doc.addPage();
			doc.pages[1].blocks.push({
				kind: 'chart',
				id: 'other',
				chart: chart(),
				frame: { x: 12, y: 12, w: 60, h: 60 }
			});
			const elsewhere = doc.addBlock(otherId, {
				kind: 'text',
				text: 'Elsewhere',
				style,
				frame: { x: 12, y: 200, w: 80, h: 6 }
			})!;
			const [title, caption] = typesetOf(doc.pages[0]);
			return { doc, pageId, otherId, elsewhere, title, caption, item: chartsOf(doc.pages[0])[0] };
		};
		type Made = ReturnType<typeof templated>;
		const free = { x: 12, y: 180, w: 60, h: 60 };
		const forgets: Record<string, (made: Made) => unknown> = {
			'a chart moved': ({ doc, pageId, item }) =>
				doc.setFrame(pageId, 'frame', { ...item.frame, y: item.frame.y + 10 }),
			'a chart resized': ({ doc, pageId, item }) =>
				doc.setFrame(pageId, 'frame', { ...item.frame, w: 100, h: 62.5 }),
			'a chart moved away': ({ doc, otherId }) =>
				expect(doc.moveBlock('frame', otherId, free)).toBe(true),
			'a chart moved in': ({ doc, pageId }) =>
				expect(doc.moveBlock('other', pageId, free)).toBe(true),
			'a chart removed': ({ doc, pageId }) => doc.removeBlock(pageId, 'frame'),
			'a chart removed and put back': ({ doc, pageId }) => doc.removeBlock(pageId, 'frame')(),
			'a text added': ({ doc, pageId }) =>
				doc.addBlock(pageId, {
					kind: 'text',
					text: 'New',
					style,
					frame: { x: 12, y: 200, w: 80, h: 6 }
				}),
			'a text moved': ({ doc, pageId, title }) =>
				doc.updateTypeset(pageId, title.id, { frame: { ...title.frame, y: title.frame.y + 20 } }),
			'a text made narrower': ({ doc, pageId, title }) =>
				doc.updateTypeset(pageId, title.id, { frame: { ...title.frame, w: 100 } }),
			'a text turned': ({ doc, pageId, caption }) =>
				doc.updateTypeset(pageId, caption.id, { rotation: 90 }),
			'a text moved within the page': ({ doc, pageId, caption }) =>
				doc.moveBlock(caption.id, pageId, { ...caption.frame, y: 250 }),
			'a text moved away': ({ doc, otherId, caption }) =>
				expect(doc.moveBlock(caption.id, otherId, caption.frame)).toBe(true),
			'a text moved in': ({ doc, pageId, elsewhere }) =>
				expect(doc.moveBlock(elsewhere, pageId, { x: 12, y: 250, w: 80, h: 6 })).toBe(true),
			'a text removed': ({ doc, pageId, caption }) => doc.removeBlock(pageId, caption.id),
			'a text removed and put back': ({ doc, pageId, caption }) =>
				doc.removeBlock(pageId, caption.id)(),
			'a chart pasted': ({ doc, pageId }) =>
				expect(doc.pasteBlock(pageId, doc.copyBlock('other'))).toMatchObject({ kind: 'chart' }),
			'a text pasted': ({ doc, pageId, elsewhere }) =>
				expect(doc.pasteBlock(pageId, doc.copyBlock(elsewhere))).toMatchObject({ kind: 'text' })
		};
		for (const [what, act] of Object.entries(forgets)) {
			const made = templated();
			expect(made.doc.pages[0].template, what).toEqual({ id: 'caption', language: 'en' });
			act(made);
			expect(made.doc.pages[0].template, what).toBeUndefined();
			// The page it came from or went to never had one to forget.
			expect(made.doc.pages[1]?.template, what).toBeUndefined();
		}

		const keeps: Record<string, (made: Made) => unknown> = {
			'a text typed in': ({ doc, pageId, title }) =>
				doc.updateTypeset(pageId, title.id, { text: 'Orion in winter' }),
			'a text set in another face': ({ doc, pageId, title }) =>
				doc.updateTypeset(pageId, title.id, { style: style2 }),
			'a text told its chart': ({ doc, pageId, caption }) =>
				doc.updateTypeset(pageId, caption.id, { chartId: null }),
			'a text’s height followed': ({ doc, pageId, title }) =>
				doc.setTextHeight(pageId, title.id, 14),
			'a text put where it is': ({ doc, pageId, title }) =>
				doc.updateTypeset(pageId, title.id, { frame: { ...title.frame }, rotation: 0 }),
			'a chart put where it is': ({ doc, pageId, item }) =>
				doc.setFrame(pageId, 'frame', { ...item.frame }),
			'a text copied': ({ doc, title }) => doc.copyBlock(title.id),
			'a change on another page': ({ doc, otherId }) =>
				doc.setFrame(otherId, 'other', { x: 40, y: 40, w: 60, h: 60 })
		};
		for (const [what, act] of Object.entries(keeps)) {
			const made = templated();
			act(made);
			expect(made.doc.pages[0].template, what).toEqual({ id: 'caption', language: 'en' });
		}

		// Add to PDF, where it lands on the page: a strip of sky across the middle of a
		// landscape page leaves room over it for another. Taken back, the page has its
		// template again.
		const doc = new DocumentStore(null);
		const pageId = doc.addPage('landscape');
		doc.pages[0].blocks.push({
			kind: 'chart',
			id: 'strip',
			chart: chart(6),
			frame: { x: 12, y: 12, w: 120, h: 20 }
		});
		doc.layPage(pageId, layTemplate('caption', doc.pages[0]));
		const added = doc.addChart(chart(6));
		expect(added).toMatchObject({ pageId, newPage: false });
		expect(doc.pages[0].template).toBeUndefined();
		expect(added.undo()).toBe(true);
		expect(doc.pages[0].template).toEqual({ id: 'caption', language: 'en' });
	});

	it('turns a page like any other, and forgets, when it is no longer one page of its template', () => {
		// A title told which chart its fields read is the template's title still: no chart
		// is its own, so the page turns as the template lays it out, and the title reads on.
		const told = mixed();
		told.doc.layPage(told.pageId, layTemplate('pair', told.doc.pages[0]));
		const title = typesetOf(told.doc.pages[0]).find((text) => text.role === 'title')!;
		told.doc.updateTypeset(told.pageId, title.id, { text: 'The sky at {lst}', chartId: 'frame' });
		told.doc.setOrientation(told.pageId, 'landscape');
		expect(told.doc.pages[0].template).toEqual({ id: 'pair', language: 'en' });
		expect(typesetOf(told.doc.pages[0]).find((text) => text.id === title.id)).toMatchObject({
			text: 'The sky at {lst}',
			chartId: 'frame',
			frame: { x: 12, y: 12, w: 273 }
		});

		// A caption told to read the other chart: the template would not find it as its own.
		const { doc, pageId } = mixed();
		doc.layPage(pageId, layTemplate('pair', doc.pages[0]));
		const [page] = doc.pages;
		const caption = typesetOf(page).find((text) => text.chartId === 'disc')!;
		doc.updateTypeset(pageId, caption.id, { text: 'The winter sky', chartId: 'frame' });
		expect(page.template).toEqual({ id: 'pair', language: 'en' });
		const texts = plain(typesetOf(page));
		doc.setOrientation(pageId, 'landscape');
		expect(page.orientation).toBe('landscape');
		expect(page.template).toBeUndefined();
		// Nothing is lost on the way: every text is there with its words, moved with the box.
		expect(typesetOf(page).map((text) => [text.id, wordsOf(text), text.chartId])).toEqual(
			texts.map((text) => [text.id, wordsOf(text), text.chartId])
		);
		expect(
			chartsOf(page)
				.map((item) => item.id)
				.sort()
		).toEqual(['disc', 'frame']);
		for (const item of chartsOf(page)) expectInside(item.frame, page);

		// A template remembered by a page that holds none of its text (a save from elsewhere).
		const storage = memoryStorage();
		const odd = new DocumentStore(storage);
		odd.addChart(chart());
		odd.flush();
		const raw = saved(storage);
		raw.pages[0].template = { id: 'sheet', language: 'en' };
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		odd.load();
		expect(odd.pages[0].template).toEqual({ id: 'sheet', language: 'en' });
		odd.setOrientation(odd.pages[0].id, 'landscape');
		expect(odd.pages[0].template).toBeUndefined();
		expect(typesetOf(odd.pages[0])).toEqual([]);
		expect(odd.pages[0].turnMemo).toBeDefined();
	});
});

describe('createId', () => {
	it('is unique', () => {
		const ids = new Set(Array.from({ length: 200 }, createId));
		expect(ids.size).toBe(200);
	});

	it('works without crypto.randomUUID', () => {
		vi.stubGlobal('crypto', {});
		const ids = new Set(Array.from({ length: 200 }, createId));
		expect(ids.size).toBe(200);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
	});
});
