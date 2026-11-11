// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aloneFrame } from './arrange';
import { chartsOf } from './blocks';
import { MAX_CHARTS, MAX_ITEMS_PER_PAGE, MAX_PAGES } from '$lib/api/wire/limits';
import { createId, DocumentStore } from './document.svelte';
import { DOCUMENT_STORAGE_KEY, type DocumentStorage } from './storage';
import { chart, expectInside, memoryStorage, saved } from './test-support';
import type { ChartBlock } from './types';

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
			expect(saved(storage).pages[0].items[0].frame.x).toBe(59);

			doc.setFrame(pageId, blockId, { x: 20, y: 12, w: 90, h: 90 });
			doc.flush();
			expect(storage.writes).toBe(2);
			expect(saved(storage).pages[0].items[0].frame.x).toBe(20);
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
