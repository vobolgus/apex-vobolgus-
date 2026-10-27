// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentBox } from './geometry';
import {
	createId,
	DOCUMENT_STORAGE_KEY,
	DocumentStore,
	THUMB_BUDGET_CHARS,
	type DocumentStorage
} from './document.svelte';
import type { ChartSnapshot, DocPage, Rect } from './types';

function chart(aspect = 1): ChartSnapshot {
	return {
		view: {
			projection: aspect === 1 ? 'stereographic' : 'pinhole',
			orientation: { x: 0, y: 0, z: 0, w: 1 },
			stereoFovDeg: 180,
			pinholeFovDeg: 100,
			pinholeAspectRatio: aspect === 1 ? 1.61 : aspect,
			pinholeHeightFrac: 1.18
		},
		layers: {
			constellations: true,
			constellationBoundaries: false,
			equator: false,
			ecliptic: true,
			galacticEquator: false,
			planets: false
		},
		aspect,
		createdAt: '2026-10-27T12:00:00.000Z'
	};
}

function memoryStorage(limit = Infinity) {
	const data = new Map<string, string>();
	const storage = {
		data,
		writes: 0,
		getItem: (key: string) => data.get(key) ?? null,
		setItem(key: string, value: string) {
			storage.writes += 1;
			if (value.length > limit) throw new DOMException('Quota exceeded', 'QuotaExceededError');
			data.set(key, value);
		}
	};
	return storage;
}

function saved(storage: ReturnType<typeof memoryStorage>): { pages: DocPage[] } {
	return JSON.parse(storage.data.get(DOCUMENT_STORAGE_KEY)!);
}

