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
import { DEFAULT_TEXT_STYLE } from './text';
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

	it('makes a worksheet: a header and a number, the tasks, the chart, the key upside down', () => {
		const sheets = layTemplate('sheet', page([disc('a'), frame('b')]));
		expect(sheets.map((sheet) => sheet.texts.map((text) => text.role))).toEqual([
			['header', 'number', 'tasks', 'key'],
			['header', 'number', 'tasks', 'key']
		]);
		expect(sheets.map((sheet) => sheet.texts[1].text)).toEqual(['№ 1', '№ 2']);
		const [header, number, tasks, key] = sheets[0].texts;
		expect(header.frame.y).toBe(12);
		expect(number.style.align).toBe('right');
		expect(number.frame.x + number.frame.w).toBe(198);
		expect(tasks.frame.y).toBeGreaterThan(header.frame.y + header.frame.h);
		expect(tasks.text.split('\n')).toHaveLength(3);
		// The key at the foot, in the corner, upside down, reading its own chart.
		expect(key).toMatchObject({ rotation: 180, chartId: 'a', text: '{lat} · {lst}' });
		expect(key.frame.y + key.frame.h).toBeCloseTo(285);
		expect(key.frame.x + key.frame.w).toBeCloseTo(198);
		expect(sheets[1].texts[3]).toMatchObject({ chartId: 'b', text: '{ra} {dec}' });
		// The chart between the tasks and the key.
		const chartFrame = sheets[0].charts[0].frame;
		expect(chartFrame.y).toBeGreaterThan(tasks.frame.y + tasks.frame.h);
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

	it('makes room for text as tall as it is measured', () => {
		// Every text three times the height of its line: the charts give way.
		const tall = layTemplate('caption', page([disc('a')]), { height: (_t, style) => style.size });
		const short = layTemplate('caption', page([disc('a')]));
		expect(tall[0].texts[0].frame.h).toBe(16);
		expect(tall[0].charts[0].frame.y).toBeGreaterThan(short[0].charts[0].frame.y);
		expectSound(tall[0], page([disc('a')]));
	});
});
