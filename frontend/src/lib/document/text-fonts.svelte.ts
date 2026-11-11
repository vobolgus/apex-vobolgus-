/**
 * The fonts text on a page is set in, and the measure that breaks it into lines.
 *
 * The faces are the files in `static/fonts`, the same ones the backend draws the PDF
 * with (`backend/src/fonts.rs`). They are declared here rather than in a stylesheet:
 * a face is fetched when a text first needs it, and the measure has to know when it
 * arrived. Until then a width is measured in whatever the browser falls back to, so
 * every layout made before reads `textFonts.epoch`, which moves when a face loads,
 * and is made again.
 */

import { base } from '$app/paths';
import { loadMessier } from '$lib/api/catalog';
import { catalog } from '$lib/stores.svelte';
import { blockLayout, narrowestTableWidth, tableContent, tableWidth } from './table';
import {
	boundChart,
	FONT_FAMILY,
	layoutText,
	type Measure,
	type Sheets,
	type TextLayout
} from './text';
import type { DocPage, DocText, TextFont, TextStyle } from './types';

type FaceKey = `${TextFont}-${'regular' | 'bold'}${'' | '-italic'}`;

const FILES: Record<FaceKey, string> = {
	'serif-regular': 'PTSerif-Regular.ttf',
	'serif-regular-italic': 'PTSerif-Italic.ttf',
	'serif-bold': 'PTSerif-Bold.ttf',
	'serif-bold-italic': 'PTSerif-BoldItalic.ttf',
	'sans-regular': 'PTSans-Regular.ttf',
	'sans-regular-italic': 'PTSans-Italic.ttf',
	'sans-bold': 'PTSans-Bold.ttf',
	'sans-bold-italic': 'PTSans-BoldItalic.ttf'
};

/** Widths are measured at this size and divided by it: canvas text is hinted when small. */
const MEASURE_PX = 200;
/** Measured widths kept; past this the cache starts over. */
const CACHE_LIMIT = 4000;
/** A width per character, in font sizes, where there is no canvas to measure on (tests). */
const ROUGH_CHAR_WIDTH = 0.5;

/** Moves when a face has loaded: a layout that read it is made again. */
export const textFonts = $state({ epoch: 0 });

// Plain maps on purpose: nothing is drawn from them, and `epoch` says when they change.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const faces = new Map<FaceKey, { face: FontFace; loaded: Promise<void> | null; ready: boolean }>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const widths = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

function faceKey(style: Pick<TextStyle, 'font' | 'bold' | 'italic'>): FaceKey {
	return `${style.font}-${style.bold ? 'bold' : 'regular'}${style.italic ? '-italic' : ''}`;
}

function supported(): boolean {
	return typeof FontFace !== 'undefined' && typeof document !== 'undefined' && !!document.fonts;
}

/** Every face, known to the document by its family, weight and style; none fetched yet. */
function declare() {
	if (faces.size > 0 || !supported()) return;
	for (const key of Object.keys(FILES) as FaceKey[]) {
		const [font, weight, italic] = key.split('-') as [TextFont, 'regular' | 'bold', string?];
		const face = new FontFace(FONT_FAMILY[font], `url("${base}/fonts/${FILES[key]}")`, {
			weight: weight === 'bold' ? '700' : '400',
			style: italic ? 'italic' : 'normal'
		});
		document.fonts.add(face);
		faces.set(key, { face, loaded: null, ready: false });
	}
}

/** Fetch the face `style` is set in, once; resolves when it can be measured and drawn. */
export function loadTextFont(style: Pick<TextStyle, 'font' | 'bold' | 'italic'>): Promise<void> {
	declare();
	const entry = faces.get(faceKey(style));
	if (!entry) return Promise.resolve();
	entry.loaded ??= entry.face.load().then(
		() => {
			entry.ready = true;
			// What was measured in the fallback font is wrong now.
			widths.clear();
			textFonts.epoch += 1;
		},
		(error) => {
			// Offline, say: the text shows in a fallback font, and may be asked for again.
			console.error(error);
			entry.loaded = null;
		}
	);
	return entry.loaded;
}

