// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAX_TEXTS_PER_PAGE } from '$lib/api/wire/limits';
import { chartsOf, typesetOf } from './blocks';
import { DocumentStore } from './document.svelte';
import { GUTTER_MM, MIN_CHART_SIDE_MM, overlaps } from './geometry';
import { DOCUMENT_STORAGE_KEY, parseDocument, THUMB_BUDGET_CHARS } from './storage';
import { layTemplate } from './templates';
import { chart, expectInside, memoryStorage, saved, wordsOf } from './test-support';
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
		expect(doc.pages.flatMap((p) => chartsOf(p)).every((item) => item.thumb)).toBe(true);
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
		expect(chartsOf(doc.pages[0])).toEqual([{ kind: 'chart', ...good }]);
		const kept = chartsOf(doc.pages[1]);
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
		doc.setFrame(hand, moved.blockId, { x: 12, y: 12, w: 120, h: 120 });
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
		expect(chartsOf(again.page(pageId)!).map((it) => it.frame)).toEqual([
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
		expect(chartsOf(doc.page('chart-dropped')!)).toHaveLength(1);
	});

	it('keeps a crowded turn’s charts under 40 mm as they are across a reload', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		const tall = Array.from({ length: 8 }, (_, i) => ({
			kind: 'chart' as const,
			id: `t${i}`,
			chart: chart(0.4),
			frame: { x: 12 + i * 22.5, y: 12, w: 16.5, h: 41.25 }
		}));
		doc.page(pageId)!.blocks.push(...tall);
		doc.setOrientation(pageId, 'portrait');
		// Eight 2:5 pinholes fit a portrait page at 40 mm and more; on landscape they cannot.
		doc.setOrientation(pageId, 'landscape');
		const turned = chartsOf(doc.pages[0]).map((it) => it.frame);
		expect(Math.min(...turned.map((f) => f.w))).toBeLessThan(MIN_CHART_SIDE_MM);
		doc.flush();

		const again = new DocumentStore(storage);
		expect(again.load()).toBe(true);
		const loaded = chartsOf(again.pages[0]).map((it) => it.frame);
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
		const id = doc.addBlock(pageId, {
			kind: 'text',
			text: 'Latitude {lat}',
			style,
			frame: { x: 12, y: 200, w: 186, h: 6 },
			chartId: 'chart-a'
		})!;
		doc.flush();
		const again = new DocumentStore(storage);
		expect(again.load()).toBe(true);
		expect(typesetOf(again.pages[0])).toEqual([
			{
				kind: 'text',
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
		expect(typesetOf(loaded).map((it) => it.id)).toEqual(['ok', 'out']);
		expectInside(typesetOf(loaded)[1].frame, loaded);
		// A page saved before text was, or with none that parses, has none, and is not hand-arranged for it.
		expect(load(undefined).blocks).toEqual([]);
		expect(load([text({ text: null })]).blocks).toEqual([]);
		expect(load([text({ text: null })]).manual).toBeUndefined();
		expect(load('nonsense').manual).toBeUndefined();
	});

	it('saves the template a page remembers, and reads back only one there is', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		doc.pages[0].blocks.push({
			kind: 'chart',
			id: 'a',
			chart: chart(),
			frame: { x: 12, y: 12, w: 90, h: 90 }
		});
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
		expect(typesetOf(again.pages[0])[0].frame).toMatchObject({ x: 12, y: 12, w: 273 });
		expect(wordsOf(typesetOf(again.pages[0])[0])).toBe('Карта неба');
	});

	it('saves the part a text plays, and reads back only the parts there are', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		doc.addBlock(pageId, {
			kind: 'text',
			text: 'T',
			style,
			frame: { x: 12, y: 12, w: 80, h: 6 },
			role: 'title'
		});
		doc.flush();
		const raw = saved(storage);
		expect(raw.pages[0].texts![0].role).toBe('title');
		raw.pages[0].texts!.push({ ...raw.pages[0].texts![0], id: 'odd', role: 'footnote' as never });
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		const again = new DocumentStore(storage);
		again.load();
		expect(typesetOf(again.pages[0]).map((text) => text.role)).toEqual(['title', undefined]);
		// A copy is its owner's: it plays no part.
		expect(again.copyBlock(typesetOf(again.pages[0])[0].id)).not.toHaveProperty('role');
	});
});

