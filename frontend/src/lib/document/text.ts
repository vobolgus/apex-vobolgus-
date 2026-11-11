/**
 * Text on a page of the PDF document: its fields, and how it breaks into lines.
 * Pure functions, no DOM: whoever calls brings the measure (`renderer/text-measure.svelte.ts`).
 *
 * The editor breaks the lines and the backend only sets each where it is told to, in
 * the same font file, so the PDF breaks where the editor did. Lines break as CSS
 * `pre-wrap` would break them: at spaces and after hyphens, a space at the break
 * hanging off the line's end, and inside a word only when the word alone is too long.
 *
 * A field is a name in braces, `{lst}`: it shows a value of the chart the text
 * reads, and changes with it. An unknown name stays as typed. An angle or an hour
 * may say how many decimals to show, `{lat:1}`: of the last unit it shows, so of the
 * degrees, or of the minutes of an hour. A text reads one chart: the one it was told
 * to (`chartId`), else the nearest to it on its page, so a caption reads the chart it
 * is put under.
 */

import type { TextAnchor } from '$lib/api/wire/request';
import { viewBasis } from '$lib/math/projection';
import { freeRects } from './arrange';
import { blockBounds, chartsOf } from './blocks';
import { contentBox, rotatedBounds } from './geometry';
import type {
	ChartBlock,
	ChartSnapshot,
	DocPage,
	PageOrientation,
	Rect,
	TextAlign,
	TextFont,
	TextBlock,
	TextStyle,
	TypesetBlock
} from './types';

export const MM_PER_PT = 25.4 / 72;
/** The distance between baselines, in font sizes. */
export const LINE_HEIGHT = 1.35;
export const MIN_TEXT_WIDTH_MM = 20;
/** A free place narrower than this is no place for a new text. */
const MIN_NEW_TEXT_WIDTH_MM = 40;
/** Room to type: the most characters one text holds. */
export const MAX_TEXT_CHARS = 4000;

/** The sizes the − and + of a text step through, pt. */
export const TEXT_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

export const DEFAULT_TEXT_STYLE: TextStyle = {
	font: 'serif',
	size: 12,
	bold: false,
	italic: false,
	align: 'left'
};

/** The CSS (and SVG) family of each font: the files in `static/fonts`. */
export const FONT_FAMILY: Record<TextFont, string> = { serif: 'PT Serif', sans: 'PT Sans' };

/**
 * Ascent and descent in font sizes, from each family's `hhea` table (its four faces
 * agree). A line box centres the two in the line height, which puts the baseline
 * where a browser's own line box has it.
 */
export const FONT_METRICS: Record<TextFont, { ascent: number; descent: number }> = {
	serif: { ascent: 1.039, descent: 0.286 },
	sans: { ascent: 1.018, descent: 0.276 }
};

export const TEXT_FONTS: readonly TextFont[] = ['serif', 'sans'];
export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];

/** The width of `text` set in `style`, in font sizes. */
export type Measure = (text: string, style: TextStyle) => number;

export interface TextLine {
	text: string;
	/** The baseline, mm below the block's top. */
	baseline: number;
	/**
	 * A table's cell: where its anchor is, mm from the block's left, which point of
	 * it that is, and whether it is bold. A line of text has none of the three: it
	 * is set by the text's own alignment and weight.
	 */
	x?: number;
	anchor?: TextAnchor;
	bold?: boolean;
}

/** A straight line, mm from the block's top-left: a table's rule. */
export interface TextRule {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	/** How thick, mm. */
	width: number;
}

export interface TextLayout {
	lines: TextLine[];
	/** A table's rules. */
	rules?: TextRule[];
	/** mm. Never 0: an empty text is one line high. */
	height: number;
	/** The font size, mm. */
	size: number;
	/** The distance between baselines, mm. */
	lineHeight: number;
}

// === Fields ===

export type FieldName = 'lat' | 'lst' | 'ra' | 'dec' | 'date' | 'time' | 'fov';

/**
 * The fields a text may hold, in the order the editor offers them. A `precise` one
 * takes the number of decimals after its name (`{lat:1}`); a date and a time do not.
 */
export const TEXT_FIELDS: readonly { name: FieldName; label: string; precise: boolean }[] = [
	{ name: 'lat', label: 'Latitude', precise: true },
	{ name: 'lst', label: 'Sidereal time', precise: true },
	{ name: 'date', label: 'Date', precise: false },
	{ name: 'time', label: 'Time', precise: false },
	{ name: 'ra', label: 'Centre RA', precise: true },
	{ name: 'dec', label: 'Centre Dec', precise: true },
	{ name: 'fov', label: 'Field of view', precise: true }
];

/** What a field shows with no chart to read, or a value the chart does not have. */
export const NO_VALUE = '—';

