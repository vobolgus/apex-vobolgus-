/**
 * The PDF document: A4 pages holding frozen copies of the preview's chart, and text.
 *
 * All geometry is in millimetres, origin at the page's top-left, y down.
 */

import type { ChartLayers, ChartView } from '$lib/api/render-config';

export type PageOrientation = 'portrait' | 'landscape';

/** Millimetres, page top-left origin, y down. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Everything needed to draw one chart again: a frozen copy of the preview state. */
export interface ChartSnapshot {
	/** Projection, orientation quaternion, fovs, pinhole aspect/height. */
	view: ChartView;
	layers: ChartLayers;
	/** Width / height of the chart: 1 for stereo (disc), the frame aspect for pinhole. */
	aspect: number;
	/** ISO, also the planets' time. */
	createdAt: string;
}

export interface DocItem {
	id: string;
	chart: ChartSnapshot;
	/** Always keeps the chart's aspect: `frame.w / frame.h === chart.aspect`. */
	frame: Rect;
	/** PNG data URL of the preview at add time, shown until the vector preview loads. */
	thumb?: string;
}

export type TextFont = 'serif' | 'sans';
export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
	font: TextFont;
	/** The font size, pt. */
	size: number;
	bold: boolean;
	italic: boolean;
	align: TextAlign;
}

/**
 * A block of text on a page. Its width is set by hand and its lines wrap to it; the
 * height follows the text, so `frame.h` is only the height it was last laid out at
 * (`text.ts`), kept for whoever needs the block's box without measuring type.
 */
export interface DocText {
	id: string;
	/** As typed: line breaks, and `{fields}` that show the values of a chart (`text.ts`). */
	text: string;
	style: TextStyle;
	frame: Rect;
	/**
	 * Degrees it is turned clockwise about the centre of its frame, in (−180, 180];
	 * absent when upright. The frame is the text's own box, as it is before the turn.
	 */
	rotation?: number;
	/** The chart on this page its fields read; the nearest one when absent or gone (`boundItem`). */
	chartId?: string;
}

/** How Add to PDF and a turn lay a page out: stereo charts are discs, the rest pinholes. */
export type ChartKind = 'stereo' | 'pinhole';

/** A layout node: its kids side by side (`H`) or stacked (`V`), one gutter apart. */
export interface LayoutNode {
	dir: 'H' | 'V';
	kids: LayoutTree[];
}

/**
 * An ordered slicing (guillotine) layout. A leaf is an item's index; a node's kids
 * alternate direction with its own.
 */
export type LayoutTree = number | LayoutNode;

/**
 * `uniform`: every chart at the same share of its size alone on the page.
 * `blocked`: neighbours share a height (side by side) or a width (stacked), so edges are flush.
 */
export type LayoutSizing = 'uniform' | 'blocked';

/** The arranger's layout of a page; its leaves index `page.items`. */
export interface PageLayout {
	tree: LayoutTree;
	sizing: LayoutSizing;
}

/** A page as it was before its last turn, so that turning it back restores it exactly. */
export interface TurnMemo {
	orientation: PageOrientation;
	/** The page's item ids in their order then; `frames` and `layout` follow it. */
	ids: string[];
	frames: Rect[];
	layout?: PageLayout;
	manual: boolean;
}

export interface DocPage {
	id: string;
	orientation: PageOrientation;
	items: DocItem[];
	/** Text, drawn over the charts. A page with text is arranged by hand (`manual`). */
	texts?: DocText[];
	/** Arranged by hand (a drag, a resize, a nudge, a drop): Add to PDF moves nothing here. */
	manual?: boolean;
	/** The arranger's layout, while the frames are still the ones it made. */
	layout?: PageLayout;
	/** Set by a turn, cleared by any other change to the page. */
	turnMemo?: TurnMemo;
}
