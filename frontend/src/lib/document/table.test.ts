import { describe, expect, it } from 'vitest';
import { pointingToOrientation } from '$lib/math/pointing';
import type { CatalogStar, MessierObject } from '$lib/api/catalog-types';
import { constellationName, starName } from './sky-names';
import {
	blockLayout,
	fullTableHeight,
	isInChart,
	layoutTable,
	lookOf,
	narrowestTableWidth,
	MAX_TABLE_ROWS,
	tableContent,
	tableName,
	tableWidth,
	type Sky,
	type TableContent
} from './table';
import { DEFAULT_TEXT_STYLE, FONT_METRICS, LINE_HEIGHT, MM_PER_PT } from './text';
import type { ChartBlock, ChartSnapshot, TableBlock, TableSpec } from './types';

const DEG = Math.PI / 180;

/** A chart looking at (`raDeg`, `decDeg`), north up. */
function chart(
	raDeg: number,
	decDeg: number,
	view: Partial<ChartSnapshot['view']> = {}
): ChartSnapshot {
	return {
		view: {
			projection: 'stereographic',
			orientation: pointingToOrientation({ raDeg, decDeg, paDeg: 0 }),
			stereoFovDeg: 120,
			pinholeFovDeg: 40,
			pinholeAspectRatio: 2,
			pinholeHeightFrac: 1.18,
			...view
		},
		layers: {
			constellations: true,
			constellationBoundaries: false,
			equator: false,
			ecliptic: false,
			galacticEquator: false,
			planets: false
		},
		aspect: view.projection === 'pinhole' ? 2 : 1,
		createdAt: '2026-10-27T12:00:00.000Z'
	};
}

