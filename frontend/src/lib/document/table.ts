/**
 * Tables on a page of the PDF document: what is on a chart, listed. Pure functions,
 * no DOM: whoever calls brings the measure and the catalogues.
 *
 * A table is a text whose words are not typed but read from the chart it is bound
 * to (`DocText.table`): the Messier objects in its field, or its brightest stars,
 * brightest first. It has two looks. `names`, after the worksheets of SkyGen: a
 * title in bold over the names alone, three to a row, each in the middle of its
 * column: what is to be found on the chart. `details`: a row an object under a
 * header, with what the catalogue knows of it, between rules.
 *
 * Either is laid out into the same `TextLayout` a text is: a line a cell, each
 * where its column puts it, and a table's rules. So it is drawn, moved, turned,
 * copied and sent to the PDF as text is.
 */

import { toViewSpace } from '$lib/math/projection';
import type { CatalogStar, MessierObject } from '$lib/stores.svelte';
import { constellationName, kindName, starName } from './sky-names';
import {
	boundChart,
	FONT_METRICS,
	LINE_HEIGHT,
	layoutText,
	MM_PER_PT,
	shownText,
	type Measure,
	type Sheets,
	type TextLayout,
	type TextLine,
	type TextRule
} from './text';
import type {
	ChartSnapshot,
	DocPage,
	DocText,
	TableLook,
	TableSource,
	TableSpec,
	TextStyle
} from './types';

export const TABLE_SOURCES: readonly TableSource[] = ['messier', 'stars'];
export const TABLE_LOOKS: readonly TableLook[] = ['names', 'details'];
export const TABLE_ROWS_DEFAULT = 5;
export const MIN_TABLE_ROWS = 1;
/** With its header a table is a line a cell: the backend takes 400 lines a text. */
export const MAX_TABLE_ROWS = 40;
/** How many names stand in a row of the `names` look, as on a SkyGen worksheet. */
export const NAMES_PER_ROW = 3;

export const DEFAULT_TABLE: TableSpec = {
	source: 'messier',
	look: 'names',
	rows: TABLE_ROWS_DEFAULT
};

/** What a table reads from besides its chart. */
export interface Sky {
	messier: readonly MessierObject[];
	stars: readonly CatalogStar[];
}

/** What a table says: its title, its header if it has one, its rows, and how each column is set. */
export interface TableContent {
	title: string;
	/** Null for a table of names alone: no header, and no rules. */
	header: string[] | null;
	/** `right` for a column of numbers, `center` for a name in the middle of its column. */
	align: ('left' | 'right' | 'center')[];
	rows: string[][];
	/** What it says in place of rows when it has none. */
	note?: string;
}

/** What each source is called in the editor: a table's name, its toolbar. */
export const TABLE_SOURCE_NAMES: Record<TableSource, string> = {
	messier: 'Messier objects',
	stars: 'Stars'
};

type Language = NonNullable<TableSpec['language']>;

/** The words a table sets on the page, in one language. */
interface TableWords {
	titles: Record<TableSource, string>;
	headers: Record<TableSource, string[]>;
	noChart: string;
	notLoaded: string;
	none: string;
}

const TABLE_WORDS: Record<Language, TableWords> = {
	en: {
		titles: { messier: 'Messier objects', stars: 'Stars' },
		headers: {
			messier: ['Object', 'Name', 'Type', 'Constellation', 'Mag'],
			stars: ['№', 'Name', 'RA', 'Dec', 'Mag']
		},
		noChart: 'No chart to read',
		notLoaded: 'The catalogue is not loaded',
		none: 'None on this chart'
	},
	ru: {
		titles: { messier: 'Объекты Мессье', stars: 'Звёзды' },
		headers: {
			messier: ['Объект', 'Название', 'Тип', 'Созвездие', 'Зв. вел.'],
			stars: ['№', 'Название', 'α', 'δ', 'Зв. вел.']
		},
		noChart: 'Нет скайчарта',
		notLoaded: 'Каталог не загружен',
		none: 'На этом скайчарте нет'
	}
};

