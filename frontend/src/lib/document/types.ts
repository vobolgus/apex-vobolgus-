/**
 * The PDF document: A4 pages holding blocks: frozen copies of the preview's chart,
 * texts and tables.
 *
 * All geometry is in millimetres, origin at the page's top-left, y down.
 */

import type { TextFont } from '$lib/api/wire/request';
import type { ProjectionMode } from '$lib/math/projection';
import type { Quaternion } from '$lib/math/quaternion';

export type PageOrientation = 'portrait' | 'landscape';

/**
 * A language the document sets its own words in (`words/`): what a template writes,
 * what a table calls things. English or Russian.
 */
export type Language = 'en' | 'ru';

/** Millimetres, page top-left origin, y down. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** How a chart looks at the sky: what of the preview's state a chart is drawn from. */
export interface ChartView {
	projection: ProjectionMode;
	orientation: Quaternion;
	stereoFovDeg: number;
	pinholeFovDeg: number;
	pinholeAspectRatio: number;
	pinholeHeightFrac: number;
}

/** What is drawn on a chart besides its stars. */
export interface ChartLayers {
	constellations: boolean;
	constellationBoundaries: boolean;
	equator: boolean;
	ecliptic: boolean;
	galacticEquator: boolean;
	planets: boolean;
}

/**
 * A ring on a chart's sky: every point `radiusDeg` from (`raDeg`, `decDeg`). Sent to
 * the backend it is the wire's `SkyMark` (`chartRenderConfig`).
 */
export interface ChartMark {
	raDeg: number;
	decDeg: number;
	radiusDeg: number;
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
	/** Places ringed on it: where a close-up of this sky looks (a finder card). */
	marks?: ChartMark[];
}

/**
 * What every block on a page has: a name of its own in the document, and its place.
 * A block is a chart, a text or a table (`kind`); what treats them alike reads no
 * more of one than this.
 */
interface BlockBase {
	id: string;
	frame: Rect;
}

/** A chart on a page: a frozen copy of the preview's. */
export interface ChartBlock extends BlockBase {
	kind: 'chart';
	chart: ChartSnapshot;
	/** Always keeps the chart's aspect: `frame.w / frame.h === chart.aspect`. */
	frame: Rect;
	/** PNG data URL of the preview at add time, shown until the vector preview loads. */
	thumb?: string;
	/**
	 * Set on a close-up a finder card made: the chart whose sky it is a part of. Laid
	 * out as a finder card again, that sky gets a new close-up in place of this one.
	 */
	closeUpOf?: string;
}

/** The families a text is set in: the ones the backend has the files of. */
export type { TextFont };
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
 * The part a text plays on a page a template laid out (`templates.ts`). A caption
 * and a key belong to a chart (`chartId`), as do a worksheet's two tables, of its
 * stars and of its Messier objects.
 */
export type TextRole =
	'title' | 'caption' | 'header' | 'number' | 'tasks' | 'key' | 'stars' | 'messier';

/** What a table lists of its chart. */
export type TableSource = 'messier' | 'stars';

/**
 * How a table is set (`table.ts`). `names`: a title over the names alone, three to
 * a row, as on a SkyGen worksheet. `details`: a row an object under a header, with
 * what the catalogue knows of it.
 */
export type TableLook = 'names' | 'details';

/** A table: what it lists, how it is set, and in how many rows, brightest first. */
export interface TableSpec {
	source: TableSource;
	/** `names` when absent. */
	look?: TableLook;
	rows: number;
	/** The language of its title, its header and what it calls things; English when absent. */
	language?: Language;
}

/**
 * What a text and a table share: both are set in type, read a chart, and may be
 * turned. The width is set by hand; the height follows what is set, so `frame.h` is
 * only the height the block was last laid out at (`text.ts`), kept for whoever needs
 * its box without measuring type.
 */
interface TypesetBase extends BlockBase {
	style: TextStyle;
	/**
	 * Degrees it is turned clockwise about the centre of its frame, in (−180, 180];
	 * absent when upright. The frame is the block's own box, as it is before the turn.
	 */
	rotation?: number;
	/**
	 * Set on a block a template put there. Laid out again, the page keeps what was
	 * typed in it for the same part, and drops it where the new template has none;
	 * a block without one is the page's owner's, and no template touches it.
	 */
	role?: TextRole;
	/** The chart its fields read; the nearest one on its page when absent or gone (`boundChartBlock`). */
	chartId?: string;
}

