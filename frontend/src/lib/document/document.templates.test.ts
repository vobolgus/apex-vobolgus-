// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentBox, GUTTER_MM } from './geometry';
import { chartsOf, typesetOf } from './blocks';
import { MAX_CHARTS, MAX_ITEMS_PER_PAGE } from '$lib/api/wire/limits';
import { DocumentStore } from './document.svelte';
import { DOCUMENT_STORAGE_KEY } from './storage';
import { layTemplate } from './templates';
import { chart, expectInside, memoryStorage, saved, wordsOf } from './test-support';
import { DEFAULT_TEXT_STYLE } from './text';
import type { DocPage } from './types';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
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