function at(raDeg: number, decDeg: number): [number, number, number] {
	const c = Math.cos(decDeg * DEG);
	return [c * Math.cos(raDeg * DEG), c * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
}

const object = (
	m: number,
	ra_deg: number,
	dec_deg: number,
	mag: number,
	name = ''
): MessierObject => ({ m, name, kind: 'Open Cluster', constellation: 'Tau', mag, ra_deg, dec_deg });

const star = (raHours: number, decDeg: number, v_mag: number): CatalogStar => ({
	ra: raHours * 15 * DEG,
	dec: decDeg * DEG,
	v_mag
});

/** Every character half a font size wide. */
const measure = (text: string) => Array.from(text).length / 2;

describe('isInChart', () => {
	it('is the disc of a stereographic chart, to its edge', () => {
		const sky = chart(90, 0);
		expect(isInChart(sky, ...at(90, 0))).toBe(true);
		expect(isInChart(sky, ...at(90, 59))).toBe(true);
		expect(isInChart(sky, ...at(149, 0))).toBe(true);
		expect(isInChart(sky, ...at(90, 61))).toBe(false);
		expect(isInChart(sky, ...at(270, 0))).toBe(false);
	});

	it('is the frame of a pinhole chart: its field across, less of it up and down', () => {
		const frame = chart(90, 0, { projection: 'pinhole' });
		expect(isInChart(frame, ...at(90, 0))).toBe(true);
		// 40° across: 19° to the side is in, 21° is out.
		expect(isInChart(frame, ...at(109, 0))).toBe(true);
		expect(isInChart(frame, ...at(111, 0))).toBe(false);
		// Twice as wide as high: the frame ends 10.3° up (atan(tan 20° / 2)).
		expect(isInChart(frame, ...at(90, 10))).toBe(true);
		expect(isInChart(frame, ...at(90, 11))).toBe(false);
		// Behind the camera is not in it, though its tangent would say so.
		expect(isInChart(frame, ...at(270, 0))).toBe(false);
	});
});

describe('names', () => {
	it('gives the constellations in full', () => {
		expect(constellationName('Ori')).toBe('Orion');
		expect(constellationName('CVn')).toBe('Canes Venatici');
		expect(constellationName('Xyz')).toBe('Xyz');
	});

	it('names a bright star by its place, once', () => {
		const taken = new Set<string>();
		const sirius = star(6.752, -16.716, -1.44);
		expect(starName(sirius.ra, sirius.dec, taken)).toBe('Sirius');
		// A companion as near gets no name: the brighter, met first, has it.
		expect(starName(sirius.ra + 0.001, sirius.dec, taken)).toBeNull();
		const vega = star(18.616, 38.784, 0.03);
		expect(starName(vega.ra, vega.dec, taken)).toBe('Vega');
		// A star of no fame, and a place a degree off a famous one.
		expect(starName(star(3, 3, 5).ra, star(3, 3, 5).dec, new Set())).toBeNull();
		expect(starName(vega.ra, vega.dec + 1 * DEG, new Set())).toBeNull();
		// Polaris, where right ascension means little.
		const polaris = star(2.53, 89.264, 1.97);
		expect(starName(polaris.ra + 0.2, polaris.dec, new Set())).toBe('Polaris');
		// In Russian, by the name it goes by there; taken all the same, whatever it was called.
		const again = new Set<string>();
		expect(starName(vega.ra, vega.dec, again, 'ru')).toBe('Вега');
		expect(starName(vega.ra, vega.dec, again)).toBeNull();
		expect(
			starName(star(14.66, -60.834, -0.01).ra, star(14.66, -60.834, -0.01).dec, again, 'ru')
		).toBe('Альфа Центавра');
	});
});

describe('tableContent', () => {
	// Betelgeuse, Rigel, Sirius and a star of no name on the chart; Vega off it.
	const sky: Sky = {
		messier: [
			object(1, 95, 5, 8.4, 'Crab Nebula'),
			object(45, 85, 10, 1.6, 'Pleiades'),
			object(31, 300, 40, 3.4, 'Andromeda Galaxy'),
			object(41, 100, -20, 4.5),
			object(35, 92, 24, 5.1)
		],
		stars: [
			star(5.919, 7.407, 0.5),
			star(5.242, -8.202, 0.2),
			star(6.752, -16.716, -1.44),
			star(18.616, 38.784, 0.0),
			star(6.2, 2, 3.9)
		]
	};
	const sheet = chart(90, 0);

	it('lists the names alone, three to a row, brightest first: the look of a SkyGen worksheet', () => {
		const content = tableContent(sheet, { source: 'messier', look: 'names', rows: 5 }, sky);
		expect(content.title).toBe('Messier objects');
		expect(content.header).toBeNull();
		expect(content.align).toEqual(['center', 'center', 'center']);
		// M 31 is on the other side of the sky.
		expect(content.rows).toEqual([['M 45', 'M 41', 'M 35'], ['M 1']]);
		expect(content.note).toBeUndefined();
		// No look said is this look.
		expect(tableContent(sheet, { source: 'messier', rows: 5 }, sky)).toEqual(content);
		expect(lookOf({ source: 'messier', rows: 5 })).toBe('names');
	});

	it('lists of the stars those with a name', () => {
		const content = tableContent(sheet, { source: 'stars', look: 'names', rows: 5 }, sky);
		expect(content.title).toBe('Stars');
		expect(content.rows).toEqual([['Sirius', 'Rigel', 'Betelgeuse']]);
	});

	it('lists three names a row, as many rows as it is told, within its limits', () => {
		const many: Sky = {
			messier: Array.from({ length: 200 }, (_, i) => object(i + 1, 90, 0, i / 10)),
			stars: []
		};
		const rows = (count: number, look: 'names' | 'details') =>
			tableContent(sheet, { source: 'messier', look, rows: count }, many).rows;
		expect(rows(2, 'names')).toEqual([
			['M 1', 'M 2', 'M 3'],
			['M 4', 'M 5', 'M 6']
		]);
		expect(rows(0, 'names')).toHaveLength(1);
		expect(rows(500, 'names')).toHaveLength(MAX_TABLE_ROWS);
		expect(rows(2.6, 'details')).toHaveLength(3);
		expect(rows(500, 'details')).toHaveLength(MAX_TABLE_ROWS);
	});

	it('details the Messier objects: name, type, constellation in full, magnitude', () => {
		const content = tableContent(sheet, { source: 'messier', look: 'details', rows: 3 }, sky);
		expect(content.header).toEqual(['Object', 'Name', 'Type', 'Constellation', 'Mag']);
		expect(content.align).toEqual(['left', 'left', 'left', 'left', 'right']);
		// One with no name has an empty cell, not a mark that means nothing.
		expect(content.rows).toEqual([
			['M 45', 'Pleiades', 'Open Cluster', 'Taurus', '1.6'],
			['M 41', '', 'Open Cluster', 'Taurus', '4.5'],
			['M 35', '', 'Open Cluster', 'Taurus', '5.1']
		]);
	});

	it('details the stars: their names where they have one, their places, a true minus', () => {
		const content = tableContent(sheet, { source: 'stars', look: 'details', rows: 10 }, sky);
		expect(content.header).toEqual(['№', 'Name', 'RA', 'Dec', 'Mag']);
		expect(content.align).toEqual(['right', 'left', 'right', 'right', 'right']);
		expect(content.rows).toEqual([
			['1', 'Sirius', '6h 45.1m', '−16° 43′', '−1.4'],
			['2', 'Rigel', '5h 14.5m', '−08° 12′', '0.2'],
			['3', 'Betelgeuse', '5h 55.1m', '+07° 24′', '0.5'],
			['4', '', '6h 12.0m', '+02° 00′', '3.9']
		]);
	});

	it('sets its words in Russian when told to: title, header, kinds and constellations', () => {
		const names = tableContent(sheet, { source: 'stars', rows: 5, language: 'ru' }, sky);
		expect(names.title).toBe('Звёзды');
		// The stars by the names they go by in Russian.
		expect(names.rows).toEqual([['Сириус', 'Ригель', 'Бетельгейзе']]);
		const details = tableContent(
			sheet,
			{ source: 'messier', look: 'details', rows: 1, language: 'ru' },
			sky
		);
		expect(details.title).toBe('Объекты Мессье');
		expect(details.header).toEqual(['Объект', 'Название', 'Тип', 'Созвездие', 'Зв. вел.']);
		expect(details.rows).toEqual([['M 45', 'Pleiades', 'Рассеянное скопление', 'Телец', '1.6']]);
		expect(tableContent(null, { source: 'stars', rows: 5, language: 'ru' }, sky).note).toBe(
			'Нет скайчарта'
		);
		// English is what it says untold.
		expect(tableContent(sheet, { source: 'stars', rows: 5, language: 'en' }, sky)).toEqual(
			tableContent(sheet, { source: 'stars', rows: 5 }, sky)
		);
		expect(constellationName('UMa', 'ru')).toBe('Большая Медведица');
	});

	it('knows how tall a table is with all its rows, before any chart is read', () => {
		const style = { ...DEFAULT_TEXT_STYLE, size: 10 };
		const line = 10 * MM_PER_PT * LINE_HEIGHT;
		expect(fullTableHeight({ source: 'stars', rows: 4 }, style)).toBeCloseTo(5 * line);
		expect(fullTableHeight({ source: 'stars', look: 'details', rows: 4 }, style)).toBeCloseTo(
			6.9 * line
		);
		// As tall as it is laid out with that many rows to list.
		const many: Sky = {
			messier: Array.from({ length: 30 }, (_, i) => object(i + 1, 90, 0, i / 10)),
			stars: []
		};
		for (const look of ['names', 'details'] as const) {
			const spec = { source: 'messier' as const, look, rows: 4 };
			const laid = layoutTable(tableContent(sheet, spec, many), style, 150, measure);
			expect(laid.height).toBeCloseTo(fullTableHeight(spec, style));
		}
	});

	it('says why it has nothing to list, under its title', () => {
		const none = { messier: [], stars: [] };
		const far = chart(200, -60, { stereoFovDeg: 20 });
		for (const look of ['names', 'details'] as const) {
			const of = (source: 'messier' | 'stars', from: Sky, read: ChartSnapshot | null) =>
				tableContent(read, { source, look, rows: 5 }, from);
			expect(of('messier', sky, null)).toMatchObject({ rows: [], note: 'No chart to read' });
			expect(of('messier', none, sheet).note).toBe('The catalogue is not loaded');
			expect(of('messier', sky, far).note).toBe('None on this chart');
			expect(of('stars', none, sheet).note).toBe('The catalogue is not loaded');
			expect(of('stars', sky, far).note).toBe('None on this chart');
			expect(of('stars', sky, far).title).toBe('Stars');
		}
	});
});

describe('layoutTable', () => {
	const style = { ...DEFAULT_TEXT_STYLE, size: 10 };
	const size = 10 * MM_PER_PT;
	const lineHeight = size * LINE_HEIGHT;
	const { ascent, descent } = FONT_METRICS.serif;
	const first = ((LINE_HEIGHT - ascent - descent) / 2 + ascent) * size;

	describe('of names', () => {
		const names: TableContent = {
			title: 'Stars',
			header: null,
			align: ['center', 'center', 'center'],
			rows: [['Sirius', 'Rigel', 'Betelgeuse'], ['Vega']]
		};
		// Three columns as wide as the longest name, 5 sizes: 15 in all, and two gaps.
		const wide = 30 * size;

		it('sets the title in bold in the middle, and each name in the middle of its column', () => {
			const layout = layoutTable(names, style, wide, measure);
			expect(layout.lines.map((line) => line.text)).toEqual([
				'Stars',
				'Sirius',
				'Rigel',
				'Betelgeuse',
				'Vega'
			]);
			const [title, a, b, c, d] = layout.lines;
			expect(title).toMatchObject({ bold: true, anchor: 'middle' });
			expect(title.x).toBeCloseTo(wide / 2);
			expect(title.baseline).toBeCloseTo(first);
			// Columns alike, 5 sizes each, the 15 left over shared between them.
			expect([a, b, c].every((line) => line.anchor === 'middle' && line.bold === undefined)).toBe(
				true
			);
			expect(a.x).toBeCloseTo(2.5 * size);
			expect(b.x).toBeCloseTo(15 * size);
			expect(c.x).toBeCloseTo(27.5 * size);
			// A short last row starts in the first column.
			expect(d.x).toBeCloseTo(a.x!);
			expect(a.baseline).toBeCloseTo(lineHeight + first);
			expect(d.baseline).toBeCloseTo(2 * lineHeight + first);
		});

		it('is its title and its rows tall, with no rules', () => {
			const layout = layoutTable(names, style, wide, measure);
			expect(layout.height).toBeCloseTo(3 * lineHeight);
			expect(layout.rules).toBeUndefined();
		});

		it('likes to be as wide as its three columns and an easy gap between them', () => {
			expect(tableWidth(names, style, measure)).toBeCloseTo((15 + 2 * 2.4) * size);
			// And no narrower than its title, or than what it says when it is empty.
			const short = { ...names, title: 'A very long title of a table', rows: [['a', 'b', 'c']] };
			expect(tableWidth(short, style, measure)).toBeCloseTo(14 * size);
			const empty = { ...names, rows: [], note: 'None on this chart' };
			expect(tableWidth(empty, style, measure)).toBeCloseTo(9 * size);
		});

		it('narrows its columns alike and cuts the names when it is too narrow, all of it inside', () => {
			// Three names of 5 sizes and two gaps of 1.2 need 17.4; in 12 each column has 3.2.
			const narrow = 12 * size;
			const layout = layoutTable(names, style, narrow, measure);
			expect(layout.lines.map((line) => line.text)).toEqual([
				'Stars',
				'Sirius',
				'Rigel',
				'Betel…',
				'Vega'
			]);
			// The first column starts at the table's left edge and the last ends at its right.
			const [, a, , c] = layout.lines;
			expect(a.x).toBeCloseTo(1.6 * size);
			expect(c.x! + 1.6 * size).toBeCloseTo(narrow);
			// At its narrowest: two sizes a column. It is made no narrower than that.
			expect(narrowestTableWidth(names, style, measure)).toBeCloseTo((3 * 2 + 2 * 1.2) * size);
			const least = layoutTable(names, style, 8.4 * size, measure);
			expect(least.lines.map((line) => line.text)).toEqual([
				'Stars',
				'Sir…',
				'Rig…',
				'Bet…',
				'Vega'
			]);
			expect(least.lines[3].x! + size).toBeCloseTo(8.4 * size);
		});

		it('says in the middle, under its title, why it has no names', () => {
			const empty = { ...names, rows: [], note: 'None on this chart' };
			const layout = layoutTable(empty, style, wide, measure);
			expect(layout.lines.map((line) => line.text)).toEqual(['Stars', 'None on this chart']);
			expect(layout.lines[1]).toMatchObject({ anchor: 'middle' });
			expect(layout.lines[1].x).toBeCloseTo(wide / 2);
			expect(layout.height).toBeCloseTo(2 * lineHeight);
		});
	});

	describe('of details', () => {
		const details: TableContent = {
			title: 'Messier objects',
			header: ['Object', 'Name', 'Mag'],
			align: ['left', 'left', 'right'],
			rows: [
				['M 45', 'Pleiades', '1.6'],
				['M 1', '', '8.4']
			]
		};
		// The columns are 3, 4 and 1.5 sizes wide: 8.5 in all, and two gaps.
		const wide = 20 * size;
		const padding = 0.3 * lineHeight;

		it('sets the header in bold under the title, the rows under it, each cell in its column', () => {
			const layout = layoutTable(details, style, wide, measure);
			// An empty cell is no line at all.
			expect(layout.lines.map((line) => line.text)).toEqual([
				'Messier objects',
				'Object',
				'Name',
				'Mag',
				'M 45',
				'Pleiades',
				'1.6',
				'M 1',
				'8.4'
			]);
			expect(layout.lines.slice(0, 4).every((line) => line.bold === true)).toBe(true);
			expect(layout.lines.slice(4).every((line) => line.bold === undefined)).toBe(true);
			const [, object, name, mag] = layout.lines;
			expect(object).toMatchObject({ x: 0, anchor: 'start' });
			// What the width leaves, 11.5 sizes, is shared between the two gaps.
			expect(name.x).toBeCloseTo((3 + 5.75) * size);
			// A column of numbers is set from its right edge, which is the table's.
			expect(mag.anchor).toBe('end');
			expect(mag.x).toBeCloseTo(wide);
			expect(layout.lines[8]).toMatchObject({ text: '8.4', anchor: 'end' });
		});

		it('rules it over and under its header and under its last row', () => {
			const layout = layoutTable(details, style, wide, measure);
			expect(layout.lines[1].baseline).toBeCloseTo(lineHeight + padding + first);
			expect(layout.lines[4].baseline).toBeCloseTo(2 * lineHeight + 2 * padding + first);
			expect(layout.height).toBeCloseTo(4 * lineHeight + 3 * padding);
			const rules = layout.rules!;
			expect(rules).toHaveLength(3);
			expect(rules.every((rule) => rule.x1 === 0 && rule.x2 === wide && rule.y1 === rule.y2)).toBe(
				true
			);
			// Under the title, over the header; between the header and the rows; under all.
			expect(rules[0].y1).toBeGreaterThan(layout.lines[0].baseline);
			expect(rules[0].y1).toBeLessThan(layout.lines[1].baseline - size * 0.7);
			expect(rules[1].y1).toBeGreaterThan(layout.lines[1].baseline);
			expect(rules[1].y1).toBeLessThan(layout.lines[4].baseline - size * 0.7);
			expect(rules[2].y1).toBeGreaterThan(layout.lines[8].baseline);
			expect(rules[2].y1).toBeLessThan(layout.height);
			expect(rules[0].width).toBeGreaterThan(rules[1].width);
		});

		it('cuts the widest column of words with an ellipsis when the table is too wide', () => {
			// 8.5 sizes of columns and 2.4 of gaps in 10: the names give up the 0.9 over.
			const layout = layoutTable(details, style, 10 * size, measure);
			expect(layout.lines[2].text).toBe('Name');
			expect(layout.lines[5].text).toBe('Pleia…');
			expect(layout.lines[6]).toMatchObject({ text: '1.6', anchor: 'end' });
			expect(layout.lines[6].x).toBeCloseTo(10 * size);
		});

		it('has its columns of words give way, the widest first, and its figures never', () => {
			// Columns of 3, 4 and 1.5 with two gaps of 1.2. In 9.4 the words have 5.5 between them:
			// the wider comes down to the narrower, then both together.
			const at = (sizes: number) =>
				layoutTable(details, style, sizes * size, measure).lines.map((line) => line.text);
			expect(at(9.4).slice(1, 7)).toEqual(['Obje…', 'Name', 'Mag', 'M 45', 'Plei…', '1.6']);
			// Never past two sizes a column of words: the table's least width.
			expect(narrowestTableWidth(details, style, measure)).toBeCloseTo((2 + 2 + 1.5 + 2.4) * size);
			const least = layoutTable(details, style, 7.9 * size, measure);
			expect(least.lines.map((line) => line.text).slice(1, 7)).toEqual([
				'Obj…',
				'Name',
				'Mag',
				'M 45',
				'Ple…',
				'1.6'
			]);
			// And the figures still end at the table's right edge.
			expect(least.lines[6].x).toBeCloseTo(7.9 * size);
		});

		it('says under its header why it has no rows', () => {
			const empty = { ...details, rows: [], note: 'None on this chart' };
			const layout = layoutTable(empty, style, wide, measure);
			expect(layout.lines.at(-1)).toMatchObject({
				text: 'None on this chart',
				x: 0,
				anchor: 'start'
			});
			expect(layout.height).toBeCloseTo(3 * lineHeight + 3 * padding);
			expect(layout.rules).toHaveLength(3);
		});

		it('sets a bold table bold all through, its rows marked light', () => {
			const layout = layoutTable(details, { ...style, bold: true }, wide, measure);
			expect(layout.lines.slice(0, 4).every((line) => line.bold === undefined)).toBe(true);
			expect(layout.lines.slice(4).every((line) => line.bold === false)).toBe(true);
		});
	});
});

describe('blockLayout', () => {
	const sky: Sky = { messier: [object(45, 90, 0, 1.6, 'Pleiades')], stars: [] };
	const items: ChartBlock[] = [
		{ kind: 'chart', id: 'far', chart: chart(270, 0), frame: { x: 12, y: 12, w: 80, h: 80 } },
		{ kind: 'chart', id: 'near', chart: chart(90, 0), frame: { x: 12, y: 150, w: 80, h: 80 } }
	];
	const at = { id: 't', style: DEFAULT_TEXT_STYLE, frame: { x: 12, y: 236, w: 100, h: 10 } };
	const tableOf = (table: TableSpec, chartId?: string): TableBlock => ({
		kind: 'table',
		...at,
		table,
		...(chartId ? { chartId } : {})
	});

	it('lays a table out from the chart it reads: the nearest, or the one it is told', () => {
		const table = tableOf({ source: 'messier', look: 'details', rows: 5 });
		const near = blockLayout({ blocks: items }, table, 100, measure, sky);
		expect(near.lines.map((line) => line.text)).toContain('Pleiades');
		expect(near.rules).toHaveLength(3);
		const far = blockLayout({ blocks: items }, { ...table, chartId: 'far' }, 100, measure, sky);
		expect(far.lines.at(-1)!.text).toBe('None on this chart');
	});

	it('reads a chart on another page when it is told one there', () => {
		const table = tableOf({ source: 'messier', rows: 5 }, 'near');
		const pages = [{ blocks: [] }, { blocks: items }];
		// On a page of its own, with no chart: its sky is on the other page.
		const read = blockLayout({ blocks: [] }, table, 100, measure, sky, pages);
		expect(read.lines.map((line) => line.text)).toEqual(['Messier objects', 'M 45']);
		// Without the document to look in, there is no chart to read.
		const blind = blockLayout({ blocks: [] }, table, 100, measure, sky);
		expect(blind.lines.map((line) => line.text)).toEqual(['Messier objects', 'No chart to read']);
	});

	it('lays a text out as a text: its fields read, no rules', () => {
		const layout = blockLayout(
			{ blocks: items },
			{ kind: 'text', ...at, text: 'Field {fov}' },
			100,
			measure,
			sky
		);
		expect(layout.lines.map((line) => line.text)).toEqual(['Field 120°']);
		expect(layout.rules).toBeUndefined();
		expect(layout.lines[0].x).toBeUndefined();
	});

	it('names a table by what it lists and how', () => {
		expect(tableName({ source: 'messier', rows: 10 })).toBe('Messier objects, names, 10 rows');
		expect(tableName({ source: 'stars', look: 'details', rows: 1 })).toBe('Stars, details, 1 row');
	});
});
