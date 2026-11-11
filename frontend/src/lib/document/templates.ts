/**
 * Page templates: a page's charts laid out again with text around them. Pure
 * functions, no DOM: whoever calls brings the measure for the text's height.
 *
 * A template is places for charts, each with a shape it suits (a disc, a frame, or
 * either), and texts with a part to play (`role`): a title, a caption, a key. Laying
 * a page out fills the places with the page's own charts, in their order on the
 * page. A shape that does not match is never an error: a chart is fitted into its
 * place at its own aspect. Charts past a page's places go on further pages.
 *
 * A finder card is the one template that makes a chart: of one wide sky and an
 * object chosen on it (`CloseUp`), it draws the close-up itself, the same sky at the
 * same hour looked at through a frame, and rings the place on the wide chart.
 *
 * It is done once, not kept: the page is hand-arranged afterwards, like any page
 * with text. Laid out again by another template, a text keeps what was typed in it
 * when the new template has the same part for it; what the page's owner added (a
 * text with no `role`) stays where it is.
 */

import { viewBasis } from '$lib/math/projection';
import { pointingToOrientation } from '$lib/math/pointing';
import { arrangePage, chartKind } from './arrange';
import { contentBox, GUTTER_MM } from './geometry';
import { LINE_HEIGHT, MM_PER_PT } from './text';
import type {
	ChartKind,
	ChartSnapshot,
	DocItem,
	DocPage,
	DocText,
	PageLayout,
	PageOrientation,
	Rect,
	SkyMark,
	TextRole,
	TextStyle
} from './types';

export type TemplateId = 'charts' | 'caption' | 'pair' | 'finder' | 'sheet';

export interface TemplateInfo {
	id: TemplateId;
	name: string;
	/** What it makes of a page, in a few words. */
	note: string;
	/** The fewest charts a page needs for it to mean anything. */
	minCharts: number;
}

/** In the order the picker offers them. */
export const TEMPLATES: readonly TemplateInfo[] = [
	{ id: 'charts', name: 'Charts only', note: 'No text', minCharts: 1 },
	{ id: 'caption', name: 'With a caption', note: 'One to a page', minCharts: 1 },
	{ id: 'pair', name: 'Two skies', note: 'Side by side', minCharts: 2 },
	{ id: 'finder', name: 'Finder card', note: 'A sky and a close-up', minCharts: 1 },
	{ id: 'sheet', name: 'Worksheet', note: 'Tasks, and a key', minCharts: 1 }
];

export const TEXT_ROLES: readonly TextRole[] = [
	'title',
	'caption',
	'header',
	'number',
	'tasks',
	'key'
];

/** A text a template puts on a page: a `DocText` yet to get its id. */
export type LaidText = Omit<DocText, 'id'> & { role: TextRole };

/** A chart on a laid page: one of the page's own, by id, or one the template made. */
export interface LaidChart {
	/** The chart's id; a made one has a name for the text beside it to point at (`chartId`). */
	id: string;
	frame: Rect;
	/** A chart the template made (a finder card's close-up): what it shows. */
	chart?: ChartSnapshot;
	/** For a made close-up: the id of the chart whose sky it is a part of. */
	closeUpOf?: string;
	/** The places ringed on it from now on; none when absent. */
	marks?: SkyMark[];
}

/** A page as a template lays it out: its charts in their new order, and its text. */
export interface LaidPage {
	orientation: PageOrientation;
	charts: LaidChart[];
	texts: LaidText[];
	/** The arranger's layout, where it made the frames (`charts`). */
	layout?: PageLayout;
	/** Charts of the page that go: an earlier close-up of the sky, replaced by this one. */
	dropped?: string[];
}

/** What a finder card's close-up looks at, and how much of the sky it takes in. */
export interface CloseUp {
	/** What the caption calls it: "M 42 · Orion Nebula". */
	name: string;
	raDeg: number;
	decDeg: number;
	/** The field across the frame, degrees. */
	fovDeg: number;
}

