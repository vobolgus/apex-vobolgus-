import { describe, expect, it } from 'vitest';
import { contentBox, GUTTER_MM, overlaps, rotatedBounds } from './geometry';
import {
	closeUpChart,
	finderSky,
	isOnChart,
	layTemplate,
	TEMPLATES,
	type CloseUp,
	type LaidPage,
	type TemplateId
} from './templates';
import { fieldValues } from './text';
import { DEFAULT_TEXT_STYLE, LINE_HEIGHT, MM_PER_PT } from './text';
import type { ChartSnapshot, DocItem, DocPage, DocText, PageOrientation, Rect } from './types';

function chart(aspect = 1): ChartSnapshot {
	return {
		view: {
			projection: aspect === 1 ? 'stereographic' : 'pinhole',
			orientation: { x: 0, y: 0, z: 0, w: 1 },
			stereoFovDeg: 180,
			pinholeFovDeg: 60,
			pinholeAspectRatio: aspect === 1 ? 1.6 : aspect,
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

const disc = (id: string): DocItem => ({
	id,
	chart: chart(),
	frame: { x: 12, y: 12, w: 90, h: 90 }
});
const frame = (id: string, aspect = 1.6): DocItem => ({
	id,
	chart: chart(aspect),
	frame: { x: 12, y: 108, w: 90, h: 90 / aspect }
});

function page(items: DocItem[], texts?: DocText[], orientation: PageOrientation = 'portrait') {
	const made: DocPage = { id: 'p', orientation, items };
	if (texts) made.texts = texts;
	return made;
}

function inside(rect: Rect, box: Rect) {
	expect(rect.x).toBeGreaterThanOrEqual(box.x - 1e-6);
	expect(rect.y).toBeGreaterThanOrEqual(box.y - 1e-6);
	expect(rect.x + rect.w).toBeLessThanOrEqual(box.x + box.w + 1e-6);
	expect(rect.y + rect.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
}

/** Everything a laid page holds is on it, at its aspect, and nothing lies on anything else. */
function expectSound(laid: LaidPage, source: DocPage) {
	const box = contentBox(laid.orientation);
	const taken: Rect[] = [];
	for (const placed of laid.charts) {
		const chart = placed.chart ?? source.items.find((it) => it.id === placed.id)!.chart;
		expect(placed.frame.w / placed.frame.h).toBeCloseTo(chart.aspect, 6);
		inside(placed.frame, box);
		taken.push(placed.frame);
	}
	for (const text of laid.texts) {
		const bounds = rotatedBounds(text.frame, text.rotation);
		inside(bounds, box);
		expect(text.frame.h).toBeGreaterThan(0);
		taken.push(bounds);
	}
	for (let i = 0; i < taken.length; i++) {
		for (let j = i + 1; j < taken.length; j++) {
			expect(overlaps(taken[i], taken[j]), `${i} over ${j}`).toBe(false);
		}
	}
}

/** What a worksheet asks, as SkyGen's does, in each language. */
const EN_TASKS = [
	'1. Mark the zenith with Z and the cardinal points with N, S, W, E.',
	'2. Mark the celestial pole with P.',
	'3. Mark the vernal equinox, or else the autumnal one.',
	'4. Draw the great circles of the celestial equator and of the ecliptic.',
	'5. Work out the sidereal time of the chart: __________',
	'6. Find the latitude it was taken at: __________',
	'7. Draw the outlines of all the constellations in sight.',
	'8. Mark on the chart the objects of the tables below.'
].join('\n');
const RU_TASKS = [
	'1. Обозначьте точку зенита символом Z и стороны света символами N, S, W, E.',
	'2. Обозначьте полюс мира символом P.',
	'3. Обозначьте точку весны или же точку осени.',
	'4. Проведите большие круги небесного экватора и эклиптики.',
	'5. Рассчитайте звёздное время скайчарта: __________',
	'6. Определите широту места съёмки: __________',
	'7. Проведите контуры всех видимых созвездий.',
	'8. Отметьте на скайчарте объекты из таблиц ниже.'
].join('\n');

describe('layTemplate', () => {
	/** The Pleiades, 20° across. */
	const PLEIADES: CloseUp = { name: 'M 45 · Pleiades', raDeg: 56.85, decDeg: 24.12, fovDeg: 20 };

	/** How many pages a template makes of `charts` charts: a finder card is one, and a page for each other chart. */
	function pagesOf(id: TemplateId, charts: number): number {
		if (id === 'charts') return 1;
		return id === 'pair' ? Math.ceil(charts / 2) : charts;
	}

	it('puts every chart of the page on a page, once, whatever the template and the turn', () => {
		const sources = [
			page([disc('a')]),
			page([disc('a'), frame('b')]),
			page([frame('a', 2.4), frame('b'), disc('c')]),
			page([disc('a'), disc('b'), disc('c'), frame('d'), frame('e', 0.7)])
		];
		for (const source of sources) {
			for (const { id } of TEMPLATES) {
				for (const orientation of ['portrait', 'landscape'] as const) {
					for (const swap of [false, true]) {
						const laid = layTemplate(id, source, { orientation, swap, closeUp: PLEIADES });
						const where = `${id} ${orientation} ${swap} ${source.items.length}`;
						expect(laid, where).toHaveLength(pagesOf(id, source.items.length));
						const own = laid.flatMap((part) =>
							part.charts.filter((placed) => !placed.chart).map((placed) => placed.id)
						);
						expect([...own].sort(), where).toEqual(source.items.map((it) => it.id).sort());
						// Only a finder card makes a chart, and it makes one.
						const made = laid.flatMap((part) => part.charts.filter((placed) => placed.chart));
						expect(made, where).toHaveLength(id === 'finder' ? 1 : 0);
						for (const part of laid) {
							expect(part.orientation).toBe(orientation);
							expect(part.dropped).toBeUndefined();
							expectSound(part, source);
						}
					}
				}
			}
		}
	});

	it('makes nothing of a page with no charts', () => {
		for (const { id } of TEMPLATES) expect(layTemplate(id, page([]))).toEqual([]);
	});

	it('lays charts alone out as the arranger does, with its layout and no text', () => {
		const source = page(
			[disc('a'), frame('b')],
			[
				{
					id: 't',
					role: 'title',
					text: 'Old',
					style: DEFAULT_TEXT_STYLE,
					frame: { x: 12, y: 12, w: 80, h: 6 }
				}
			]
		);
		const [laid, ...more] = layTemplate('charts', source);
		expect(more).toEqual([]);
		expect(laid.texts).toEqual([]);
		expect(laid.layout).toBeDefined();
		// Larger than they were, a gutter apart: the page is theirs.
		expect(laid.charts.find((placed) => placed.id === 'a')!.frame.w).toBeGreaterThan(90);
		expect(overlaps(laid.charts[0].frame, laid.charts[1].frame, GUTTER_MM)).toBe(false);
	});

	it('gives each chart a page under a title, its caption reading it', () => {
		const laid = layTemplate('caption', page([disc('a'), frame('b')]));
		expect(laid).toHaveLength(2);
		const [sky, close] = laid;
		expect(sky.texts.map((text) => [text.role, text.text, text.chartId])).toEqual([
			['title', 'Sky chart', undefined],
			['caption', 'Latitude {lat} · sidereal time {lst}', 'a']
		]);
		expect(close.texts[1]).toMatchObject({
			role: 'caption',
			text: 'Centre {ra}, {dec} · field {fov}',
			chartId: 'b'
		});
		// The caption is right under its chart, and centred on it.
		const chartFrame = sky.charts[0].frame;
		const caption = sky.texts[1];
		expect(caption.frame.y).toBeCloseTo(chartFrame.y + chartFrame.h + 2.5);
		expect(caption.style.align).toBe('center');
		expect(caption.frame.x + caption.frame.w / 2).toBeCloseTo(chartFrame.x + chartFrame.w / 2);
		// The title is at the top of the content box, the chart the width of it.
		expect(sky.texts[0].frame).toMatchObject({ x: 12, y: 12, w: 186 });
		expect(chartFrame.w).toBeCloseTo(186);
	});

	it('stands two skies whichever way shows them larger, and a third on the next page', () => {
		const stacked = layTemplate('pair', page([disc('a'), disc('b')]))[0];
		expect(stacked.charts[0].frame.x).toBeCloseTo(stacked.charts[1].frame.x);
		expect(stacked.charts[1].frame.y).toBeGreaterThan(stacked.charts[0].frame.y);
		const beside = layTemplate('pair', page([disc('a'), disc('b')]), {
			orientation: 'landscape'
		})[0];
		expect(beside.charts[0].frame.y).toBeCloseTo(beside.charts[1].frame.y);
		expect(beside.charts[1].frame.x).toBeGreaterThan(beside.charts[0].frame.x);
		// In their order on the page; swapped, in the other.
		expect(beside.charts.map((placed) => placed.id)).toEqual(['a', 'b']);
		const swapped = layTemplate('pair', page([disc('a'), disc('b')]), {
			orientation: 'landscape',
			swap: true
		})[0];
		expect(swapped.charts.map((placed) => placed.id)).toEqual(['b', 'a']);

		const three = layTemplate('pair', page([disc('a'), disc('b'), disc('c')]));
		expect(three.map((part) => part.charts.map((placed) => placed.id))).toEqual([
			['a', 'b'],
			['c']
		]);
		// The one left over has the page under the title to itself.
		expect(three[1].charts[0].frame.w).toBeGreaterThan(three[0].charts[0].frame.w);
	});

	it('makes a finder card of one sky: a close-up of the chosen object, its place ringed', () => {
		const [card, ...more] = layTemplate('finder', page([disc('sky')]), { closeUp: PLEIADES });
		expect(more).toEqual([]);
		const [wide, close] = card.charts;
		// The sky is the page's own chart, the larger of the two, over the close-up on a portrait page.
		expect(wide).toMatchObject({ id: 'sky' });
		expect(wide.chart).toBeUndefined();
		expect(close.frame.y).toBeGreaterThan(wide.frame.y + wide.frame.h);
		expect(wide.frame.w * wide.frame.h).toBeGreaterThan(close.frame.w * close.frame.h);
		// The place is ringed on it, as wide as the close-up's frame.
		expect(wide.marks).toEqual([{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }]);

		// The close-up is a chart of its own: that sky at that hour, the object in the middle.
		expect(close.closeUpOf).toBe('sky');
		expect(close.marks).toBeUndefined();
		const made = close.chart!;
		expect(made).toEqual(closeUpChart(chart(), PLEIADES));
		expect(made.view).toMatchObject({ projection: 'pinhole', pinholeFovDeg: 20 });
		expect(made.aspect).toBe(1.5);
		expect(made.createdAt).toBe(chart().createdAt);
		expect(made.layers).toEqual(chart().layers);
		expect(fieldValues(made)).toMatchObject({ ra: '3h 47m', dec: '+24°', fov: '20°' });

		// Each has its caption: the sky's own, and the object by name.
		expect(card.texts.map((text) => [text.role, text.chartId, text.text])).toEqual([
			['title', undefined, 'Finder card'],
			['caption', 'sky', 'Latitude {lat} · sidereal time {lst}'],
			['caption', close.id, 'M 45 · Pleiades · field {fov}']
		]);
		expect(close.id).not.toBe('sky');

		// Beside it on a landscape page.
		const [across] = layTemplate('finder', page([disc('sky')]), {
			orientation: 'landscape',
			closeUp: PLEIADES
		});
		expect(across.charts[1].frame.x).toBeGreaterThan(
			across.charts[0].frame.x + across.charts[0].frame.w
		);
		// With no object chosen yet it is the sky alone, unmarked.
		const [bare] = layTemplate('finder', page([disc('sky')]));
		expect(bare.charts).toHaveLength(1);
		expect(bare.charts[0].marks).toBeUndefined();
	});

	it('takes the first disc for the sky, and gives every other chart a page of its own', () => {
		const items = [frame('f1'), disc('d1'), disc('d2')];
		expect(finderSky(items)!.id).toBe('d1');
		expect(finderSky([frame('f1'), frame('f2')])!.id).toBe('f1');
		expect(finderSky([])).toBeUndefined();
		const laid = layTemplate('finder', page(items), { closeUp: PLEIADES });
		expect(laid.map((part) => part.charts.map((placed) => placed.id))).toEqual([
			['d1', 'close-up-of-d1'],
			['f1'],
			['d2']
		]);
		expect(laid[1].texts.map((text) => text.role)).toEqual(['title', 'caption']);
		// In the other order, the last disc is the sky.
		const swapped = layTemplate('finder', page(items), { closeUp: PLEIADES, swap: true });
		expect(swapped[0].charts[0].id).toBe('d2');
	});

	it('replaces the close-up a sky had with the new one, and never takes one for the sky', () => {
		const old: DocItem = { ...frame('old', 1.5), closeUpOf: 'sky' };
		const stray: DocItem = { ...frame('stray', 1.5), closeUpOf: 'elsewhere' };
		expect(finderSky([old, disc('sky')])!.id).toBe('sky');
		// A page of nothing but close-ups still has a sky to offer.
		expect(finderSky([old])!.id).toBe('old');
		const laid = layTemplate('finder', page([old, disc('sky'), stray]), { closeUp: PLEIADES });
		expect(laid[0].dropped).toEqual(['old']);
		expect(laid.map((part) => part.charts.map((placed) => placed.id))).toEqual([
			['sky', 'close-up-of-sky'],
			['stray']
		]);
		// Until an object is chosen nothing is dropped: the old close-up goes on as a chart.
		const bare = layTemplate('finder', page([old, disc('sky')]));
		expect(bare[0].dropped).toBeUndefined();
		expect(bare).toHaveLength(2);
	});

	it('knows what is on a chart: within its field, a little in from the edge', () => {
		// The identity looks where its forward axis points; a place there is on any chart.
		const view = chart().view;
		const centre = fieldValues({ ...chart(), view: { ...view, projection: 'pinhole' } });
		const raDeg =
			(Number(centre.ra.split('h')[0]) + Number(centre.ra.split(' ')[1].slice(0, 2)) / 60) * 15;
		const decDeg = Number(centre.dec.replace('−', '-').replace('°', ''));
		const sky = { ...chart(), view: { ...view, stereoFovDeg: 120 } };
		expect(isOnChart(sky, raDeg, decDeg)).toBe(true);
		const toward = (away: number) =>
			decDeg + away <= 90 ? [raDeg, decDeg + away] : [raDeg + 180, 180 - decDeg - away];
		expect(isOnChart(sky, toward(50)[0], toward(50)[1])).toBe(true);
		// 60° is the edge of a 120° chart; the last 8 % of the way there is left out.
		expect(isOnChart(sky, toward(57)[0], toward(57)[1])).toBe(false);
		expect(isOnChart(sky, toward(120)[0], toward(120)[1])).toBe(false);
		const narrow = { ...chart(1.6), view: { ...chart(1.6).view, pinholeFovDeg: 40 } };
		expect(isOnChart(narrow, toward(15)[0], toward(15)[1])).toBe(true);
		expect(isOnChart(narrow, toward(25)[0], toward(25)[1])).toBe(false);
	});

	it('makes a worksheet: a header and a number, the tasks, two tables, the chart, the key upside down', () => {
		const sheets = layTemplate('sheet', page([disc('a'), frame('b')]));
		const parts = ['header', 'number', 'tasks', 'stars', 'messier', 'key'];
		expect(sheets.map((sheet) => sheet.texts.map((text) => text.role))).toEqual([parts, parts]);
		expect(sheets.map((sheet) => sheet.texts[1].text)).toEqual(['№ 1', '№ 2']);
		const [header, number, tasks, stars, messier, key] = sheets[0].texts;
		// SkyGen's tasks, and under them the names to find: the stars on the left, Messier on the right.
		expect(tasks.text).toBe(EN_TASKS);
		expect(stars).toMatchObject({
			text: '',
			chartId: 'a',
			table: { source: 'stars', look: 'names', rows: 4 }
		});
		expect(messier).toMatchObject({
			chartId: 'a',
			table: { source: 'messier', look: 'names', rows: 4 }
		});
		expect(stars.frame.y).toBeGreaterThan(tasks.frame.y + tasks.frame.h);
		expect(messier.frame.y).toBe(stars.frame.y);
		expect(stars.frame.x).toBe(12);
		expect(messier.frame.x + messier.frame.w).toBeCloseTo(198);
		expect(messier.frame.x).toBeGreaterThan(stars.frame.x + stars.frame.w);
		// As tall as a title and four rows of names.
		expect(stars.frame.h).toBeCloseTo(5 * 10 * MM_PER_PT * LINE_HEIGHT);
		expect(header.frame.y).toBe(12);
		expect(number.style.align).toBe('right');
		expect(number.frame.x + number.frame.w).toBe(198);
		expect(tasks.frame.y).toBeGreaterThan(header.frame.y + header.frame.h);
		expect(tasks.text.split('\n')).toHaveLength(8);
		// The key at the foot, in the corner, upside down, reading its own chart.
		expect(key).toMatchObject({ rotation: 180, chartId: 'a', text: '{lat} · {lst}' });
		expect(key.frame.y + key.frame.h).toBeCloseTo(285);
		expect(key.frame.x + key.frame.w).toBeCloseTo(198);
		expect(sheets[1].texts[5]).toMatchObject({ chartId: 'b', text: '{ra} {dec}' });
		expect(sheets[1].texts[3]).toMatchObject({ chartId: 'b', table: { source: 'stars' } });
		// The chart between the tables and the key.
		const chartFrame = sheets[0].charts[0].frame;
		expect(chartFrame.y).toBeGreaterThan(stars.frame.y + stars.frame.h);
		expect(chartFrame.y + chartFrame.h).toBeLessThan(key.frame.y);
	});

	it('keeps what was typed in a text for the same part, and leaves stock words behind', () => {
		const style = { ...DEFAULT_TEXT_STYLE, font: 'sans' as const, size: 20 };
		const at = { x: 12, y: 12, w: 80, h: 6 };
		const texts: DocText[] = [
			{ id: 't1', role: 'title', text: 'Сборная Москвы', style, frame: at },
			{ id: 't2', role: 'caption', chartId: 'a', text: 'Мой круг', style, frame: at },
			{
				id: 't3',
				role: 'caption',
				chartId: 'b',
				text: 'Centre {ra}, {dec} · field {fov}',
				style,
				frame: at
			},
			{ id: 't4', text: 'A note of my own', style, frame: at }
		];
		const [left] = layTemplate('pair', page([disc('a'), frame('b')], texts));
		const says = (role: string, chartId?: string) =>
			left.texts.find((text) => text.role === role && text.chartId === chartId)!;
		// The title and the typed caption carry over, in the face they were set in.
		expect(says('title')).toMatchObject({ text: 'Сборная Москвы', style });
		expect(says('caption', 'a')).toMatchObject({ text: 'Мой круг', style });
		// A stock caption is not kept as typed: it is written afresh, in the template's own face.
		expect(says('caption', 'b').text).toBe('Centre {ra}, {dec} · field {fov}');
		expect(says('caption', 'b').style.font).toBe('serif');
		// The page's own note is not the template's to place.
		expect(left.texts.some((text) => text.text === 'A note of my own')).toBe(false);

		// A sheet's number is its place in the run, whatever the last one said.
		const numbered: DocText[] = [{ id: 'n', role: 'number', text: '№ 7', style, frame: at }];
		const sheets = layTemplate('sheet', page([disc('a'), disc('b')], numbered));
		expect(sheets.map((sheet) => sheet.texts[1].text)).toEqual(['№ 1', '№ 2']);
	});

	it('writes its words in Russian when told to, in English untold, and lays both out alike', () => {
		const source = page([disc('a'), frame('b')]);
		const words = (laid: LaidPage[]) => laid.map((part) => part.texts.map((text) => text.text));
		const ru = (id: TemplateId) => layTemplate(id, source, { language: 'ru', closeUp: PLEIADES });
		expect(words(ru('caption'))).toEqual([
			['Карта неба', 'Широта {lat} · звёздное время {lst}'],
			['Карта неба', 'Центр {ra}, {dec} · поле {fov}']
		]);
		expect(words(ru('pair'))).toEqual([
			['Два неба', 'Широта {lat} · звёздное время {lst}', 'Центр {ra}, {dec} · поле {fov}']
		]);
		// An object's name is the catalogue's; what follows it is the template's.
		expect(words(ru('finder'))).toEqual([
			['Поисковая карта', 'Широта {lat} · звёздное время {lst}', 'M 45 · Pleiades · поле {fov}'],
			['Карта неба', 'Центр {ra}, {dec} · поле {fov}']
		]);
		// The two tables have no words of their own: they are read from the chart.
		const name = 'Фамилия, имя ______________________   Класс ________';
		expect(words(ru('sheet'))).toEqual([
			[name, '№ 1', RU_TASKS, '', '', '{lat} · {lst}'],
			[name, '№ 2', RU_TASKS, '', '', '{ra} {dec}']
		]);
		// And are set in the template's language.
		expect(ru('sheet')[0].texts[3].table).toMatchObject({ source: 'stars', language: 'ru' });
		expect(layTemplate('sheet', source)[0].texts[3].table).not.toHaveProperty('language');
		expect(words(ru('charts'))).toEqual([[]]);

		const fields = (text: string) => text.match(/\{[a-z]+\}/g) ?? [];
		for (const { id } of TEMPLATES) {
			const untold = layTemplate(id, source, { closeUp: PLEIADES });
			const english = layTemplate(id, source, { language: 'en', closeUp: PLEIADES });
			expect(english, id).toEqual(untold);
			// The same parts in the same places, reading the same fields of the same charts.
			const russian = ru(id);
			const shape = (laid: LaidPage[]) =>
				laid.map((part) => ({
					...part,
					template: part.template?.id,
					// A table's language is its words', like a text's: apart from it, the same table.
					texts: part.texts.map(({ text, table, ...rest }) => ({
						...rest,
						fields: fields(text),
						table: table && { source: table.source, look: table.look, rows: table.rows }
					}))
				}));
			expect(shape(russian), id).toEqual(shape(english));
			// Each page says which language it was written in, for a turn to keep to.
			const told = id === 'charts' ? undefined : 'ru';
			expect(
				russian.map((part) => part.template?.language),
				id
			).toEqual(russian.map(() => told));
			// And not a word of the one in the other, but for the keys and numbers they share.
			const said = (laid: LaidPage[]) =>
				laid.flatMap((part) =>
					// (And for the tables, whose words are read from the chart.)
					part.texts.filter((text) => !['key', 'number'].includes(text.role) && !text.table)
				);
			for (const [i, text] of said(russian).entries()) {
				expect(text.text, id).not.toBe(said(english)[i].text);
				expect(text.text, id).toMatch(/[а-я]/);
				expect(said(english)[i].text, id).not.toMatch(/[а-яё]/i);
			}
		}
	});

	it('writes afresh in the new language what a template wrote, and keeps what was typed', () => {
		const style = { ...DEFAULT_TEXT_STYLE, size: 20 };
		const onPage = (laid: LaidPage, typed: Record<number, string> = {}): DocText[] =>
			laid.texts.map((text, i) => ({
				...text,
				id: `t${i}`,
				...(i in typed ? { text: typed[i], style } : {})
			}));
		const says = (laid: LaidPage) => laid.texts.map((text) => text.text);

		// A caption page as English left it, laid out in Russian, and back.
		const one = [disc('a')];
		const [english] = layTemplate('caption', page(one));
		const [russian] = layTemplate('caption', page(one, onPage(english)), { language: 'ru' });
		expect(says(russian)).toEqual(['Карта неба', 'Широта {lat} · звёздное время {lst}']);
		const [back] = layTemplate('caption', page(one, onPage(russian)), { language: 'en' });
		expect(back).toEqual(english);
		// Under another template too: its title is that template's, in the language asked for.
		const [pair] = layTemplate('pair', page(one, onPage(russian)), { language: 'en' });
		expect(says(pair)).toEqual(['Two skies', 'Latitude {lat} · sidereal time {lst}']);

		// A title that was typed over stays, in the face it was set in; the caption beside it is rewritten.
		const typed = onPage(english, { 0: 'Orion in winter' });
		const [kept] = layTemplate('caption', page(one, typed), { language: 'ru' });
		expect(says(kept)).toEqual(['Orion in winter', 'Широта {lat} · звёздное время {lst}']);
		expect(kept.texts[0].style).toEqual(style);
		expect(kept.texts[1].style).toEqual(english.texts[1].style);

		// A worksheet: the header and the tasks are a template's words like any other.
		const [sheet] = layTemplate('sheet', page(one), { language: 'ru' });
		const [plain] = layTemplate('sheet', page(one, onPage(sheet)));
		expect(says(plain)).toEqual([
			'Name ______________________   Class ________',
			'№ 1',
			EN_TASKS,
			'',
			'',
			'{lat} · {lst}'
		]);
		const own = onPage(sheet, { 2: '1. Найдите Полярную звезду.' });
		const [mine] = layTemplate('sheet', page(one, own));
		expect(says(mine)[0]).toBe('Name ______________________   Class ________');
		expect(says(mine)[2]).toBe('1. Найдите Полярную звезду.');
		expect(mine.texts[2].style).toEqual(style);
	});

	it('keeps the name in a close-up’s caption and puts the words after it in the language', () => {
		const [card] = layTemplate('finder', page([disc('sky')]), { closeUp: PLEIADES });
		// The card as the document holds it: the close-up a chart of the page, its caption reading it.
		const closeUp: DocItem = { ...frame('made', 1.5), closeUpOf: 'sky' };
		const texts: DocText[] = card.texts.map((text, i) => ({
			...text,
			id: `t${i}`,
			...(text.chartId === card.charts[1].id ? { chartId: 'made' } : {})
		}));
		const caption = (laid: LaidPage[]) =>
			laid.flatMap((part) => part.texts).find((text) => text.chartId === 'made')!.text;
		const source = page([disc('sky'), closeUp], texts);
		expect(caption(layTemplate('caption', source, { language: 'ru' }))).toBe(
			'M 45 · Pleiades · поле {fov}'
		);
		expect(caption(layTemplate('caption', source))).toBe('M 45 · Pleiades · field {fov}');
		// A name that was typed over is a name still.
		texts[2].text = 'Плеяды · field {fov}';
		expect(caption(layTemplate('pair', source, { language: 'ru' }))).toBe('Плеяды · поле {fov}');
		// A caption of other words altogether is left as it is.
		texts[2].text = 'Семь сестёр, {fov}';
		expect(caption(layTemplate('pair', source, { language: 'en' }))).toBe('Семь сестёр, {fov}');
	});

	/**
	 * A laid page as the document holds it: the charts in their frames (a made one
	 * under the id `made`, with the text that reads it pointed there), the ring on the
	 * sky, and the text with ids.
	 */
	function held(laid: LaidPage, source: DocPage): DocPage {
		const idOf = (id: string | undefined) => (id?.startsWith('close-up-of-') ? 'made' : id);
		const items = laid.charts.map((placed): DocItem => {
			const own = source.items.find((it) => it.id === placed.id);
			const item: DocItem = {
				...own,
				id: idOf(placed.id)!,
				chart: { ...(placed.chart ?? own!.chart) },
				frame: placed.frame
			};
			if (placed.marks) item.chart.marks = placed.marks;
			else delete item.chart.marks;
			if (placed.closeUpOf) item.closeUpOf = placed.closeUpOf;
			return item;
		});
		const texts = laid.texts.map((text, i): DocText => {
			const made: DocText = { ...text, id: `t${i}` };
			if (text.chartId) made.chartId = idOf(text.chartId);
			return made;
		});
		const made: DocPage = { id: 'p', orientation: laid.orientation, items, texts };
		if (laid.template) made.template = laid.template;
		return made;
	}

	it('says which template made each page, for the page to remember', () => {
		const source = page([frame('f1'), disc('d1'), disc('d2')]);
		const made = (id: TemplateId, swap = false) =>
			layTemplate(id, source, { closeUp: PLEIADES, swap }).map((part) => part.template);
		const en = (id: string) => ({ id, language: 'en' });
		expect(made('caption')).toEqual([en('caption'), en('caption'), en('caption')]);
		expect(made('pair')).toEqual([en('pair'), en('pair')]);
		expect(made('sheet')).toEqual([en('sheet'), en('sheet'), en('sheet')]);
		// A finder card is the first page; the charts it sends on are caption pages like any other.
		expect(made('finder')).toEqual([en('finder'), en('caption'), en('caption')]);
		// The arranger's own layout is no template, and the order of the charts is the page's by then.
		expect(made('charts')).toEqual([undefined]);
		expect(made('pair', true)).toEqual([en('pair'), en('pair')]);
	});

	it('lays a page out again as it is: the same on the same page, the template’s on a turned one', () => {
		const source = page([disc('a'), frame('b'), disc('c')]);
		for (const { id } of TEMPLATES) {
			if (id === 'charts') continue;
			for (const first of ['portrait', 'landscape'] as const) {
				const other = first === 'portrait' ? 'landscape' : 'portrait';
				for (const swap of [false, true]) {
					const where = `${id} ${first} ${swap}`;
					const options = { orientation: first, swap, closeUp: PLEIADES };
					const laid = layTemplate(id, source, options);
					// As the template would have laid them for the other orientation to begin with.
					const direct = layTemplate(id, source, { ...options, orientation: other });
					for (const [i, part] of laid.entries()) {
						const made = held(part, source);
						const same = layTemplate(part.template!.id, made, { again: true });
						expect(same, where).toHaveLength(1);
						expect(held(same[0], made), where).toEqual(made);

						const turned = layTemplate(part.template!.id, made, {
							again: true,
							orientation: other
						});
						expect(turned, where).toHaveLength(1);
						expect(held(turned[0], made), where).toEqual(held(direct[i], source));
						expectSound(turned[0], made);

						// And back: the page it was.
						const there = held(turned[0], made);
						const back = layTemplate(part.template!.id, there, { again: true, orientation: first });
						expect(held(back[0], there), where).toEqual(made);
					}
				}
			}
		}
	});

	it('keeps the close-up a finder card has, and the ring, when it is laid out again as it is', () => {
		const source = page([disc('sky')]);
		const [card] = layTemplate('finder', source, { closeUp: PLEIADES });
		const made = held(card, source);
		expect(made.items.map((item) => [item.id, item.closeUpOf])).toEqual([
			['sky', undefined],
			['made', 'sky']
		]);

		const [again, ...more] = layTemplate('finder', made, { again: true, orientation: 'landscape' });
		expect(more).toEqual([]);
		// The page's own two charts: nothing made, nothing dropped, the ring where it was.
		expect(again.charts.map((placed) => [placed.id, placed.chart, placed.closeUpOf])).toEqual([
			['sky', undefined, undefined],
			['made', undefined, undefined]
		]);
		expect(again.dropped).toBeUndefined();
		expect(again.charts[0].marks).toEqual([{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }]);
		expect(again.charts[0].marks).not.toBe(made.items[0].chart.marks);
		expect(again.charts[1].marks).toBeUndefined();
		// Side by side now, the caption still naming the object and reading the close-up.
		expect(again.charts[1].frame.x).toBeGreaterThan(
			again.charts[0].frame.x + again.charts[0].frame.w
		);
		expect(again.texts.map((text) => [text.role, text.chartId, text.text])).toEqual([
			['title', undefined, 'Finder card'],
			['caption', 'sky', 'Latitude {lat} · sidereal time {lst}'],
			['caption', 'made', 'M 45 · Pleiades · field {fov}']
		]);

		// Not told it is the same card, the close-up is one more chart, and goes on a page of its own.
		const anew = layTemplate('finder', made, { orientation: 'landscape' });
		expect(anew.map((part) => part.charts.map((placed) => placed.id))).toEqual([['sky'], ['made']]);
		// An object chosen replaces the close-up, laid out again or not.
		const andromeda = { name: 'M 31', raDeg: 10.68, decDeg: 41.27, fovDeg: 40 };
		const [replaced] = layTemplate('finder', made, { again: true, closeUp: andromeda });
		expect(replaced.dropped).toEqual(['made']);
		expect(replaced.charts[1]).toMatchObject({ id: 'close-up-of-sky', closeUpOf: 'sky' });
		expect(replaced.charts[0].marks).toEqual([{ raDeg: 10.68, decDeg: 41.27, radiusDeg: 20 }]);
		// A card with no close-up yet is its sky alone, again as before.
		const [bare] = layTemplate('finder', source);
		const [still] = layTemplate('finder', held(bare, source), { again: true });
		expect(still.charts.map((placed) => placed.id)).toEqual(['sky']);
	});

	it('keeps every word and face of a page laid out again as it is, a sheet’s number too', () => {
		const source = page([disc('a'), disc('b')]);
		const second = held(layTemplate('sheet', source, { language: 'ru' })[1], source);
		expect(second.texts!.map((text) => text.text)[1]).toBe('№ 2');
		// The header's face changed and not its words; the tasks typed over.
		const big = { ...second.texts![0].style, size: 20 };
		second.texts![0].style = big;
		second.texts![2].text = 'Найдите Вегу.';
		const [again] = layTemplate('sheet', second, {
			again: true,
			language: 'ru',
			orientation: 'landscape'
		});
		expect(again.texts.map((text) => text.text)).toEqual([
			'Фамилия, имя ______________________   Класс ________',
			'№ 2',
			'Найдите Вегу.',
			'',
			'',
			'{lat} · {lst}'
		]);
		expect(again.texts[0].style).toEqual(big);
		// Laid out by the template afresh, the stock header is the template's and the sheet the first.
		const [afresh] = layTemplate('sheet', second, { language: 'ru' });
		expect(afresh.texts[0].style.size).toBe(12);
		expect(afresh.texts[1].text).toBe('№ 1');
		expect(afresh.texts[2].text).toBe('Найдите Вегу.');
	});

	it('takes a text to be as tall as the lines it was typed in when it has no measure', () => {
		const [sheet] = layTemplate('sheet', page([disc('a')]));
		const line = (size: number) => size * MM_PER_PT * LINE_HEIGHT;
		const [header, , tasks] = sheet.texts;
		expect(header.frame.h).toBeCloseTo(line(12));
		expect(tasks.frame.h).toBeCloseTo(8 * line(11));
		// The chart starts under all eight tasks, and the tables under them.
		expect(sheet.charts[0].frame.y).toBeGreaterThanOrEqual(tasks.frame.y + 8 * line(11) + 6 - 1e-6);
	});

	it('makes room for text as tall as it is measured', () => {
		// Every text three times the height of its line: the charts give way.
		const tall = layTemplate('caption', page([disc('a')]), { height: (_t, style) => style.size });
		const short = layTemplate('caption', page([disc('a')]));
		expect(tall[0].texts[0].frame.h).toBe(16);
		expect(tall[0].charts[0].frame.y).toBeGreaterThan(short[0].charts[0].frame.y);
		expectSound(tall[0], page([disc('a')]));
	});
});