/** A name in braces, and after a colon the decimals to show: 0, 1 or 2. */
const FIELD_PATTERN = /\{([a-z]+)(?::([0-2]))?\}/g;
const FIELD_NAMES = new Set<string>(TEXT_FIELDS.map((field) => field.name));
const PRECISE_NAMES = new Set<string>(
	TEXT_FIELDS.filter((field) => field.precise).map((field) => field.name)
);

/**
 * The field a match of `FIELD_PATTERN` is, with its decimals, or null when it is
 * none and stays as typed: an unknown name, or decimals asked of a date or a time.
 */
function fieldOf(name: string, decimals: string | undefined): [FieldName, number] | null {
	if (!FIELD_NAMES.has(name)) return null;
	if (decimals === undefined) return [name as FieldName, 0];
	return PRECISE_NAMES.has(name) ? [name as FieldName, Number(decimals)] : null;
}

export function hasFields(text: string): boolean {
	return Array.from(text.matchAll(FIELD_PATTERN)).some(
		(match) => fieldOf(match[1], match[2]) !== null
	);
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Hours of right ascension as "13h 05m", rounded to the minute, or to `decimals`
 * of a minute ("13h 05.2m"). Counted in whole steps of the last decimal, so that
 * rounding up carries: 59.96 minutes is the next hour's 00.0, and at the day's end
 * 0h 00.0m.
 */
function hours(raRad: number, decimals = 0): string {
	const perMinute = 10 ** decimals;
	const day = 1440 * perMinute;
	const steps = Math.round((((raRad / (2 * Math.PI)) % 1) + 1) * day) % day;
	const minutes = Math.floor(steps / perMinute);
	const part = decimals > 0 ? `.${String(steps % perMinute).padStart(decimals, '0')}` : '';
	return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}${part}m`;
}

/** `value` rounded to `decimals`; a negative that rounds to nothing is 0, not −0. */
function rounded(value: number, decimals: number): number {
	const scale = 10 ** decimals;
	return Math.round(value * scale) / scale || 0;
}

/**
 * The values of a chart's fields, its angles and hours to `decimals` (0, 1 or 2; a
 * date and a time are what they are). The centre of a stereographic chart is the
 * zenith of whoever sees that sky: its declination is their latitude, its right
 * ascension their sidereal time. A pinhole frame looks wherever it is pointed, so it
 * has a centre but no latitude or sidereal time.
 */
export function fieldValues(chart: ChartSnapshot, decimals = 0): Record<FieldName, string> {
	const [x, y, z] = viewBasis(chart.view.orientation).forward;
	const ra = Math.atan2(y, x);
	const dec = rounded((Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI, decimals);
	const degrees = Math.abs(dec).toFixed(decimals);
	const stereo = chart.view.projection === 'stereographic';
	const iso = new Date(chart.createdAt).toISOString();
	const fov = stereo ? chart.view.stereoFovDeg : chart.view.pinholeFovDeg;
	return {
		lat: stereo ? `${degrees}° ${dec < 0 ? 'S' : 'N'}` : NO_VALUE,
		lst: stereo ? hours(ra, decimals) : NO_VALUE,
		ra: hours(ra, decimals),
		dec: `${dec < 0 ? '−' : '+'}${degrees}°`,
		date: iso.slice(0, 10),
		time: `${iso.slice(11, 16)} UTC`,
		fov: `${rounded(fov, decimals).toFixed(decimals)}°`
	};
}

/** `text` with every field replaced by the chart's value, or by a dash without a chart. */
export function resolveFields(text: string, chart: ChartSnapshot | null): string {
	// The chart's values at each number of decimals asked for, worked out once.
	const values: (Record<FieldName, string> | undefined)[] = [];
	return text.replace(FIELD_PATTERN, (token, name: string, suffix: string | undefined) => {
		const field = fieldOf(name, suffix);
		if (!field) return token;
		if (!chart) return NO_VALUE;
		const [key, decimals] = field;
		const read = (values[decimals] ??= fieldValues(chart, decimals));
		return read[key];
	});
}

/** A gap to the side of a chart counts this many times the same gap under or over it. */
const SIDEWAYS = 2;

/**
 * How far a text is from a chart, edge to edge, mm (0 when they touch or overlap),
 * the way across counted double: a caption stands under or over its chart far more
 * often than beside it, so under a short chart it is not taken by a tall one next door.
 */
function gap(a: Rect, b: Rect): number {
	const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
	const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
	return Math.hypot(SIDEWAYS * dx, dy);
}

function centreDistance(a: Rect, b: Rect): number {
	return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
}

/** The pages of a document, for a text that reads a chart on another page than its own. */
export type Sheets = readonly Pick<DocPage, 'blocks'>[];

/** What of a text or a table says which chart it reads: the one it names, and where it is. */
type Reader = Pick<TypesetBlock, 'chartId' | 'frame' | 'rotation'>;

/**
 * The chart a text's fields read: the one it names, on its own page or (given the
 * document's `pages`) on any other, else the nearest on its page (`gap`); of
 * charts as near (a text across two of them), the one whose centre is nearer, then
 * the earlier on the page.
 */
export function boundChartBlock(
	page: Pick<DocPage, 'blocks'>,
	text: Reader,
	pages?: Sheets
): ChartBlock | null {
	const charts = chartsOf(page);
	if (text.chartId !== undefined) {
		const named =
			charts.find((it) => it.id === text.chartId) ??
			pages?.flatMap(chartsOf).find((it) => it.id === text.chartId);
		if (named) return named;
	}
	const box = textBounds(text);
	let best: ChartBlock | null = null;
	let bestGap = Infinity;
	let bestCentre = Infinity;
	for (const chart of charts) {
		const chartGap = gap(box, chart.frame);
		const chartCentre = centreDistance(box, chart.frame);
		const nearer =
			chartGap < bestGap - 1e-6 ||
			(Math.abs(chartGap - bestGap) <= 1e-6 && chartCentre < bestCentre - 1e-6);
		if (nearer) {
			best = chart;
			bestGap = chartGap;
			bestCentre = chartCentre;
		}
	}
	return best;
}

export function boundChart(
	page: Pick<DocPage, 'blocks'>,
	text: Reader,
	pages?: Sheets
): ChartSnapshot | null {
	return boundChartBlock(page, text, pages)?.chart ?? null;
}

/** What a text shows: its fields read from its chart. */
export function shownText(page: Pick<DocPage, 'blocks'>, text: TextBlock, pages?: Sheets): string {
	return resolveFields(text.text, boundChart(page, text, pages));
}

// === Lines ===

/** Where a line may break: after a run of spaces, and after a hyphen inside a word. */
const BREAKABLE = /[^ -]+-(?=[^ -])|[^ ]+|[ ]+/g;

/**
 * `text` broken into lines no wider than `maxWidth` (in the units `width` answers
 * in). A line break in the text always breaks; a space at a wrap hangs off the line
 * and is dropped, the spaces that begin a paragraph are kept. A word wider than the
 * line breaks between characters, one to a line at the least.
 */
export function wrapLines(
	text: string,
	maxWidth: number,
	width: (text: string) => number
): string[] {
	const lines: string[] = [];
	for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n')) {
		let line = '';
		const fits = (candidate: string) => width(candidate.trimEnd()) <= maxWidth + 1e-9;
		for (const [piece] of paragraph.matchAll(BREAKABLE)) {
			if (fits(line + piece)) {
				line += piece;
				continue;
			}
			const space = piece.startsWith(' ');
			// Spaces at a wrap hang off the end of the line they follow.
			if (space && line !== '') {
				line += piece;
				continue;
			}
			if (line.trim() !== '') {
				lines.push(line.trimEnd());
				line = '';
			}
			// Too long for a line of its own: as many characters as fit, and on.
			let rest = line + piece;
			while (!fits(rest)) {
				const chars = Array.from(rest);
				let count = 1;
				while (count < chars.length && fits(chars.slice(0, count + 1).join(''))) count += 1;
				if (count >= chars.length) break;
				lines.push(chars.slice(0, count).join(''));
				rest = chars.slice(count).join('');
			}
			line = rest;
		}
		lines.push(line.trimEnd());
	}
	return lines;
}

/** `text` set in `style` in a column `widthMm` wide. */
export function layoutText(
	text: string,
	style: TextStyle,
	widthMm: number,
	measure: Measure
): TextLayout {
	const size = style.size * MM_PER_PT;
	const lineHeight = size * LINE_HEIGHT;
	const { ascent, descent } = FONT_METRICS[style.font];
	const first = (lineHeight - (ascent + descent) * size) / 2 + ascent * size;
	const lines = wrapLines(text, widthMm / size, (line) => measure(line, style)).map(
		(line, index) => ({ text: line, baseline: first + index * lineHeight })
	);
	return { lines, height: lines.length * lineHeight, size, lineHeight };
}

/** Where a line's anchor is across a block `width` wide, and SVG's name for it. */
export function alignAnchor(align: TextAlign, width: number): { x: number; anchor: TextAnchor } {
	if (align === 'center') return { x: width / 2, anchor: 'middle' };
	if (align === 'right') return { x: width, anchor: 'end' };
	return { x: 0, anchor: 'start' };
}

// === Frames ===

/** `degrees` in (−180, 180], to a tenth of a degree. */
export function normalizeRotation(degrees: number): number {
	if (!Number.isFinite(degrees)) return 0;
	const turned = Math.round((((degrees % 360) + 540) % 360) * 10) / 10 - 180;
	// −180 is 180, and −0 is 0.
	return turned === -180 ? 180 : Math.round(turned * 10) / 10 || 0;
}

/** The right angle (0, 90, 180 or −90) nearest to `degrees`. */
export function squareRotation(degrees: number): number {
	return normalizeRotation(Math.round(degrees / 90) * 90);
}

/** The right angle a quarter turn clockwise (`1`) or back (`-1`) from `degrees`: 30° goes to 90°, 90° to 180°. */
export function quarterTurn(degrees: number, direction: 1 | -1): number {
	const quarters = degrees / 90;
	const next = direction > 0 ? Math.floor(quarters + 1e-6) + 1 : Math.ceil(quarters - 1e-6) - 1;
	return normalizeRotation(next * 90);
}

/** What a text takes up on its page: its frame, or the upright box around it when turned. */
export function textBounds(text: Pick<TypesetBlock, 'frame' | 'rotation'>): Rect {
	return blockBounds(text);
}

/**
 * `frame`, turned `rotation` degrees, made `w` × `h` with a top corner kept where it
 * is on the page: the left one (the text's own left, wherever the turn has put it),
 * or the right. A text grows from that corner as its lines do, down its own page.
 */
export function anchoredFrame(
	frame: Rect,
	rotation: number,
	w: number,
	h: number,
	keep: 'left' | 'right' = 'left'
): Rect {
	// The size it has already: nothing to move, and no rounding to pick up on the way.
	if (w === frame.w && h === frame.h) return { ...frame };
	const angle = (rotation * Math.PI) / 180;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const side = keep === 'left' ? -1 : 1;
	// The corner on the page: the centre plus the turned offset to it, and back for the new size.
	const turned = (u: number, v: number) => ({ x: u * c - v * s, y: u * s + v * c });
	const from = turned((side * frame.w) / 2, -frame.h / 2);
	const to = turned((side * w) / 2, -h / 2);
	const cx = frame.x + frame.w / 2 + from.x - to.x;
	const cy = frame.y + frame.h / 2 + from.y - to.y;
	return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * A text's frame on a page: between the smallest width and the widest that fits the
 * content box at its turn, and what it takes up (`rotatedBounds`) inside the box, or
 * from the box's top-left where it is larger. The height is kept: it is the text's,
 * not the frame's to choose. A width that changes keeps the text's top-left corner.
 */
export function fitTextFrame(frame: Rect, o: PageOrientation, rotation = 0): Rect {
	const box = contentBox(o);
	const angle = (rotation * Math.PI) / 180;
	const c = Math.abs(Math.cos(angle));
	const s = Math.abs(Math.sin(angle));
	const h = Math.max(frame.h, 0.1);
	const across = c > 1e-6 ? (box.w - h * s) / c : Infinity;
	const down = s > 1e-6 ? (box.h - h * c) / s : Infinity;
	const widest = Math.max(MIN_TEXT_WIDTH_MM, Math.min(across, down));
	const w = Math.min(Math.max(frame.w, MIN_TEXT_WIDTH_MM), widest);
	const sized = anchoredFrame(frame, rotation, w, h);
	const bounds = rotatedBounds(sized, rotation);
	const x = Math.max(box.x, Math.min(bounds.x, box.x + box.w - bounds.w));
	const y = Math.max(box.y, Math.min(bounds.y, box.y + box.h - Math.min(bounds.h, box.h)));
	return { x: sized.x + x - bounds.x, y: sized.y + y - bounds.y, w, h };
}

/**
 * Where a new text `height` tall goes: the topmost free place on the page that is
 * wide enough, as wide as that place (the content box's width on a clear strip), a
 * gutter clear of every chart and text; of places as high up, the widest. With none,
 * the top of the content box, over whatever is there (it is then moved by hand).
 */
export function newTextFrame(page: Pick<DocPage, 'orientation' | 'blocks'>, height: number): Rect {
	const box = contentBox(page.orientation);
	const obstacles = page.blocks.map(blockBounds);
	const places = freeRects(box, obstacles)
		.filter((free) => free.w >= MIN_NEW_TEXT_WIDTH_MM - 1e-6 && free.h >= height - 1e-6)
		.sort((a, b) => a.y - b.y || b.w - a.w || a.x - b.x);
	const place = places[0] ?? box;
	return { x: place.x, y: place.y, w: place.w, h: height };
}

/** The size one step up (`1`) or down (`-1`) from `size`, or null at the end of the scale. */
export function stepTextSize(size: number, direction: 1 | -1): number | null {
	const next =
		direction > 0
			? TEXT_SIZES.find((s) => s > size + 1e-9)
			: [...TEXT_SIZES].reverse().find((s) => s < size - 1e-9);
	return next ?? null;
}