/** The fields a close-up is offered at, degrees across, and the one it starts at. */
export const CLOSE_UP_FIELDS: readonly number[] = [10, 20, 40];
export const CLOSE_UP_FIELD_DEG = 20;
/** A close-up's frame: half as wide again as it is high. */
const CLOSE_UP_ASPECT = 1.5;

export interface TemplateOptions {
	/** The orientation of the pages it makes; the page's own when absent. */
	orientation?: PageOrientation;
	/** The charts in the other order: the last is the first, the left the right. */
	swap?: boolean;
	/** For a finder card: the object to draw the close-up of. Without one it is the sky alone. */
	closeUp?: CloseUp;
	/** The height of `text` set in `style` in a column `width` mm wide, mm. */
	height?: (text: string, style: TextStyle, width: number) => number;
}

// === What the text says, and how it is set ===

const TITLE: TextStyle = { font: 'sans', size: 16, bold: true, italic: false, align: 'left' };
const CAPTION: TextStyle = { font: 'serif', size: 10, bold: false, italic: true, align: 'center' };
const HEADER: TextStyle = { font: 'serif', size: 12, bold: false, italic: false, align: 'left' };
const TASKS: TextStyle = { font: 'serif', size: 11, bold: false, italic: false, align: 'left' };
const KEY: TextStyle = { font: 'sans', size: 8, bold: false, italic: false, align: 'left' };

const TITLES: Partial<Record<TemplateId, string>> = {
	caption: 'Sky chart',
	pair: 'Two skies',
	finder: 'Finder card'
};

const SKY_CAPTION = 'Latitude {lat} · sidereal time {lst}';
const FRAME_CAPTION = 'Centre {ra}, {dec} · field {fov}';
const HEADER_TEXT = 'Name ______________________   Class ________';
const TASKS_TEXT =
	'1. Find the zenith and mark it.\n2. Name the ten brightest stars.\n3. Draw the celestial equator.';
const SKY_KEY = '{lat} · {lst}';
const FRAME_KEY = '{ra} {dec}';

/**
 * What a template writes on its own. A text that still says one of these was not
 * typed over, so the next template writes its own words there instead of keeping it.
 */
const STOCK = new Set<string>([
	...Object.values(TITLES),
	SKY_CAPTION,
	FRAME_CAPTION,
	SKY_KEY,
	FRAME_KEY
]);

/** Between a chart and the caption under it, mm. */
const CAPTION_GAP_MM = 2.5;
/** How wide the upside-down key at the foot of a worksheet is, mm. */
const KEY_WIDTH_MM = 70;
/** The share of the page a finder card gives the wide sky. */
const FINDER_MAIN_SHARE = 0.6;

/** One line a size, for a caller with no fonts to measure with: good for a single line. */
function oneLine(_text: string, style: TextStyle): number {
	return style.size * MM_PER_PT * LINE_HEIGHT;
}

// === Laying out ===

interface Chart {
	id: string;
	kind: ChartKind;
	aspect: number;
}

interface Context {
	orientation: PageOrientation;
	box: Rect;
	height: (text: string, style: TextStyle, width: number) => number;
	/** What the page's text of that part says now, and how it is set, if it was typed over. */
	kept: (role: TextRole, chartId?: string) => { text: string; style: TextStyle } | null;
}

/** A text of `role` at (`x`, `y`), `w` wide: the page's own words for that part, else `words`. */
function textAt(
	ctx: Context,
	role: TextRole,
	words: string,
	style: TextStyle,
	at: { x: number; y: number; w: number },
	chartId?: string
): LaidText {
	// A sheet's number is its place in the run, whatever the last one said.
	const kept = role === 'number' ? null : ctx.kept(role, chartId);
	const text = kept?.text ?? words;
	const set = kept?.style ?? style;
	const laid: LaidText = {
		role,
		text,
		style: { ...set },
		frame: { x: at.x, y: at.y, w: at.w, h: ctx.height(text, set, at.w) }
	};
	if (chartId) laid.chartId = chartId;
	return laid;
}