/** A block of text on a page: its lines wrap to its width. */
export interface TextBlock extends TypesetBase {
	kind: 'text';
	/** As typed: line breaks, and `{fields}` that show the values of a chart (`text.ts`). */
	text: string;
}

/**
 * A table (`table.ts`): its words are not typed but read from its chart, and set in
 * rows and columns.
 */
export interface TableBlock extends TypesetBase {
	kind: 'table';
	table: TableSpec;
}

/** A block set in type: a text or a table. Drawn, moved, turned and sent to the PDF alike. */
export type TypesetBlock = TextBlock | TableBlock;

/** Anything on a page. */
export type DocBlock = ChartBlock | TypesetBlock;

export type BlockKind = DocBlock['kind'];

/** A block yet to get its id. */
export type NewBlock<B extends DocBlock = DocBlock> = B extends DocBlock ? Omit<B, 'id'> : never;

/**
 * A block as copied: what goes on the clipboard, and what `pasteBlock` reads back
 * (from anywhere, so it is parsed like saved data). A copy is its owner's: it plays
 * no part of a template, and reads the chart nearest to where it lands.
 */
export type BlockCopy =
	| { kind: 'chart'; chart: ChartSnapshot; frame: Rect }
	| { kind: 'text'; text: string; style: TextStyle; frame: Rect; rotation?: number }
	| { kind: 'table'; table: TableSpec; style: TextStyle; frame: Rect; rotation?: number };

/** How Add to PDF and a turn lay a page out: stereo charts are discs, the rest pinholes. */
export type ChartKind = 'stereo' | 'pinhole';

/** A layout node: its kids side by side (`H`) or stacked (`V`), one gutter apart. */
export interface LayoutNode {
	dir: 'H' | 'V';
	kids: LayoutTree[];
}

/**
 * An ordered slicing (guillotine) layout. A leaf is a chart's index; a node's kids
 * alternate direction with its own.
 */
export type LayoutTree = number | LayoutNode;

/**
 * `uniform`: every chart at the same share of its size alone on the page.
 * `blocked`: neighbours share a height (side by side) or a width (stacked), so edges are flush.
 */
export type LayoutSizing = 'uniform' | 'blocked';

/** The arranger's layout of a page; its leaves index the page's charts (`chartsOf`). */
export interface PageLayout {
	tree: LayoutTree;
	sizing: LayoutSizing;
}

/** A page as it was before its last turn, so that turning it back restores it exactly. */
export interface TurnMemo {
	orientation: PageOrientation;
	/** The ids of the page's charts in their order then; `frames` and `layout` follow it. */
	ids: string[];
	frames: Rect[];
	layout?: PageLayout;
	manual: boolean;
}

/** A way to lay a page out again with text around its charts (`templates.ts`). */
export type TemplateId = 'charts' | 'caption' | 'pair' | 'finder' | 'sheet';

/**
 * The template a page was laid out as (`templates.ts`), and the language it wrote
 * in. Charts alone are no template to remember: that is the arranger's layout.
 */
export interface PageTemplate {
	id: Exclude<TemplateId, 'charts'>;
	language: Language;
}

export interface DocPage {
	id: string;
	orientation: PageOrientation;
	/**
	 * What is on the page, in the order it is drawn: the charts first, then the texts
	 * and tables over them (`blocks.ts`). A page with text is arranged by hand (`manual`).
	 */
	blocks: DocBlock[];
	/**
	 * Set when a template lays the page out, and kept while the page is what it made:
	 * a turn then lays it out as that template does the other way. Moving, adding or
	 * removing a chart or a text by hand clears it; typing in a text does not.
	 */
	template?: PageTemplate;
	/** Arranged by hand (a drag, a resize, a nudge, a drop): Add to PDF moves nothing here. */
	manual?: boolean;
	/** The arranger's layout, while the frames are still the ones it made. */
	layout?: PageLayout;
	/** Set by a turn, cleared by any other change to the page. */
	turnMemo?: TurnMemo;
}