/** The languages a table is set in. */
export const TABLE_LANGUAGES: readonly Language[] = ['en', 'ru'];

export const TABLE_LOOK_NAMES: Record<TableLook, string> = {
	names: 'Names',
	details: 'Details'
};

/** A table's look: `names` unless it says otherwise. */
export function lookOf(spec: TableSpec): TableLook {
	return spec.look ?? 'names';
}

// === What is on a chart ===

/**
 * Whether a direction (a unit vector in the equatorial frame) is on a chart: inside
 * the disc of a stereographic one, inside the frame of a pinhole one. The same
 * camera the chart is drawn with (`toViewSpace`), so the table lists what is seen.
 */
export function isInChart(chart: ChartSnapshot, x: number, y: number, z: number): boolean {
	const { view } = chart;
	const [vx, vy, vz] = toViewSpace(x, y, z, view.orientation);
	if (view.projection === 'stereographic') {
		const away = Math.acos(Math.max(-1, Math.min(1, vz)));
		return away <= ((view.stereoFovDeg / 2) * Math.PI) / 180;
	}
	if (vz <= 0) return false;
	// The field is across the frame; its height follows the aspect.
	const half = Math.tan(((view.pinholeFovDeg / 2) * Math.PI) / 180);
	return Math.abs(vx / vz) <= half && Math.abs(vy / vz) <= half / view.pinholeAspectRatio;
}