/** The largest frame of `aspect` in `cell`, in its middle. */
function fitIn(cell: Rect, aspect: number): Rect {
	const w = Math.max(0, Math.min(cell.w, cell.h * aspect));
	const h = w / aspect;
	return { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h };
}

/** A chart with its caption under it, the two together in the middle of `cell`. */
function captioned(
	ctx: Context,
	cell: Rect,
	chart: Chart,
	words: string
): { chart: LaidChart; text: LaidText } {
	const caption = textAt(ctx, 'caption', words, CAPTION, { x: cell.x, y: 0, w: cell.w }, chart.id);
	const room = { ...cell, h: cell.h - caption.frame.h - CAPTION_GAP_MM };
	const frame = fitIn(room, chart.aspect);
	caption.frame.y = frame.y + frame.h + CAPTION_GAP_MM;
	return { chart: { id: chart.id, frame }, text: caption };
}

function captionFor(chart: Chart): string {
	return chart.kind === 'stereo' ? SKY_CAPTION : FRAME_CAPTION;
}

/** The title at the top of the content box, and the room under it. */
function titled(ctx: Context, words: string): { title: LaidText; room: Rect } {
	const { box } = ctx;
	const title = textAt(ctx, 'title', words, TITLE, { x: box.x, y: box.y, w: box.w });
	const top = box.y + title.frame.h + GUTTER_MM;
	return { title, room: { x: box.x, y: top, w: box.w, h: box.y + box.h - top } };
}

/** `room` cut in two, side by side (`cols`) or one over the other, the first getting `share` of it. */
function split(room: Rect, way: 'cols' | 'rows', share = 0.5): [Rect, Rect] {
	if (way === 'cols') {
		const w = (room.w - GUTTER_MM) * share;
		return [
			{ ...room, w },
			{ ...room, x: room.x + w + GUTTER_MM, w: room.w - GUTTER_MM - w }
		];
	}
	const h = (room.h - GUTTER_MM) * share;
	return [
		{ ...room, h },
		{ ...room, y: room.y + h + GUTTER_MM, h: room.h - GUTTER_MM - h }
	];
}

function page(ctx: Context, parts: ReturnType<typeof captioned>[], texts: LaidText[]): LaidPage {
	return {
		orientation: ctx.orientation,
		charts: parts.map((part) => part.chart),
		texts: [...texts, ...parts.map((part) => part.text)]
	};
}

/** One chart under a title, its caption under it. */
function captionPage(ctx: Context, [chart]: Chart[]): LaidPage {
	const { title, room } = titled(ctx, TITLES.caption!);
	return page(ctx, [captioned(ctx, room, chart, captionFor(chart))], [title]);
}

/**
 * Two charts under a title, each with its caption: side by side or one over the
 * other, whichever shows them larger (two discs on a portrait page stand in a
 * column, two wide frames on a landscape one too). One chart takes all the room.
 */
function pairPage(ctx: Context, charts: Chart[]): LaidPage {
	const { title, room } = titled(ctx, TITLES.pair!);
	if (charts.length < 2) {
		return page(ctx, [captioned(ctx, room, charts[0], captionFor(charts[0]))], [title]);
	}
	const lay = (way: 'cols' | 'rows') =>
		split(room, way).map((cell, i) => captioned(ctx, cell, charts[i], captionFor(charts[i])));
	const area = (parts: ReturnType<typeof lay>) =>
		parts.reduce((sum, part) => sum + part.chart.frame.w * part.chart.frame.h, 0);
	const cols = lay('cols');
	const rows = lay('rows');
	return page(ctx, area(rows) > area(cols) + 1e-6 ? rows : cols, [title]);
}