/** Resolves once every face these styles use has loaded (or failed to). */
export function loadTextFonts(
	styles: Iterable<Pick<TextStyle, 'font' | 'bold' | 'italic'>>
): Promise<void> {
	return Promise.all(Array.from(styles, loadTextFont)).then(() => undefined);
}

function canvasContext(): CanvasRenderingContext2D | null {
	if (context !== undefined) return context;
	// jsdom has a canvas element and no 2D context behind it.
	context = supported() ? document.createElement('canvas').getContext('2d') : null;
	return context;
}

/**
 * The width of `text` in `style`, in font sizes. Asks for the face on the way: a
 * width measured before it loads is the fallback font's, good until `epoch` moves.
 */
export const measureText: Measure = (text, style) => {
	if (text === '') return 0;
	const ctx = canvasContext();
	if (!ctx) return Array.from(text).length * ROUGH_CHAR_WIDTH;
	const key = faceKey(style);
	if (!faces.get(key)?.ready) void loadTextFont(style);
	const cacheKey = `${key}\n${text}`;
	const cached = widths.get(cacheKey);
	if (cached !== undefined) return cached;
	ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${MEASURE_PX}px "${FONT_FAMILY[style.font]}", serif`;
	const width = ctx.measureText(text).width / MEASURE_PX;
	if (widths.size >= CACHE_LIMIT) widths.clear();
	widths.set(cacheKey, width);
	return width;
};

/** `text` laid out with the loaded faces; inside an effect or a `$derived`, made again when one arrives. */
export function measuredLayout(text: string, style: TextStyle, widthMm: number): TextLayout {
	void textFonts.epoch;
	return layoutText(text, style, widthMm, measureText);
}

/**
 * What a block shows, laid out `widthMm` wide (its own width when not given): a
 * text with its fields read from its chart, or a table read from it and from the
 * catalogues. Made again when a face or a catalogue arrives; a table of Messier
 * objects asks for their catalogue on the way. `pages` is the document, for a block
 * that reads a chart on another page than its own.
 */
export function shownLayout(
	page: Pick<DocPage, 'items'>,
	text: DocText,
	widthMm: number = text.frame.w,
	pages?: Sheets
): TextLayout {
	void textFonts.epoch;
	if (text.table?.source === 'messier' && catalog.messier.length === 0) void loadMessier();
	const sky = { messier: catalog.messier, stars: catalog.stars };
	return blockLayout(page, text, widthMm, measureText, sky, pages);
}

/** The width a table likes to be (`tableWidth`), with the loaded faces and catalogues, mm. */
export function likedTableWidth(
	page: Pick<DocPage, 'items'>,
	text: Pick<DocText, 'table' | 'style' | 'chartId' | 'frame'>,
	pages?: Sheets
): number {
	void textFonts.epoch;
	if (!text.table) return text.frame.w;
	const sky = { messier: catalog.messier, stars: catalog.stars };
	const chart = boundChart(page, { ...text, id: '', text: '' }, pages);
	return tableWidth(tableContent(chart, text.table, sky), text.style, measureText);
}

/** The narrowest a table can be made with nothing of it outside its width (`narrowestTableWidth`), mm. */
export function leastTableWidth(
	page: Pick<DocPage, 'items'>,
	text: Pick<DocText, 'table' | 'style' | 'chartId' | 'frame'>,
	pages?: Sheets
): number {
	void textFonts.epoch;
	if (!text.table) return 0;
	const sky = { messier: catalog.messier, stars: catalog.stars };
	const chart = boundChart(page, { ...text, id: '', text: '' }, pages);
	return narrowestTableWidth(tableContent(chart, text.table, sky), text.style, measureText);
}