function unit(raRad: number, decRad: number): [number, number, number] {
	const c = Math.cos(decRad);
	return [c * Math.cos(raRad), c * Math.sin(raRad), Math.sin(decRad)];
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** A magnitude to a tenth, with a true minus: "−1.4". */
function magnitudeOf(mag: number): string {
	const text = Math.abs(mag).toFixed(1);
	return mag < 0 && text !== '0.0' ? `−${text}` : text;
}

/** Right ascension as "5h 35.3m". */
function hoursOf(raRad: number): string {
	const tenths = Math.round((((raRad / (2 * Math.PI)) % 1) + 1) * 14400) % 14400;
	const minutes = (tenths % 600) / 10;
	return `${Math.floor(tenths / 600)}h ${minutes < 10 ? '0' : ''}${minutes.toFixed(1)}m`;
}

/** Declination as "−05° 23′". */
function degreesOf(decRad: number): string {
	const minutes = Math.round(((Math.abs(decRad) * 180) / Math.PI) * 60);
	const sign = decRad < 0 && minutes > 0 ? '−' : '+';
	return `${sign}${pad(Math.floor(minutes / 60))}° ${pad(minutes % 60)}′`;
}

/** `list` in runs of `size`. */
function runs<T>(list: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/** The Messier objects on a chart, brightest first. */
function messierOn(chart: ChartSnapshot, sky: Sky): MessierObject[] {
	const deg = Math.PI / 180;
	return sky.messier
		.filter((object) => isInChart(chart, ...unit(object.ra_deg * deg, object.dec_deg * deg)))
		.sort((a, b) => a.mag - b.mag || a.m - b.m);
}

/** The stars on a chart, brightest first, each with its name if it has one. */
function starsOn(chart: ChartSnapshot, sky: Sky): { star: CatalogStar; name: string | null }[] {
	const taken = new Set<string>();
	return sky.stars
		.filter((star) => isInChart(chart, ...unit(star.ra, star.dec)))
		.sort((a, b) => a.v_mag - b.v_mag)
		.map((star) => ({ star, name: starName(star.ra, star.dec, taken) }));
}

/**
 * What a table says of `chart`, brightest first. In the `names` look: the names
 * alone, three to a row, as many rows as `spec.rows` (of the stars, those that have
 * a name). In the `details` look: a row an object, as many as `spec.rows`.
 */
export function tableContent(chart: ChartSnapshot | null, spec: TableSpec, sky: Sky): TableContent {
	const rows = Math.max(MIN_TABLE_ROWS, Math.min(MAX_TABLE_ROWS, Math.round(spec.rows)));
	const language = spec.language ?? 'en';
	const words = TABLE_WORDS[language];
	const title = words.titles[spec.source];
	const messier = spec.source === 'messier';
	const names = lookOf(spec) === 'names';
	const header = names ? null : words.headers[spec.source];
	const align: TableContent['align'] = names
		? Array.from({ length: NAMES_PER_ROW }, () => 'center' as const)
		: messier
			? ['left', 'left', 'left', 'left', 'right']
			: ['right', 'left', 'right', 'right', 'right'];
	const none = (note: string): TableContent => ({ title, header, align, rows: [], note });
	if (!chart) return none(words.noChart);

	if (messier) {
		const objects = messierOn(chart, sky);
		if (objects.length === 0) {
			return none(sky.messier.length === 0 ? words.notLoaded : words.none);
		}
		if (names) {
			const listed = objects.slice(0, rows * NAMES_PER_ROW).map((object) => `M ${object.m}`);
			return { title, header, align, rows: runs(listed, NAMES_PER_ROW) };
		}
		const listed = objects
			.slice(0, rows)
			.map((object) => [
				`M ${object.m}`,
				object.name,
				kindName(object.kind, language),
				constellationName(object.constellation, language),
				magnitudeOf(object.mag)
			]);
		return { title, header, align, rows: listed };
	}

	const stars = starsOn(chart, sky);
	if (names) {
		const listed = stars.flatMap(({ name }) => (name ? [name] : [])).slice(0, rows * NAMES_PER_ROW);
		if (listed.length === 0) {
			return none(sky.stars.length === 0 ? words.notLoaded : words.none);
		}
		return { title, header, align, rows: runs(listed, NAMES_PER_ROW) };
	}
	if (stars.length === 0) {
		return none(sky.stars.length === 0 ? words.notLoaded : words.none);
	}
	const listed = stars
		.slice(0, rows)
		.map(({ star, name }, i) => [
			String(i + 1),
			name ?? '',
			hoursOf(star.ra),
			degreesOf(star.dec),
			magnitudeOf(star.v_mag)
		]);
	return { title, header, align, rows: listed };
}

// === Laying a table out ===

/** Between two columns at the least, and in a table as wide as it likes to be, in font sizes. */
const COLUMN_GAP = 1.2;
const EASY_GAP = 2.4;
/** Over and under the header and the rows of a ruled table, in line heights. */
const RULE_PAD = 0.3;
/** The rules over and under the table, and the lighter one under its header, mm. */
const OUTER_RULE_MM = 0.3;
const INNER_RULE_MM = 0.15;
const ELLIPSIS = '…';

/** `text` cut to fit `width` (font sizes) with an ellipsis; the text itself when it fits. */
function fitted(text: string, width: number, measure: (text: string) => number): string {
	if (measure(text) <= width + 1e-9) return text;
	const chars = Array.from(text);
	while (chars.length > 1 && measure(chars.join('').trimEnd() + ELLIPSIS) > width + 1e-9) {
		chars.pop();
	}
	return chars.join('').trimEnd() + ELLIPSIS;
}

/** How wide each column is by what it holds, in font sizes; a table of names has them all alike. */
function columnWidths(content: TableContent, style: TextStyle, measure: Measure): number[] {
	const plain = (text: string) => measure(text, { ...style, bold: false });
	const bold = (text: string) => measure(text, { ...style, bold: true });
	const columns = content.align.length;
	const widths = Array.from({ length: columns }, (_, column) =>
		Math.max(
			content.header ? bold(content.header[column] ?? '') : 0,
			...content.rows.map((row) => plain(row[column] ?? ''))
		)
	);
	if (content.header) return widths;
	const widest = Math.max(0, ...widths);
	return widths.map(() => widest);
}

/** A column of words gives way to this and no further, in font sizes: a letter or two and an ellipsis. */
const NARROWEST = 2;

/**
 * The columns' widths in a table `available` font sizes wide: their own while they
 * fit with the least gap between them. Too wide, the names of a table of names give
 * way alike; in a table of details the columns of words give way, the widest first
 * and no further than they must (those of numbers keep theirs: a figure cut short
 * is another figure). None gives way past `NARROWEST`.
 */
function fittedWidths(content: TableContent, widths: number[], available: number): number[] {
	const room = available - Math.max(0, widths.length - 1) * COLUMN_GAP;
	if (widths.reduce((sum, width) => sum + width, 0) <= room + 1e-9) return widths;
	if (!content.header) {
		const each = Math.max(Math.min(NARROWEST, widths[0] ?? 0), room / widths.length);
		return widths.map((width) => Math.min(width, each));
	}
	const words = (column: number) => content.align[column] !== 'right';
	const kept = widths.reduce((sum, width, column) => (words(column) ? sum : sum + width), 0);
	// The widest give way first: every column of words over the cap comes down to it.
	const giving = widths.filter((_, column) => words(column)).sort((a, b) => a - b);
	let left = room - kept;
	let cap = Infinity;
	for (let i = 0; i < giving.length; i++) {
		const share = left / (giving.length - i);
		if (giving[i] > share) {
			cap = share;
			break;
		}
		left -= giving[i];
	}
	return widths.map((width, column) =>
		words(column) ? Math.max(Math.min(width, NARROWEST), Math.min(width, cap)) : width
	);
}

/**
 * The narrowest a table can be made with nothing of it outside its width, mm: its
 * columns of words at their narrowest, its figures whole.
 */
export function narrowestTableWidth(
	content: TableContent,
	style: TextStyle,
	measure: Measure
): number {
	const widths = columnWidths(content, style, measure).map((width, column) =>
		content.align[column] === 'right' ? width : Math.min(width, NARROWEST)
	);
	const columns = widths.reduce((sum, width) => sum + width, 0);
	return (columns + Math.max(0, widths.length - 1) * COLUMN_GAP) * style.size * MM_PER_PT;
}

/**
 * The width a table likes to be, mm: its columns as wide as what they hold, with an
 * easy gap between them, and no narrower than its title or what it says when empty.
 * A new table is this wide, so that two stand side by side as on a SkyGen worksheet.
 */
export function tableWidth(content: TableContent, style: TextStyle, measure: Measure): number {
	const size = style.size * MM_PER_PT;
	const widths = columnWidths(content, style, measure);
	const columns = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * EASY_GAP;
	const title = measure(content.title, { ...style, bold: true });
	const note = content.note ? measure(content.note, { ...style, bold: false }) : 0;
	return Math.max(columns, title, note) * size;
}

/**
 * A table set in `style` in a column `widthMm` wide. Its title in bold in the
 * middle; under it, a table of names is its names, each in the middle of one of
 * three columns alike; a table of details is its header in bold between two rules,
 * its rows, and a rule under all. The columns are as wide as what they hold and
 * share out what the width leaves between them; when they are too wide for it they
 * give way (`fittedWidths`) and their cells are cut with an ellipsis, so nothing
 * of a table lies outside its width. A table with nothing to list says why.
 */
export function layoutTable(
	content: TableContent,
	style: TextStyle,
	widthMm: number,
	measure: Measure
): TextLayout {
	const size = style.size * MM_PER_PT;
	const lineHeight = size * LINE_HEIGHT;
	const { ascent, descent } = FONT_METRICS[style.font];
	const first = (lineHeight - (ascent + descent) * size) / 2 + ascent * size;
	const plain = (text: string) => measure(text, { ...style, bold: false });
	const bold = (text: string) => measure(text, { ...style, bold: true });
	const available = widthMm / size;

	const widths = fittedWidths(content, columnWidths(content, style, measure), available);
	const gaps = Math.max(0, widths.length - 1);
	const natural = widths.reduce((sum, width) => sum + width, 0);
	// What the width leaves over is shared out between the columns.
	const gap = gaps > 0 ? Math.max(COLUMN_GAP, (available - natural) / gaps) : COLUMN_GAP;

	// Where each column starts, mm, and where a cell's anchor is in it.
	const starts: number[] = [];
	let at = 0;
	for (const width of widths) {
		starts.push(at * size);
		at += width + gap;
	}
	const cell = (text: string, column: number, baseline: number, header: boolean): TextLine => {
		const set = content.align[column];
		const width = widths[column];
		const offset = set === 'right' ? width : set === 'center' ? width / 2 : 0;
		const line: TextLine = {
			text: fitted(text, width, header ? bold : plain),
			baseline,
			x: starts[column] + offset * size,
			anchor: set === 'right' ? 'end' : set === 'center' ? 'middle' : 'start'
		};
		if (header !== style.bold) line.bold = header;
		return line;
	};

	const title: TextLine = {
		text: fitted(content.title, available, bold),
		baseline: first,
		x: widthMm / 2,
		anchor: 'middle'
	};
	if (!style.bold) title.bold = true;
	const lines: TextLine[] = [title];
	const rules: TextRule[] = [];
	const rule = (y: number, width: number) =>
		rules.push({ x1: 0, y1: y, x2: widthMm, y2: y, width });
	const padding = content.header ? RULE_PAD * lineHeight : 0;

	// Under the title: a ruled header, for a table that has one.
	let top = lineHeight;
	if (content.header) {
		rule(top + OUTER_RULE_MM / 2, OUTER_RULE_MM);
		content.header.forEach((name, column) =>
			lines.push(cell(name, column, top + padding + first, true))
		);
		top += padding + lineHeight + padding;
		rule(top - padding / 2, INNER_RULE_MM);
	}
	if (content.rows.length === 0) {
		const note: TextLine = content.header
			? { text: content.note ?? '', baseline: top + first, x: 0, anchor: 'start' }
			: { text: content.note ?? '', baseline: top + first, x: widthMm / 2, anchor: 'middle' };
		if (style.bold) note.bold = false;
		lines.push(note);
	}
	content.rows.forEach((row, index) => {
		row.forEach((text, column) => {
			if (text !== '') lines.push(cell(text, column, top + index * lineHeight + first, false));
		});
	});
	const height = top + Math.max(1, content.rows.length) * lineHeight + padding;
	if (content.header) rule(height - OUTER_RULE_MM / 2, OUTER_RULE_MM);
	const layout: TextLayout = { lines, height, size, lineHeight };
	if (rules.length > 0) layout.rules = rules;
	return layout;
}

/**
 * What a block shows, laid out `widthMm` wide: a table read from its chart, or a
 * text with its fields read from it. `pages` is the document, for a block that
 * reads a chart on another page than its own.
 */
export function blockLayout(
	page: Pick<DocPage, 'items'>,
	text: DocText,
	widthMm: number,
	measure: Measure,
	sky: Sky,
	pages?: Sheets
): TextLayout {
	if (!text.table) {
		return layoutText(shownText(page, text, pages), text.style, widthMm, measure);
	}
	const content = tableContent(boundChart(page, text, pages), text.table, sky);
	return layoutTable(content, text.style, widthMm, measure);
}

/** What a table is called: "Messier objects, names, 5 rows". */
export function tableName(spec: TableSpec): string {
	const look = TABLE_LOOK_NAMES[lookOf(spec)].toLowerCase();
	return `${TABLE_SOURCE_NAMES[spec.source]}, ${look}, ${spec.rows} ${spec.rows === 1 ? 'row' : 'rows'}`;
}

/**
 * How tall a table of `spec` is in `style` when it has all its rows, mm: what a
 * template gives it room for before anything is read from a chart.
 */
export function fullTableHeight(spec: TableSpec, style: TextStyle): number {
	const lineHeight = style.size * MM_PER_PT * LINE_HEIGHT;
	const rows = Math.max(MIN_TABLE_ROWS, Math.min(MAX_TABLE_ROWS, Math.round(spec.rows)));
	return lookOf(spec) === 'names'
		? (1 + rows) * lineHeight
		: (2 + rows) * lineHeight + 3 * RULE_PAD * lineHeight;
}