/**
 * A wide sky and a close-up of a place on it, under a title: the sky takes the
 * larger part of the page (the top of a portrait page, the left of a landscape one)
 * with the place ringed on it, the close-up the rest, named in its caption. With no
 * object chosen yet it is the sky alone.
 */
function finderPage(ctx: Context, sky: DocItem, target: CloseUp | undefined): LaidPage {
	const { title, room } = titled(ctx, TITLES.finder!);
	const main = chartOf(sky);
	if (!target) return page(ctx, [captioned(ctx, room, main, captionFor(main))], [title]);
	const made = closeUpChart(sky.chart, target);
	const detail: Chart = { id: closeUpId(sky.id), kind: 'pinhole', aspect: made.aspect };
	const way = ctx.orientation === 'landscape' ? 'cols' : 'rows';
	const [mainCell, detailCell] = split(room, way, FINDER_MAIN_SHARE);
	const wide = captioned(ctx, mainCell, main, captionFor(main));
	const close = captioned(ctx, detailCell, detail, `${target.name} · field {fov}`);
	// Where the close-up looks: a ring as wide as its frame.
	wide.chart.marks = [{ raDeg: target.raDeg, decDeg: target.decDeg, radiusDeg: target.fovDeg / 2 }];
	close.chart.chart = made;
	close.chart.closeUpOf = sky.id;
	return page(ctx, [wide, close], [title]);
}

/**
 * A worksheet, after SkyGen's: a line for the name and the sheet's number at the
 * top, the tasks, the chart, and its key upside down at the foot, where whoever
 * holds the sheet the right way up does not read it at a glance.
 */
function sheetPage(ctx: Context, [chart]: Chart[], number: number): LaidPage {
	const { box } = ctx;
	const numberWidth = 30;
	const header = textAt(ctx, 'header', HEADER_TEXT, HEADER, {
		x: box.x,
		y: box.y,
		w: box.w - numberWidth - GUTTER_MM
	});
	const count = textAt(
		ctx,
		'number',
		`№ ${number}`,
		{ ...HEADER, align: 'right' },
		{ x: box.x + box.w - numberWidth, y: box.y, w: numberWidth }
	);
	const tasks = textAt(ctx, 'tasks', TASKS_TEXT, TASKS, {
		x: box.x,
		y: box.y + Math.max(header.frame.h, count.frame.h) + GUTTER_MM,
		w: box.w
	});
	const key = textAt(
		ctx,
		'key',
		chart.kind === 'stereo' ? SKY_KEY : FRAME_KEY,
		KEY,
		{ x: box.x + box.w - KEY_WIDTH_MM, y: 0, w: KEY_WIDTH_MM },
		chart.id
	);
	key.frame.y = box.y + box.h - key.frame.h;
	key.rotation = 180;
	const top = tasks.frame.y + tasks.frame.h + GUTTER_MM;
	const room = { x: box.x, y: top, w: box.w, h: key.frame.y - GUTTER_MM - top };
	return {
		orientation: ctx.orientation,
		charts: [{ id: chart.id, frame: fitIn(room, chart.aspect) }],
		texts: [header, count, tasks, key]
	};
}

// === Which chart goes where ===

