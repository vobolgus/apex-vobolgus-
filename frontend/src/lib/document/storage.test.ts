// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DocumentStore } from './document.svelte';
import { GUTTER_MM, MIN_CHART_SIDE_MM, overlaps } from './geometry';
import { DOCUMENT_STORAGE_KEY, THUMB_BUDGET_CHARS } from './storage';
import { layTemplate } from './templates';
import { chart, expectInside, memoryStorage, saved } from './test-support';
import { DEFAULT_TEXT_STYLE } from './text';
import type { Rect } from './types';

const style = { ...DEFAULT_TEXT_STYLE };

describe('the saved document', () => {
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
		expect(item.frame).toEqual({ x: 12, y: 55.5, w: 186, h: 186 });
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

	it('saves and loads how each page was laid out', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const { pageId } = doc.addChart(chart());
		doc.addChart(chart());
		const hand = doc.addPage();
		const moved = doc.addChart(chart());
		doc.updateItem(hand, moved.itemId, { x: 12, y: 12, w: 120, h: 120 });
		doc.setOrientation(pageId, 'landscape');
		doc.flush();
		const again = new DocumentStore(storage);
		expect(again.load()).toBe(true);
		expect(again.pages).toEqual(doc.pages);
		expect(again.page(pageId)?.layout).toEqual({
			tree: { dir: 'H', kids: [0, 1] },
			sizing: 'uniform'
		});
		expect(again.page(pageId)?.turnMemo?.orientation).toBe('portrait');
		expect(again.page(hand)?.manual).toBe(true);
		// Turning back after a reload restores the page as it was.
		again.setOrientation(pageId, 'portrait');
		expect(again.page(pageId)?.items.map((it) => it.frame)).toEqual([
			{ x: 38.25, y: 12, w: 133.5, h: 133.5 },
			{ x: 38.25, y: 151.5, w: 133.5, h: 133.5 }
		]);
	});

	it('drops a layout or a turn memo that does not fit its page', () => {
		const disc = (id: string, frame: Rect) => ({ id, chart: chart(), frame });
		const items = [
			disc('a', { x: 38.25, y: 12, w: 133.5, h: 133.5 }),
			disc('b', { x: 38.25, y: 151.5, w: 133.5, h: 133.5 })
		];
		const layout = { tree: { dir: 'V', kids: [0, 1] }, sizing: 'uniform' };
		const memo = {
			orientation: 'landscape',
			ids: ['a', 'b'],
			frames: [
				{ x: 12, y: 38.25, w: 133.5, h: 133.5 },
				{ x: 151.5, y: 38.25, w: 133.5, h: 133.5 }
			],
			layout: { tree: { dir: 'H', kids: [0, 1] }, sizing: 'uniform' },
			manual: false
		};
		const page = (id: string, extra: object, list = items) => ({
			id,
			orientation: 'portrait',
			items: list.map((it) => ({ ...it, id: `${id}-${it.id}` })),
			...extra
		});
		const memoFor = (id: string, m: object) => ({
			...memo,
			ids: memo.ids.map((x) => `${id}-${x}`),
			...m
		});
		const pages = [
			page('ok', { manual: true, layout, turnMemo: memoFor('ok', {}) }),
			page('manual-not-true', { manual: 'yes' }),
			page('leaf-twice', { layout: { ...layout, tree: { dir: 'V', kids: [0, 0] } } }),
			page('leaf-missing', { layout: { ...layout, tree: 0 } }),
			page('leaf-out', { layout: { ...layout, tree: { dir: 'H', kids: [0, 2] } } }),
			page('bad-dir', { layout: { ...layout, tree: { dir: 'X', kids: [0, 1] } } }),
			page('one-kid', {
				layout: { ...layout, tree: { dir: 'V', kids: [{ dir: 'H', kids: [0] }, 1] } }
			}),
			page('bad-sizing', { layout: { ...layout, sizing: 'tight' } }),
			page('chart-dropped', { layout }, [
				items[0],
				{ ...items[1], frame: null as unknown as Rect }
			]),
			page('memo-ids', { turnMemo: { ...memo, ids: ['x', 'y'] } }),
			page('memo-twice', {
				turnMemo: memoFor('memo-twice', { ids: ['memo-twice-a', 'memo-twice-a'] })
			}),
			page('memo-same-way', { turnMemo: memoFor('memo-same-way', { orientation: 'portrait' }) }),
			page('memo-outside', {
				turnMemo: memoFor('memo-outside', {
					frames: [memo.frames[0], { x: 200, y: 38.25, w: 133.5, h: 133.5 }]
				})
			}),
			page('memo-layout', {
				turnMemo: memoFor('memo-layout', { layout: { tree: 7, sizing: 'uniform' } })
			})
		];
		const storage = memoryStorage();
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify({ pages }));
		const doc = new DocumentStore(storage);
		expect(doc.load()).toBe(true);
		const [ok, ...rest] = doc.pages;
		expect(ok).toMatchObject({ manual: true, layout, turnMemo: memoFor('ok', {}) });
		for (const p of rest) {
			expect(p.manual, p.id).toBeUndefined();
			expect(p.layout, p.id).toBeUndefined();
			expect(p.turnMemo, p.id).toBeUndefined();
		}
		expect(doc.page('chart-dropped')?.items).toHaveLength(1);
	});

	it('keeps a crowded turn’s charts under 40 mm as they are across a reload', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		const tall = Array.from({ length: 8 }, (_, i) => ({
			id: `t${i}`,
			chart: chart(0.4),
			frame: { x: 12 + i * 22.5, y: 12, w: 16.5, h: 41.25 }
		}));
		doc.page(pageId)!.items.push(...tall);
		doc.setOrientation(pageId, 'portrait');
		// Eight 2:5 pinholes fit a portrait page at 40 mm and more; on landscape they cannot.
		doc.setOrientation(pageId, 'landscape');
		const turned = doc.pages[0].items.map((it) => it.frame);
		expect(Math.min(...turned.map((f) => f.w))).toBeLessThan(MIN_CHART_SIDE_MM);
		doc.flush();

		const again = new DocumentStore(storage);
		expect(again.load()).toBe(true);
		const loaded = again.pages[0].items.map((it) => it.frame);
		expect(loaded).toEqual(turned);
		loaded.forEach((frame, i) => {
			expectInside(frame, again.pages[0]);
			for (let j = 0; j < i; j++) expect(overlaps(frame, loaded[j], GUTTER_MM)).toBe(false);
		});
	});

	it('saves text and reads it back, dropping what does not parse', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		const id = doc.addText(pageId, {
			text: 'Latitude {lat}',
			style,
			frame: { x: 12, y: 200, w: 186, h: 6 },
			chartId: 'chart-a'
		})!;
		doc.flush();
		const again = new DocumentStore(storage);
		expect(again.load()).toBe(true);
		expect(again.pages[0].texts).toEqual([
			{
				id,
				text: 'Latitude {lat}',
				style,
				frame: { x: 12, y: 200, w: 186, h: 6 },
				chartId: 'chart-a'
			}
		]);
		expect(again.pages[0].manual).toBe(true);

		const text = (overrides: object) => ({
			id: 'ok',
			text: 'kept',
			style,
			frame: { x: 12, y: 12, w: 80, h: 6 },
			...overrides
		});
		const page = (texts: unknown) => ({ id: 'p', orientation: 'portrait', items: [], texts });
		const load = (texts: unknown) => {
			storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify({ pages: [page(texts)] }));
			const store = new DocumentStore(storage);
			expect(store.load()).toBe(true);
			return store.pages[0];
		};
		const loaded = load([
			text({}),
			text({ id: 'ok' }),
			text({ id: 'p' }),
			text({ id: 'no-text', text: 7 }),
			text({ id: 'no-style', style: null }),
			text({ id: 'font', style: { ...style, font: 'comic' } }),
			text({ id: 'size', style: { ...style, size: 500 } }),
			text({ id: 'align', style: { ...style, align: 'justify' } }),
			text({ id: 'bold', style: { ...style, bold: 'yes' } }),
			text({ id: 'frame', frame: { x: 0, y: 0, w: -1, h: 6 } }),
			text({ id: 'out', frame: { x: 500, y: 500, w: 80, h: 6 } }),
			'nonsense'
		]);
		expect(loaded.texts!.map((it) => it.id)).toEqual(['ok', 'out']);
		expectInside(loaded.texts![1].frame, loaded);
		// A page saved before text was, or with none that parses, has no `texts` at all.
		expect(load(undefined)).not.toHaveProperty('texts');
		expect(load([text({ text: null })])).not.toHaveProperty('texts');
		expect(load('nonsense').manual).toBeUndefined();
	});

	it('saves the template a page remembers, and reads back only one there is', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		doc.pages[0].items.push({ id: 'a', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } });
		doc.layPage(pageId, layTemplate('caption', doc.pages[0], { language: 'ru' }));
		doc.flush();
		expect(saved(storage).pages[0].template).toEqual({ id: 'caption', language: 'ru' });
		const read = (template: unknown) => {
			const raw = saved(storage);
			(raw.pages[0] as { template: unknown }).template = template;
			const tampered = memoryStorage();
			tampered.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
			const again = new DocumentStore(tampered);
			again.load();
			return again.pages[0].template;
		};
		expect(read({ id: 'caption', language: 'ru' })).toEqual({ id: 'caption', language: 'ru' });
		expect(read({ id: 'finder', language: 'en', swap: true })).toEqual({
			id: 'finder',
			language: 'en'
		});
		// A language there is not is the first there is; a template there is not is none.
		expect(read({ id: 'pair', language: 'de' })).toEqual({ id: 'pair', language: 'en' });
		expect(read({ id: 'pair' })).toEqual({ id: 'pair', language: 'en' });
		expect(read({ id: 'poster', language: 'en' })).toBeUndefined();
		expect(read({ id: 'charts', language: 'en' })).toBeUndefined();
		expect(read({ language: 'ru' })).toBeUndefined();
		expect(read('caption')).toBeUndefined();
		expect(read(null)).toBeUndefined();

		// Read back, the page turns as its template lays it out.
		const again = new DocumentStore(storage);
		again.load();
		again.setOrientation(pageId, 'landscape');
		expect(again.pages[0].template).toEqual({ id: 'caption', language: 'ru' });
		expect(again.pages[0].texts![0].frame).toMatchObject({ x: 12, y: 12, w: 273 });
		expect(again.pages[0].texts![0].text).toBe('Карта неба');
	});

	it('saves the part a text plays, and reads back only the parts there are', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		doc.addText(pageId, { text: 'T', style, frame: { x: 12, y: 12, w: 80, h: 6 }, role: 'title' });
		doc.flush();
		const raw = saved(storage);
		expect(raw.pages[0].texts![0].role).toBe('title');
		raw.pages[0].texts!.push({
			...raw.pages[0].texts![0],
			id: 'odd',
			role: 'footnote' as never
		});
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		const again = new DocumentStore(storage);
		again.load();
		expect(again.pages[0].texts!.map((text) => text.role)).toEqual(['title', undefined]);
		// A copy is its owner's: it plays no part.
		expect(again.copyBlock(again.pages[0].texts![0].id)).not.toHaveProperty('role');
	});
});