describe('the shape it is saved in', () => {
	const disc = (id: string, frame: Rect) => ({ id, chart: chart(), frame });
	const words = (id: string, extra: object = {}) => ({
		id,
		text: 'Latitude {lat}',
		style,
		frame: { x: 12, y: 250, w: 186, h: 6 },
		...extra
	});
	const list = (id: string, table: object, extra: object = {}) => ({
		id,
		text: '',
		style,
		table,
		frame: { x: 12, y: 150, w: 90, h: 30 },
		...extra
	});

	/** A document as it is saved: every thing a page can hold. */
	function document() {
		const mark = { raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 };
		return {
			pages: [
				{
					id: 'turned',
					orientation: 'portrait',
					items: [
						disc('a', { x: 38.25, y: 12, w: 133.5, h: 133.5 }),
						{
							...disc('b', { x: 38.25, y: 151.5, w: 133.5, h: 133.5 }),
							thumb: 'data:image/png;base64,AAAA'
						}
					],
					layout: { tree: { dir: 'V', kids: [0, 1] }, sizing: 'uniform' },
					turnMemo: {
						orientation: 'landscape',
						ids: ['a', 'b'],
						frames: [
							{ x: 12, y: 38.25, w: 133.5, h: 133.5 },
							{ x: 151.5, y: 38.25, w: 133.5, h: 133.5 }
						],
						layout: { tree: { dir: 'H', kids: [0, 1] }, sizing: 'uniform' },
						manual: false
					}
				},
				{
					id: 'card',
					orientation: 'landscape',
					manual: true,
					template: { id: 'finder', language: 'ru' },
					items: [
						{
							id: 'sky',
							chart: { ...chart(), marks: [mark] },
							frame: { x: 12, y: 40, w: 150, h: 150 }
						},
						{
							id: 'close',
							chart: chart(1.5),
							frame: { x: 170, y: 40, w: 115, h: 115 / 1.5 },
							closeUpOf: 'sky'
						}
					],
					texts: [
						words('title', { role: 'title', frame: { x: 12, y: 12, w: 273, h: 8 } }),
						words('caption', { role: 'caption', chartId: 'sky', rotation: 180 }),
						list('stars', { source: 'stars', rows: 7 }, { role: 'stars', chartId: 'sky' }),
						list('messier', { source: 'messier', look: 'details', rows: 5, language: 'ru' }),
						words('mine')
					]
				},
				{ id: 'bare', orientation: 'portrait', items: [] }
			]
		};
	}

	it('writes under the key it always had: to a page its charts in `items`, its type in `texts`', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const { pageId, blockId } = doc.addChart(chart());
		const bare = doc.addPage();
		doc.addBlock(pageId, { kind: 'text', text: 'T', style, frame: { x: 12, y: 250, w: 80, h: 6 } });
		doc.addBlock(pageId, {
			kind: 'table',
			style,
			table: { source: 'stars', rows: 3 },
			frame: { x: 100, y: 250, w: 80, h: 20 },
			rotation: 90
		});
		doc.flush();
		expect(DOCUMENT_STORAGE_KEY).toBe('skycharts.document.v1');
		expect([...storage.data.keys()]).toEqual([DOCUMENT_STORAGE_KEY]);
		const raw = JSON.parse(storage.data.get(DOCUMENT_STORAGE_KEY)!);
		expect(Object.keys(raw)).toEqual(['pages']);
		const [page, empty] = raw.pages;
		expect(page).not.toHaveProperty('blocks');
		expect(page.manual).toBe(true);
		// A chart is saved as itself, a text with its words: neither says what kind it is.
		expect(page.items).toEqual([
			{ id: blockId, chart: chart(), frame: { x: 12, y: 55.5, w: 186, h: 186 } }
		]);
		expect(page.texts).toHaveLength(2);
		expect(page.texts[0]).toEqual({
			id: expect.any(String),
			text: 'T',
			style,
			frame: { x: 12, y: 250, w: 80, h: 6 }
		});
		// A table is a text of no words that carries its spec.
		expect(page.texts[1]).toMatchObject({
			text: '',
			style,
			table: { source: 'stars', rows: 3 },
			rotation: 90
		});
		expect(page.texts[1]).not.toHaveProperty('kind');
		// A page with no text has no list of it.
		expect(empty).toEqual({ id: bare, orientation: 'portrait', items: [] });
	});

	it('reads a saved document as the same pages, each of one list of blocks', () => {
		const pages = parseDocument(document())!;
		expect(pages.map((page) => page.id)).toEqual(['turned', 'card', 'bare']);
		const [turned, card, bare] = pages;
		const saved = document().pages;

		// Charts with their thumbnail, and how the page was laid out and turned.
		expect(turned).toEqual({
			id: 'turned',
			orientation: 'portrait',
			blocks: saved[0].items.map((item) => ({ kind: 'chart', ...item })),
			layout: saved[0].layout,
			turnMemo: saved[0].turnMemo
		});

		// A finder card: the ring on its sky, the close-up, the template, and the text over them.
		expect(card.template).toEqual({ id: 'finder', language: 'ru' });
		expect(card.manual).toBe(true);
		expect(card.blocks.map((block) => [block.kind, block.id])).toEqual([
			['chart', 'sky'],
			['chart', 'close'],
			['text', 'title'],
			['text', 'caption'],
			['table', 'stars'],
			['table', 'messier'],
			['text', 'mine']
		]);
		const [sky, close] = chartsOf(card);
		expect(sky.chart.marks).toEqual([{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }]);
		expect(close.closeUpOf).toBe('sky');
		const [title, caption, stars, messier, mine] = typesetOf(card);
		expect(title).toEqual({
			kind: 'text',
			id: 'title',
			text: 'Latitude {lat}',
			style,
			frame: { x: 12, y: 12, w: 273, h: 8 },
			role: 'title'
		});
		expect(caption).toMatchObject({ role: 'caption', chartId: 'sky', rotation: 180 });
		// A table is a block of its own kind, with the spec it had and none of the empty words.
		expect(stars).toEqual({
			kind: 'table',
			id: 'stars',
			style,
			table: { source: 'stars', look: 'names', rows: 7 },
			frame: { x: 12, y: 150, w: 90, h: 30 },
			role: 'stars',
			chartId: 'sky'
		});
		expect(messier).toMatchObject({
			kind: 'table',
			table: { source: 'messier', look: 'details', rows: 5, language: 'ru' }
		});
		expect(mine).not.toHaveProperty('role');
		expect(bare).toEqual({ id: 'bare', orientation: 'portrait', blocks: [] });
	});

	it('writes a document back in the shape it read it in, and reads the same pages from that', () => {
		const pages = parseDocument(document())!;
		const storage = memoryStorage();
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(document()));
		const doc = new DocumentStore(storage);
		expect(doc.load()).toBe(true);
		expect(doc.pages).toEqual(pages);
		// Nothing is written by reading.
		expect(storage.writes).toBe(0);

		// Changed, it is saved where it was and as it was: nothing a build before would not read.
		doc.selectedPageId = 'card';
		const added = doc.addPage();
		doc.removePage(added);
		doc.flush();
		expect([...storage.data.keys()]).toEqual([DOCUMENT_STORAGE_KEY]);
		const raw = JSON.parse(storage.data.get(DOCUMENT_STORAGE_KEY)!);
		expect(raw.pages.every((page: object) => 'items' in page && !('blocks' in page))).toBe(true);
		const [turned, card, bare] = document().pages;
		expect(raw.pages[0]).toEqual(turned);
		expect(raw.pages[1]).toMatchObject({ ...card, texts: card.texts!.map(({ id }) => ({ id })) });
		expect(raw.pages[1].texts.map((text: { text: string }) => text.text)).toEqual([
			'Latitude {lat}',
			'Latitude {lat}',
			'',
			'',
			'Latitude {lat}'
		]);
		expect(raw.pages[2]).toEqual(bare);
		expect(parseDocument(raw)).toEqual(pages);
		const again = new DocumentStore(storage);
		expect(again.load()).toBe(true);
		expect(again.pages).toEqual(pages);
	});

	it('reads only under its own key, and a page only in the shape it is saved in', () => {
		const { pages } = document();
		const blocks = { pages: parseDocument({ pages })!.slice(0, 1) };
		const load = (entries: Record<string, unknown>) => {
			const storage = memoryStorage();
			for (const [key, value] of Object.entries(entries)) {
				storage.data.set(key, JSON.stringify(value));
			}
			const doc = new DocumentStore(storage);
			return doc.load() ? doc.pages.map((page) => page.id) : null;
		};
		expect(load({ [DOCUMENT_STORAGE_KEY]: { pages } })).toEqual(['turned', 'card', 'bare']);
		// Under any other key there is no document, whatever is there.
		expect(load({ 'skycharts.document.v2': { pages } })).toBeNull();
		expect(load({ 'skycharts.document.v2': blocks })).toBeNull();
		expect(
			load({ [DOCUMENT_STORAGE_KEY]: 'nonsense', 'skycharts.document.v2': blocks })
		).toBeNull();
		// The model's page is no saved page: it has blocks, and no list of charts.
		expect(load({ [DOCUMENT_STORAGE_KEY]: blocks })).toEqual([]);
		expect(parseDocument(blocks)).toEqual([]);
		expect(parseDocument({ pages: 3 })).toBeNull();
	});

	it('makes room for the document by leaving its thumbnails out, and takes nothing else away', () => {
		// Room for the document with its thumbnail, while nothing else is kept beside it.
		const data = new Map<string, string>();
		const used = () => [...data.values()].reduce((sum, value) => sum + value.length, 0);
		const storage = {
			getItem: (key: string) => data.get(key) ?? null,
			setItem(key: string, value: string) {
				const others = used() - (data.get(key)?.length ?? 0);
				if (others + value.length > 9000) throw new DOMException('Quota', 'QuotaExceededError');
				data.set(key, value);
			}
		};
		const thumb = `data:image/png;base64,${'A'.repeat(5000)}`;
		const old = {
			pages: [
				{
					id: 'p',
					orientation: 'portrait',
					items: [{ ...disc('a', { x: 12, y: 55.5, w: 186, h: 186 }), thumb }]
				}
			]
		};
		data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(old));
		const doc = new DocumentStore(storage);
		expect(doc.load()).toBe(true);
		// Written over its own copy, it fits as it did.
		doc.addPage();
		doc.flush();
		expect([...data.keys()]).toEqual([DOCUMENT_STORAGE_KEY]);
		const again = new DocumentStore(storage);
		again.load();
		expect(again.pages).toHaveLength(2);
		expect(chartsOf(again.pages[0])[0].thumb).toBe(thumb);

		// With something else in the storage there is room for the charts alone: the
		// thumbnail goes, and what is not the document's stays.
		const other = 'x'.repeat(5000);
		data.set('skycharts.other', other);
		doc.addPage();
		doc.flush();
		expect(data.get('skycharts.other')).toBe(other);
		const later = new DocumentStore(storage);
		later.load();
		expect(later.pages).toHaveLength(3);
		expect(chartsOf(later.pages[0])[0]).not.toHaveProperty('thumb');
		expect(chartsOf(later.pages[0])[0].frame).toEqual({ x: 12, y: 55.5, w: 186, h: 186 });
	});

	it('reads charts from the list of charts and type from the list of type, and drops what is in the wrong one', () => {
		const frame = { x: 12, y: 12, w: 90, h: 90 };
		const type = { style, frame: { x: 12, y: 200, w: 90, h: 6 } };
		const page = (items: unknown[], texts: unknown[]) =>
			parseDocument({ pages: [{ id: 'p', orientation: 'portrait', items, texts }] })![0];
		const read = page(
			[
				{ id: 'c1', chart: chart(), frame },
				{ id: 'x1', ...type, text: 'a text among the charts' },
				{ id: 'c2', chart: chart(), frame, kind: 'text', text: 'a chart, whatever it says' },
				{ id: 'x2', ...type, text: '', table: { source: 'stars', rows: 3 } },
				'nonsense'
			],
			[
				{ id: 't1', ...type, text: 'one' },
				{ id: 'x3', chart: chart(), frame },
				{ id: 'l1', ...type, text: '', table: { source: 'stars', rows: 3 } },
				{ id: 'x4', ...type, table: { source: 'stars', rows: 3 } },
				{ id: 'c1', ...type, text: 'an id a chart has' },
				'nonsense'
			]
		);
		expect(read.blocks.map((it) => [it.kind, it.id])).toEqual([
			['chart', 'c1'],
			['chart', 'c2'],
			['text', 't1'],
			['table', 'l1']
		]);
		expect(read.manual).toBe(true);
		// A text with a spec that reads as one is a table, whatever words were saved with it.
		const kept = page([], [{ id: 't', ...type, text: 'x', table: { source: 'stars', rows: 3 } }]);
		expect(kept.blocks).toEqual([
			{ kind: 'table', id: 't', table: { source: 'stars', look: 'names', rows: 3 }, ...type }
		]);
	});

	it('holds a page to the texts and tables the backend takes, written and read again', () => {
		const many = Array.from({ length: MAX_TEXTS_PER_PAGE + 5 }, (_, i) =>
			i % 2 ? list(`l${i}`, { source: 'stars', rows: 3 }) : words(`t${i}`)
		);
		const raw = { pages: [{ id: 'p', orientation: 'portrait', items: [], texts: many }] };
		const old = parseDocument(raw)!;
		expect(typesetOf(old[0])).toHaveLength(MAX_TEXTS_PER_PAGE);
		expect(
			typesetOf(old[0])
				.map((it) => it.kind)
				.slice(0, 2)
		).toEqual(['text', 'table']);
		const storage = memoryStorage();
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		const doc = new DocumentStore(storage);
		doc.load();
		doc.removePage(doc.addPage());
		doc.flush();
		const written = saved(storage);
		expect(written.pages[0].texts).toHaveLength(MAX_TEXTS_PER_PAGE);
		expect(parseDocument(written)).toEqual(old);
	});
});