function expectInside(frame: Rect, page: DocPage) {
	const box = contentBox(page.orientation);
	expect(frame.x).toBeGreaterThanOrEqual(box.x - 1e-9);
	expect(frame.y).toBeGreaterThanOrEqual(box.y - 1e-9);
	expect(frame.x + frame.w).toBeLessThanOrEqual(box.x + box.w + 1e-9);
	expect(frame.y + frame.h).toBeLessThanOrEqual(box.y + box.h + 1e-9);
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
		it('opens a portrait page for the first chart, at the full width', () => {
			const doc = new DocumentStore(null);
			const result = doc.addChart(chart(), 'data:image/png;base64,AAAA');
			expect(result.newPage).toBe(true);
			expect(doc.pageCount).toBe(1);
			const [page] = doc.pages;
			expect(result.pageId).toBe(page.id);
			expect(page.orientation).toBe('portrait');
			expect(page.items).toHaveLength(1);
			expect(page.items[0]).toMatchObject({
				id: result.itemId,
				frame: { x: 12, y: 12, w: 186, h: 186 },
				thumb: 'data:image/png;base64,AAAA'
			});
		});

		it('fills the existing pages before opening another', () => {
			const doc = new DocumentStore(null);
			const first = doc.addChart(chart());
			const second = doc.addChart(chart());
			expect(second).toMatchObject({ pageId: first.pageId, newPage: false });
			expect(doc.pages[0].items[1].frame).toEqual({ x: 12, y: 204, w: 63.75, h: 63.75 });
			expect(doc.chartCount).toBe(2);
		});

		it('uses an empty page that is already there', () => {
			const doc = new DocumentStore(null);
			const pageId = doc.addPage('landscape');
			expect(doc.addChart(chart())).toMatchObject({ pageId, newPage: false });
			expect(doc.pages[0].items[0].frame).toEqual({ x: 12, y: 12, w: 186, h: 186 });
		});

		it('stores a frozen copy of the chart', () => {
			const doc = new DocumentStore(null);
			const source = chart(1.5);
			doc.addChart(source);
			source.view.orientation.x = 0.5;
			source.layers.planets = true;
			const stored = doc.pages[0].items[0];
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
			expect(doc.pages.map((p) => [p.id, p.orientation, p.items.length])).toEqual([
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
			const items = JSON.stringify(doc.page(a)?.items);
			doc.selectedPageId = a;

			const undo = doc.removePage(a);
			expect(doc.pages.map((p) => p.id)).toEqual([b, c]);
			expect(doc.selectedPageId).toBe(b);

			undo();
			expect(doc.pages.map((p) => p.id)).toEqual([a, b, c]);
			expect(JSON.stringify(doc.page(a)?.items)).toBe(items);
			expect(doc.selectedPageId).toBe(a);

			doc.removePage(c);
			undo();
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

		it('turns a page and places the charts that fell off it again', () => {
			const doc = new DocumentStore(null);
			const id = doc.addPage();
			doc.addChart(chart());
			doc.updateItem(id, doc.pages[0].items[0].id, { x: 12, y: 12, w: 133.5, h: 133.5 });
			doc.addChart(chart());
			doc.updateItem(id, doc.pages[0].items[1].id, { x: 12, y: 151.5, w: 133.5, h: 133.5 });

			doc.setOrientation(id, 'landscape');
			const page = doc.pages[0];
			expect(page.orientation).toBe('landscape');
			expect(page.items.map((item) => item.frame)).toEqual([
				{ x: 12, y: 12, w: 133.5, h: 133.5 },
				{ x: 151.5, y: 12, w: 133.5, h: 133.5 }
			]);
		});

		it('scales a chart down into a turned page', () => {
			const doc = new DocumentStore(null);
			doc.addChart(chart(186 / 273));
			const page = doc.pages[0];
			expect(page.items[0].frame.h).toBeCloseTo(273, 9);
			doc.setOrientation(page.id, 'landscape');
			const { frame } = doc.pages[0].items[0];
			expectInside(frame, doc.pages[0]);
			expect(frame.h).toBeCloseTo(186, 9);
			expect(frame.w / frame.h).toBeCloseTo(186 / 273, 9);
		});
	});

	describe('items', () => {
		it('keeps an updated frame inside the page at the chart aspect', () => {
			const doc = new DocumentStore(null);
			const { pageId, itemId } = doc.addChart(chart(2));
			expect(doc.updateItem(pageId, itemId, { x: 150, y: 270, w: 100, h: 10 })).toBe(true);
			const { frame } = doc.pages[0].items[0];
			expect(frame).toEqual({ x: 98, y: 235, w: 100, h: 50 });
			expect(doc.updateItem(pageId, 'nope', frame)).toBe(false);
			expect(doc.updateItem('nope', itemId, frame)).toBe(false);
		});

		it('moves a chart onto another page, fitted there', () => {
			const doc = new DocumentStore(null);
			const from = doc.addPage();
			const to = doc.addPage('landscape');
			const { itemId } = doc.addChart(chart());
			expect(doc.pages[0].items).toHaveLength(1);

			expect(doc.moveItem(itemId, to, { x: 200, y: 100, w: 186, h: 186 })).toBe(true);
			expect(doc.page(from)?.items).toEqual([]);
			const moved = doc.page(to)!.items;
			expect(moved.map((item) => item.id)).toEqual([itemId]);
			expect(moved[0].frame).toEqual({ x: 99, y: 12, w: 186, h: 186 });
			expect(moved[0].chart).toEqual(chart());
		});

		it('moves within a page like an update', () => {
			const doc = new DocumentStore(null);
			const { pageId, itemId } = doc.addChart(chart());
			expect(doc.moveItem(itemId, pageId, { x: 20, y: 30, w: 90, h: 90 })).toBe(true);
			expect(doc.pages[0].items[0].frame).toEqual({ x: 20, y: 30, w: 90, h: 90 });
			expect(doc.moveItem('nope', pageId, { x: 0, y: 0, w: 90, h: 90 })).toBe(false);
			expect(doc.moveItem(itemId, 'nope', { x: 0, y: 0, w: 90, h: 90 })).toBe(false);
		});

		it('removes a chart and undoes it at its place, once', () => {
			const doc = new DocumentStore(null);
			const a = doc.addChart(chart());
			const b = doc.addChart(chart());
			const c = doc.addChart(chart());
			const page = () => doc.pages[0];
			expect(page().items.map((i) => i.id)).toEqual([a.itemId, b.itemId, c.itemId]);

			const undo = doc.removeItem(a.pageId, b.itemId);
			expect(page().items.map((i) => i.id)).toEqual([a.itemId, c.itemId]);
			undo();
			expect(page().items.map((i) => i.id)).toEqual([a.itemId, b.itemId, c.itemId]);
			undo();
			expect(page().items).toHaveLength(3);
		});

		it('does not bring a chart back once its page is gone', () => {
			const doc = new DocumentStore(null);
			const { pageId, itemId } = doc.addChart(chart());
			const undo = doc.removeItem(pageId, itemId);
			doc.removePage(pageId);
			undo();
			expect(doc.pages).toEqual([]);
			expect(doc.removeItem(pageId, itemId)).toBeTypeOf('function');
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
			const { pageId, itemId } = doc.addChart(chart());
			for (let x = 12; x < 60; x++) doc.updateItem(pageId, itemId, { x, y: 12, w: 90, h: 90 });
			vi.runAllTimers();
			expect(storage.writes).toBe(1);
			expect(saved(storage).pages[0].items[0].frame.x).toBe(59);

			doc.updateItem(pageId, itemId, { x: 20, y: 12, w: 90, h: 90 });
			doc.flush();
			expect(storage.writes).toBe(2);
			expect(saved(storage).pages[0].items[0].frame.x).toBe(20);
			vi.runAllTimers();
			expect(storage.writes).toBe(2);
		});

		it('keeps thumbnails out of storage once they pass the budget', () => {
			const storage = memoryStorage();
			const doc = new DocumentStore(storage);
			const big = `data:image/png;base64,${'A'.repeat(THUMB_BUDGET_CHARS * 0.6)}`;
			doc.addChart(chart(), big);
			doc.addChart(chart(), big);
			doc.addChart(chart(), 'data:image/png;base64,small');
			doc.flush();
			const items = saved(storage).pages.flatMap((p) => p.items);
			expect(items.map((item) => item.thumb?.length ?? 0)).toEqual([
				big.length,
				0,
				'data:image/png;base64,small'.length
			]);
			// They stay in memory for this session.
			expect(doc.pages.flatMap((p) => p.items).every((item) => item.thumb)).toBe(true);
		});

		it('drops every thumbnail when the quota is too small for them', () => {
			const storage = memoryStorage(5000);
			const doc = new DocumentStore(storage);
			doc.addChart(chart(), `data:image/png;base64,${'A'.repeat(10000)}`);
			doc.flush();
			const [item] = saved(storage).pages[0].items;
			expect(item).not.toHaveProperty('thumb');
			expect(item.frame).toEqual({ x: 12, y: 12, w: 186, h: 186 });
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

		it('ignores data that is not a document', () => {
			for (const raw of ['not json', 'null', '[]', '{"pages": 3}', '"x"']) {
				const storage = memoryStorage();
				storage.data.set(DOCUMENT_STORAGE_KEY, raw);
				const doc = new DocumentStore(storage);
				expect(doc.load()).toBe(false);
				expect(doc.pages).toEqual([]);
			}
			expect(new DocumentStore(memoryStorage()).load()).toBe(false);
		});

		it('drops broken pages and charts and keeps the rest', () => {
			const good = { id: 'i1', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } };
			const document = {
				pages: [
					{ id: 'p1', orientation: 'portrait', items: [good] },
					{ id: 'p2', orientation: 'sideways', items: [] },
					{ id: 'p1', orientation: 'portrait', items: [] },
					{ orientation: 'portrait', items: [] },
					{ id: 'p3', orientation: 'landscape' },
					{
						id: 'p4',
						orientation: 'landscape',
						items: [
							{ ...good, id: 'i1' },
							{ ...good, id: 'i2', frame: { x: 12, y: 12, w: -5, h: 90 } },
							{ ...good, id: 'i3', chart: { ...chart(), aspect: 0 } },
							{ ...good, id: 'i4', chart: { ...chart(), createdAt: 'yesterday' } },
							{
								...good,
								id: 'i5',
								chart: { ...chart(), view: { ...chart().view, projection: 'fisheye' } }
							},
							{
								...good,
								id: 'i6',
								chart: { ...chart(), layers: { ...chart().layers, planets: 'yes' } }
							},
							{
								...good,
								id: 'i7',
								chart: {
									...chart(),
									view: { ...chart().view, orientation: { x: 0, y: 0, z: 0, w: null } }
								}
							},
							{ ...good, id: 'i8', thumb: 'javascript:alert(1)' },
							{ ...good, id: 'i9', frame: { x: 250, y: 150, w: 400, h: 400 } }
						]
					}
				]
			};
			const storage = memoryStorage();
			storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(document));
			const doc = new DocumentStore(storage);
			expect(doc.load()).toBe(true);
			expect(doc.pages.map((p) => p.id)).toEqual(['p1', 'p4']);
			expect(doc.pages[0].items).toEqual([good]);
			const kept = doc.pages[1].items;
			expect(kept.map((item) => item.id)).toEqual(['i8', 'i9']);
			expect(kept[0]).not.toHaveProperty('thumb');
			// Refitted into the landscape content box.
			expect(kept[1].frame).toEqual({ x: 99, y: 12, w: 186, h: 186 });
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