/** `list` in runs of `size`. */
function runs<T>(list: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

function chartOf(item: DocItem): Chart {
	return { id: item.id, kind: chartKind(item.chart), aspect: item.chart.aspect };
}

/** The name a close-up yet to be made goes by, for its caption to point at. */
function closeUpId(skyId: string): string {
	return `close-up-of-${skyId}`;
}

/**
 * The chart a finder card is made of: the first disc on the page, as the wide sky
 * is most often one, else the first chart; never a close-up an earlier card made
 * while there is anything else.
 */
export function finderSky(items: readonly DocItem[]): DocItem | undefined {
	const own = items.filter((item) => item.closeUpOf === undefined);
	const from = own.length > 0 ? own : items;
	return from.find((item) => chartKind(item.chart) === 'stereo') ?? from[0];
}

/**
 * The close-up of `target` on the sky of `sky`: the same hour and the same layers,
 * seen through a frame `target.fovDeg` across with the object in its middle and
 * north up.
 */
export function closeUpChart(sky: ChartSnapshot, target: CloseUp): ChartSnapshot {
	return {
		view: {
			projection: 'pinhole',
			orientation: pointingToOrientation({
				raDeg: target.raDeg,
				decDeg: target.decDeg,
				paDeg: 0
			}),
			stereoFovDeg: sky.view.stereoFovDeg,
			pinholeFovDeg: target.fovDeg,
			pinholeAspectRatio: CLOSE_UP_ASPECT,
			pinholeHeightFrac: sky.view.pinholeHeightFrac
		},
		layers: { ...sky.layers },
		aspect: CLOSE_UP_ASPECT,
		createdAt: sky.createdAt
	};
}

/**
 * Whether a place is on a chart: within half its field of its centre, less a little
 * so that a close-up of it is not half off the edge.
 */
export function isOnChart(chart: ChartSnapshot, raDeg: number, decDeg: number): boolean {
	const [fx, fy, fz] = viewBasis(chart.view.orientation).forward;
	const ra = (raDeg * Math.PI) / 180;
	const dec = (decDeg * Math.PI) / 180;
	const cos =
		fx * Math.cos(dec) * Math.cos(ra) + fy * Math.cos(dec) * Math.sin(ra) + fz * Math.sin(dec);
	const away = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
	const stereo = chart.view.projection === 'stereographic';
	const field = stereo ? chart.view.stereoFovDeg : chart.view.pinholeFovDeg;
	return away <= (field / 2) * 0.92;
}

/**
 * `source` laid out by `template`: one page or more, the first to take the place of
 * `source`, the rest to follow it. Every chart of the page is on one of them, but
 * for a close-up a new finder card replaces (`dropped`). A page with no charts gives
 * nothing.
 */
export function layTemplate(
	template: TemplateId,
	source: DocPage,
	options: TemplateOptions = {}
): LaidPage[] {
	const orientation = options.orientation ?? source.orientation;
	const items = source.items;
	if (items.length === 0) return [];
	if (template === 'charts') {
		// The arranger's own layout of the charts, as Add to PDF would have left them.
		const order = options.swap ? [...items].reverse() : items;
		const laid = arrangePage({ id: source.id, orientation, items: order });
		return [
			{
				orientation,
				charts: laid.items.map(({ index, frame }) => ({ id: order[index].id, frame })),
				texts: [],
				layout: laid.layout
			}
		];
	}

	const ctx: Context = {
		orientation,
		box: contentBox(orientation),
		height: options.height ?? oneLine,
		kept(role, chartId) {
			const text = (source.texts ?? []).find(
				(it) => it.role === role && (chartId === undefined || it.chartId === chartId)
			);
			return text && !STOCK.has(text.text) ? { text: text.text, style: text.style } : null;
		}
	};
	const inOrder = options.swap ? [...items].reverse() : items;
	const ordered = inOrder.map(chartOf);
	switch (template) {
		case 'caption':
			return runs(ordered, 1).map((run) => captionPage(ctx, run));
		case 'pair':
			return runs(ordered, 2).map((run) => pairPage(ctx, run));
		case 'finder': {
			// One sky and its close-up; a close-up it had before goes, and whatever else is
			// on the page follows, a chart to a page under its caption.
			const sky = finderSky(inOrder)!;
			const card = finderPage(ctx, sky, options.closeUp);
			const old = options.closeUp ? inOrder.filter((item) => item.closeUpOf === sky.id) : [];
			if (old.length > 0) card.dropped = old.map((item) => item.id);
			const rest = inOrder.filter((item) => item !== sky && !old.includes(item));
			return [card, ...rest.map((item) => captionPage(ctx, [chartOf(item)]))];
		}
		case 'sheet':
			return runs(ordered, 1).map((run, i) => sheetPage(ctx, run, i + 1));
	}
}
