/**
 * Page layout for the PDF document: snapping and placement. Pure functions, no DOM.
 *
 * Millimetres, origin at the page's top-left, y down. Pages are A4; the content
 * box is the page less its margin. The grid is that box split 1..4 ways along
 * each axis with a gutter between the cells: its edge lines are the cells' starts
 * and ends, its centre lines the cells' centres. Snapping pairs like with like
 * (an edge to an edge line, a centre to a centre line), so a chart never lands
 * with its edge on a cell's middle.
 */

import type { DocPage, PageOrientation, Rect } from './types';

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const PAGE_MARGIN_MM = 12;
export const GUTTER_MM = 6;
/** The grid splits each axis into 1..MAX_SPLIT cells. */
export const MAX_SPLIT = 4;
export const MIN_CHART_SIDE_MM = 40;
/** Snap reach in screen px; `snapThresholdMm` converts it at the current zoom. */
export const SNAP_THRESHOLD_PX = 8;
/**
 * A full-width portrait chart (186 mm) is the preview disc (1104 px), so stars and
 * lines are drawn at preview px × this whatever the chart's size on the page.
 */
export const PRINT_MM_PER_PREVIEW_PX = 186 / 1104;

/** Below this, two millimetre values are the same line. */
const EPS = 1e-6;

export type Axis = 'x' | 'y';
export type ResizeAnchor = 'nw' | 'ne' | 'sw' | 'se';

/** A line to draw, mm: `axis: 'x'` is the vertical line x = `at` from y = `from` to `to`. */
export interface SnapGuide {
	axis: Axis;
	at: number;
	from: number;
	to: number;
}

export interface SnapResult {
	frame: Rect;
	guides: SnapGuide[];
}

export function pageSize(o: PageOrientation): { w: number; h: number } {
	return o === 'landscape'
		? { w: A4_HEIGHT_MM, h: A4_WIDTH_MM }
		: { w: A4_WIDTH_MM, h: A4_HEIGHT_MM };
}

export function contentBox(o: PageOrientation): Rect {
	const { w, h } = pageSize(o);
	return {
		x: PAGE_MARGIN_MM,
		y: PAGE_MARGIN_MM,
		w: w - 2 * PAGE_MARGIN_MM,
		h: h - 2 * PAGE_MARGIN_MM
	};
}

/** Track size of an n-way split of `length` with gutters: (length − (n−1)·g)/n. */
export function trackSize(length: number, n: number): number {
	return (length - (n - 1) * GUTTER_MM) / n;
}

/** k cells of an n-way split of `length` and the k − 1 gutters between them. */
function spanSize(length: number, n: number, k: number): number {
	return k * trackSize(length, n) + (k - 1) * GUTTER_MM;
}

/** Converts the screen-px snap reach to mm at a zoom of `pxPerMm` screen px per mm. */
export function snapThresholdMm(pxPerMm: number): number {
	return SNAP_THRESHOLD_PX / pxPerMm;
}

/** Edge and centre lines of the 1..4 splits of the content box along `axis`. */
export function gridLines(o: PageOrientation, axis: Axis): { edges: number[]; centres: number[] } {
	const box = contentBox(o);
	const start = axis === 'x' ? box.x : box.y;
	const length = axis === 'x' ? box.w : box.h;
	const edges: number[] = [];
	const centres: number[] = [];
	for (let n = 1; n <= MAX_SPLIT; n++) {
		const track = trackSize(length, n);
		for (let i = 0; i < n; i++) {
			const cell = start + i * (track + GUTTER_MM);
			edges.push(cell, cell + track);
			centres.push(cell + track / 2);
		}
	}
	return { edges: uniqueSorted(edges), centres: uniqueSorted(centres) };
}

/**
 * Candidate chart widths: k cells of an n-way split plus (k−1) gutters, for n in
 * 1..4, k in 1..n, both from the content width and (converted through the aspect)
 * from the content height. Only sizes that fit the content box with no side under
 * MIN_CHART_SIDE_MM are kept; deduplicated, ascending.
 */
export function sizeCandidates(o: PageOrientation, aspect: number): number[] {
	const box = contentBox(o);
	const widths: number[] = [];
	for (let n = 1; n <= MAX_SPLIT; n++) {
		for (let k = 1; k <= n; k++) {
			widths.push(spanSize(box.w, n, k), spanSize(box.h, n, k) * aspect);
		}
	}
	const min = minWidth(aspect);
	const max = maxWidth(box, aspect);
	return uniqueSorted(widths.filter((w) => w >= min - EPS && w <= max + EPS));
}

/**
 * Whether `a` and `b` come closer than `gutter` (0: whether they intersect).
 * Frames exactly `gutter` apart, or touching with no gutter, do not overlap.
 */
export function overlaps(a: Rect, b: Rect, gutter = 0): boolean {
	return (
		a.x < b.x + b.w + gutter - EPS &&
		b.x < a.x + a.w + gutter - EPS &&
		a.y < b.y + b.h + gutter - EPS &&
		b.y < a.y + a.h + gutter - EPS
	);
}

// === Snapping ===

/**
 * What a target line accepts: `edge` either edge of the frame, `start`/`end` only
 * its left/top or right/bottom (one gutter off another chart, on the side facing
 * it), `centre` its centre.
 */
type TargetKind = 'edge' | 'start' | 'end' | 'centre';
type Feature = 'start' | 'centre' | 'end';

interface Target {
	at: number;
	kind: TargetKind;
	/** The chart the line belongs to; none for grid lines. */
	other?: Rect;
}

function accepts(kind: TargetKind, feature: Feature): boolean {
	if (kind === 'edge') return feature !== 'centre';
	return kind === feature;
}

/** Snap lines along `axis`: the grid, then each other chart's edges, gutter lines and centre. */
function targets(o: PageOrientation, axis: Axis, others: readonly Rect[]): Target[] {
	const grid = gridLines(o, axis);
	const list: Target[] = [
		...grid.edges.map((at): Target => ({ at, kind: 'edge' })),
		...grid.centres.map((at): Target => ({ at, kind: 'centre' }))
	];
	for (const other of others) {
		const [lo, size] = span(other, axis);
		list.push(
			{ at: lo, kind: 'edge', other },
			{ at: lo + size, kind: 'edge', other },
			{ at: lo - GUTTER_MM, kind: 'end', other },
			{ at: lo + size + GUTTER_MM, kind: 'start', other },
			{ at: lo + size / 2, kind: 'centre', other }
		);
	}
	return list;
}

/**
 * Guides for every target that `value` (a `feature` of `frame`) lies on. A grid
 * line spans the content box; a chart's line spans that chart and the frame.
 */
function guidesAt(
	axis: Axis,
	value: number,
	feature: Feature,
	frame: Rect,
	list: readonly Target[],
	box: Rect
): SnapGuide[] {
	const cross: Axis = axis === 'x' ? 'y' : 'x';
	const [frameLo, frameSize] = span(frame, cross);
	const guides: SnapGuide[] = [];
	for (const target of list) {
		if (!accepts(target.kind, feature) || Math.abs(target.at - value) > EPS) continue;
		const [lo, size] = target.other ? span(target.other, cross) : span(box, cross);
		guides.push(
			target.other
				? {
						axis,
						at: target.at,
						from: Math.min(lo, frameLo),
						to: Math.max(lo + size, frameLo + frameSize)
					}
				: { axis, at: target.at, from: lo, to: lo + size }
		);
	}
	return guides;
}

/** One guide per line: guides on the same line merge into the union of their spans. */
function mergeGuides(guides: readonly SnapGuide[]): SnapGuide[] {
	const merged: SnapGuide[] = [];
	for (const guide of guides) {
		const same = merged.find((g) => g.axis === guide.axis && Math.abs(g.at - guide.at) <= EPS);
		if (same) {
			same.from = Math.min(same.from, guide.from);
			same.to = Math.max(same.to, guide.to);
		} else {
			merged.push({ ...guide });
		}
	}
	return merged;
}

const FEATURES: readonly Feature[] = ['start', 'centre', 'end'];
const FEATURE_OFFSET: Record<Feature, number> = { start: 0, centre: 0.5, end: 1 };

/**
 * The shift along one axis that puts the frame's start, centre or end on the
 * nearest accepting target within `threshold` (inclusive), keeping the frame
 * within [lo, hi]. 0 when nothing is in reach.
 */
function snapShift(
	pos: number,
	size: number,
	list: readonly Target[],
	threshold: number,
	lo: number,
	hi: number
): number {
	let best: number | null = null;
	for (const target of list) {
		for (const feature of FEATURES) {
			if (!accepts(target.kind, feature)) continue;
			const shift = target.at - (pos + FEATURE_OFFSET[feature] * size);
			if (Math.abs(shift) > threshold + EPS) continue;
			if (pos + shift < lo - EPS || pos + shift + size > hi + EPS) continue;
			if (best === null || Math.abs(shift) < Math.abs(best) - EPS) best = shift;
		}
	}
	return best ?? 0;
}

/**
 * Snap a moved frame: its left/centre/right to the column lines of the 1..4 splits
 * (edges to cell edges, the centre to cell centres) and to the edges, gutter lines
 * and centres of `others`; the same for top/middle/bottom. The frame is clamped
 * into the content box first, so dragging past the box stops at its edge. Its size
 * never changes. Returns the frame and every guide it lies on.
 */
export function snapMove(
	frame: Rect,
	others: readonly Rect[],
	o: PageOrientation,
	thresholdMm: number
): SnapResult {
	const box = contentBox(o);
	const clamped = clampPosition(frame, box);
	const xs = targets(o, 'x', others);
	const ys = targets(o, 'y', others);
	const snapped = {
		...clamped,
		x: clamped.x + snapShift(clamped.x, clamped.w, xs, thresholdMm, box.x, box.x + box.w),
		y: clamped.y + snapShift(clamped.y, clamped.h, ys, thresholdMm, box.y, box.y + box.h)
	};
	const guides = FEATURES.flatMap((feature) => [
		...guidesAt('x', snapped.x + FEATURE_OFFSET[feature] * snapped.w, feature, snapped, xs, box),
		...guidesAt('y', snapped.y + FEATURE_OFFSET[feature] * snapped.h, feature, snapped, ys, box)
	]);
	return { frame: snapped, guides: mergeGuides(guides) };
}

/**
 * Snap a resize around a fixed anchor corner (`'nw'`: the top-left stays put and
 * the frame grows right and down), aspect locked.
 *
 * `frame` is the rect from the anchor to the pointer and may be negative where the
 * pointer crossed the anchor; its size along the dominant axis (the larger of `w`
 * and `h × aspect`) is the raw width. That width is clamped to [the smallest side,
 * the room to the content box], then the moving edges snap: the vertical one to the
 * column lines and other charts' edges and gutter lines, the horizontal one to the
 * row lines and the same, or the width to a size candidate (reach measured at the
 * corner, on both axes). The other dimension follows the aspect. Guides mark the
 * lines the moving edges end up on; a size snap off the grid has none.
 */
export function snapResize(
	frame: Rect,
	anchor: ResizeAnchor,
	aspect: number,
	others: readonly Rect[],
	o: PageOrientation,
	thresholdMm: number
): SnapResult {
	const box = contentBox(o);
	// Growth direction: +1 grows right/down from the anchor, −1 left/up.
	const sx = anchor === 'nw' || anchor === 'sw' ? 1 : -1;
	const sy = anchor === 'nw' || anchor === 'ne' ? 1 : -1;
	const ax = clamp(sx > 0 ? frame.x : frame.x + frame.w, box.x, box.x + box.w);
	const ay = clamp(sy > 0 ? frame.y : frame.y + frame.h, box.y, box.y + box.h);
	const roomX = sx > 0 ? box.x + box.w - ax : ax - box.x;
	const roomY = sy > 0 ? box.y + box.h - ay : ay - box.y;
	const minW = minWidth(aspect);
	const maxW = Math.min(roomX, roomY * aspect);
	const place = (w: number): Rect => {
		const h = w / aspect;
		return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
	};

	if (maxW < minW - EPS) {
		// The anchor is too close to the box for the smallest chart: let it move.
		return { frame: clampPosition(place(Math.min(minW, maxWidth(box, aspect))), box), guides: [] };
	}

	const raw = clamp(Math.max(frame.w, frame.h * aspect), minW, maxW);
	const movingX: Feature = sx > 0 ? 'end' : 'start';
	const movingY: Feature = sy > 0 ? 'end' : 'start';
	const xs = targets(o, 'x', others).filter((t) => accepts(t.kind, movingX));
	const ys = targets(o, 'y', others).filter((t) => accepts(t.kind, movingY));

	// Each candidate width with its reach: how far the snapping edge (or, for a size,
	// the corner on either axis) moves to get there.
	const candidates = [
		...xs.map((t) => {
			const w = sx * (t.at - ax);
			return { w, reach: Math.abs(w - raw) };
		}),
		...ys.map((t) => {
			const h = sy * (t.at - ay);
			return { w: h * aspect, reach: Math.abs(h - raw / aspect) };
		}),
		...sizeCandidates(o, aspect).map((w) => {
			const dw = Math.abs(w - raw);
			return { w, reach: Math.max(dw, dw / aspect) };
		})
	];
	let width = raw;
	let bestReach = Infinity;
	for (const { w, reach } of candidates) {
		if (reach > thresholdMm + EPS || w < minW - EPS || w > maxW + EPS) continue;
		if (reach < bestReach - EPS) {
			width = w;
			bestReach = reach;
		}
	}

	const snapped = place(clamp(width, minW, maxW));
	const edgeX = sx > 0 ? snapped.x + snapped.w : snapped.x;
	const edgeY = sy > 0 ? snapped.y + snapped.h : snapped.y;
	const guides = [
		...guidesAt('x', edgeX, movingX, snapped, xs, box),
		...guidesAt('y', edgeY, movingY, snapped, ys, box)
	];
	return { frame: snapped, guides: mergeGuides(guides) };
}

// === Placement ===

/**
 * Where Add to PDF puts a chart: the first page (in order) with room, else a new
 * page. Room means a frame on the grid lines (or against another chart, one gutter
 * off) that does not overlap any chart, gutter included, and lies in the content
 * box. Sizes are tried from the preferred width down to a third of the content
 * width (from `sizeCandidates`): preferred is the full content width for an empty
 * page, half of it (one of two columns) otherwise. A chart too tall to be a third
 * as wide still gets its largest size that fits; one too wide to be half as wide
 * (a panorama past 2.25:1 on a portrait page) tries its sizes from the smallest up.
 * Within a page the largest size wins, then top-to-bottom, left-to-right. On a new
 * (portrait) page the chart gets the full content width, capped by the height.
 */
export function findPlacement(
	pages: readonly DocPage[],
	aspect: number
): { pageIndex: number | null; frame: Rect } {
	for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
		const { orientation, items } = pages[pageIndex];
		const box = contentBox(orientation);
		const preferred = items.length === 0 ? box.w : trackSize(box.w, 2);
		const smallest = Math.min(trackSize(box.w, 3), maxWidth(box, aspect));
		const sizes = sizeCandidates(orientation, aspect);
		const fitting = sizes.filter((w) => w <= preferred + EPS && w >= smallest - EPS).reverse();
		// Every size of a wide chart is over half the width: the smallest that fits, then.
		const widths = fitting.length > 0 ? fitting : sizes;
		const obstacles = items.map((item) => item.frame);
		const frame = findSpot(orientation, aspect, obstacles, widths);
		if (frame) return { pageIndex, frame };
	}
	const box = contentBox('portrait');
	const w = maxWidth(box, aspect);
	return { pageIndex: null, frame: { x: box.x, y: box.y, w, h: w / aspect } };
}

/**
 * The first free frame for the widths in order: for each width every position whose
 * start or end is on a grid edge line, or against an obstacle (aligned with it or
 * one gutter off), tried top-to-bottom, left-to-right.
 */
function findSpot(
	o: PageOrientation,
	aspect: number,
	obstacles: readonly Rect[],
	widths: readonly number[]
): Rect | null {
	const box = contentBox(o);
	for (const w of widths) {
		const h = w / aspect;
		const xs = spotPositions(o, 'x', w, obstacles);
		const ys = spotPositions(o, 'y', h, obstacles);
		for (const y of ys) {
			for (const x of xs) {
				const frame = { x, y, w, h };
				if (inside(frame, box) && !obstacles.some((ob) => overlaps(frame, ob, GUTTER_MM))) {
					return frame;
				}
			}
		}
	}
	return null;
}

function spotPositions(o: PageOrientation, axis: Axis, size: number, obstacles: readonly Rect[]) {
	const box = contentBox(o);
	const [lo, length] = span(box, axis);
	const starts = gridLines(o, axis).edges.flatMap((e) => [e, e - size]);
	for (const ob of obstacles) {
		const [start, extent] = span(ob, axis);
		starts.push(start, start + extent - size, start + extent + GUTTER_MM, start - GUTTER_MM - size);
	}
	return uniqueSorted(starts.filter((s) => s >= lo - EPS && s + size <= lo + length + EPS));
}

// === Fitting ===

/**
 * `frame` at `aspect` (its width kept, the height following), inside the content
 * box: scaled down if it is too large, raised to the smallest side where the box
 * allows, then moved in as little as possible.
 */
export function fitFrame(frame: Rect, aspect: number, o: PageOrientation): Rect {
	const box = contentBox(o);
	const w = Math.min(Math.max(frame.w, minWidth(aspect)), maxWidth(box, aspect));
	return clampPosition({ x: frame.x, y: frame.y, w, h: w / aspect }, box);
}

/**
 * The frame one size step larger (`1`) or smaller (`-1`): the next size candidate
 * past its width, its top-left kept where the content box allows (`fitFrame`). Null
 * when there is no size further that way.
 */
export function stepSize(
	frame: Rect,
	aspect: number,
	o: PageOrientation,
	direction: 1 | -1
): Rect | null {
	const sizes = sizeCandidates(o, aspect);
	const w =
		direction > 0
			? sizes.find((size) => size > frame.w + EPS)
			: [...sizes].reverse().find((size) => size < frame.w - EPS);
	return w === undefined ? null : fitFrame({ ...frame, w, h: w / aspect }, aspect, o);
}

/**
 * Where a chart goes on a page when nothing points at a spot (a turn of the page, a
 * move from the keyboard): like Add to PDF places one, clear of `others`, from its
 * own width (capped by the box) down through the size candidates, top-to-bottom,
 * left-to-right. With no room it is scaled down into the box where it was
 * (`fitFrame`), which may overlap; the editor can fix that.
 */
export function placeFrame(
	frame: Rect,
	aspect: number,
	others: readonly Rect[],
	o: PageOrientation
): Rect {
	const own = Math.min(frame.w, maxWidth(contentBox(o), aspect));
	const widths = uniqueSorted([
		own,
		...sizeCandidates(o, aspect).filter((w) => w <= own + EPS)
	]).reverse();
	return findSpot(o, aspect, others, widths) ?? fitFrame(frame, aspect, o);
}

/**
 * A page's frames after it turned from `from` to `to`: the layout turns with the
 * page, as a block, in whichever of two ways shrinks it less. Turned, rows of charts
 * become columns (left-to-right becoming top-to-bottom) with the gaps between them
 * kept, so two discs side by side on a landscape page stand one above the other on
 * a portrait one; kept, the arrangement stays and is only fitted in (a stack of wide
 * panoramas stays a stack). A tie keeps it. The block keeps its place in the free
 * space (centred stays centred, against an edge stays there) and shrinks uniformly
 * only when it no longer fits; it never grows, so turning back restores the layout
 * whenever neither turn had to shrink it. A chart that would end up under the
 * smallest side is placed again on its own (`placeFrame`).
 */
export function rotateLayout(
	items: readonly { frame: Rect; aspect: number }[],
	from: PageOrientation,
	to: PageOrientation
): Rect[] {
	if (items.length === 0 || from === to) return items.map(({ frame }) => ({ ...frame }));
	const frames = items.map(({ frame }) => frame);
	const oldBox = contentBox(from);
	const newBox = contentBox(to);
	const old = boundingRect(frames);
	// Where the block sat in the old free space, as fractions of it.
	const fx = freeFraction(old.x - oldBox.x, oldBox.w - old.w);
	const fy = freeFraction(old.y - oldBox.y, oldBox.h - old.h);

	const kept = frames.map((f) => ({ ...f, x: f.x - old.x, y: f.y - old.y }));
	const turned = transposeRows(frames);
	const keptScale = fitScale(old.w, old.h, newBox);
	const turnedScale = fitScale(turned.w, turned.h, newBox);
	const turn = turnedScale > keptScale + EPS;
	const scale = turn ? turnedScale : keptScale;
	const rects = turn ? turned.rects : kept;
	const [blockW, blockH] = turn ? [turned.w, turned.h] : [old.w, old.h];
	// Turned, the axes swap, and so do the fractions.
	const [ax, ay] = turn ? [fy, fx] : [fx, fy];
	const originX = newBox.x + ax * Math.max(0, newBox.w - blockW * scale);
	const originY = newBox.y + ay * Math.max(0, newBox.h - blockH * scale);

	const result = rects.map((rect) => ({
		x: originX + rect.x * scale,
		y: originY + rect.y * scale,
		w: rect.w * scale,
		h: rect.h * scale
	}));
	const small = result.map((rect, i) => rect.w + EPS < minWidth(items[i].aspect));
	const settled = result.filter((_, i) => !small[i]);
	return result.map((rect, i) => {
		if (!small[i]) return rect;
		const placed = placeFrame(rect, items[i].aspect, settled, to);
		settled.push(placed);
		return placed;
	});
}

/** The scale that fits a `w` × `h` block into `box`, at most 1. */
function fitScale(w: number, h: number, box: Rect): number {
	return Math.min(1, box.w / w, box.h / h);
}

/**
 * The frames with rows made columns, relative to the new block's top-left: each
 * row's charts stacked in their left-to-right order with the horizontal gaps
 * between them, each as far in from the column's left as it sat below the row's top,
 * and the columns following each other with the rows' gaps. A row is every chart that
 * overlaps it vertically, taken top-down.
 */
function transposeRows(frames: readonly Rect[]): { rects: Rect[]; w: number; h: number } {
	const order = frames
		.map((_, i) => i)
		.sort((a, b) => frames[a].y - frames[b].y || frames[a].x - frames[b].x);
	const rows: { members: number[]; top: number; bottom: number }[] = [];
	for (const i of order) {
		const f = frames[i];
		const row = rows.at(-1);
		if (row && f.y < row.bottom - EPS) {
			row.members.push(i);
			row.bottom = Math.max(row.bottom, f.y + f.h);
		} else {
			rows.push({ members: [i], top: f.y, bottom: f.y + f.h });
		}
	}

	const rects: Rect[] = new Array(frames.length);
	let columnLeft = 0;
	let w = 0;
	let h = 0;
	rows.forEach((row, r) => {
		const members = [...row.members].sort((a, b) => frames[a].x - frames[b].x);
		let top = 0;
		let width = 0;
		members.forEach((i, k) => {
			const f = frames[i];
			if (k > 0) {
				const before = frames[members[k - 1]];
				top += Math.max(0, f.x - (before.x + before.w));
			}
			const inset = f.y - row.top;
			rects[i] = { x: columnLeft + inset, y: top, w: f.w, h: f.h };
			top += f.h;
			width = Math.max(width, inset + f.w);
		});
		w = columnLeft + width;
		h = Math.max(h, top);
		const next = rows[r + 1];
		if (next) columnLeft += width + Math.max(0, next.top - row.bottom);
	});
	return { rects, w, h };
}

/** How far into its free space a block sits, 0..1; centred when there is none. */
function freeFraction(offset: number, free: number): number {
	return free > EPS ? clamp(offset / free, 0, 1) : 0.5;
}

function boundingRect(frames: readonly Rect[]): Rect {
	const x = Math.min(...frames.map((f) => f.x));
	const y = Math.min(...frames.map((f) => f.y));
	const right = Math.max(...frames.map((f) => f.x + f.w));
	const bottom = Math.max(...frames.map((f) => f.y + f.h));
	return { x, y, w: right - x, h: bottom - y };
}

// === Helpers ===

function span(rect: Rect, axis: Axis): [number, number] {
	return axis === 'x' ? [rect.x, rect.w] : [rect.y, rect.h];
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.min(Math.max(value, lo), hi);
}

/** Moves `frame` into `box` without resizing it (to the top-left if it is larger). */
function clampPosition(frame: Rect, box: Rect): Rect {
	return {
		...frame,
		x: Math.max(box.x, Math.min(frame.x, box.x + box.w - frame.w)),
		y: Math.max(box.y, Math.min(frame.y, box.y + box.h - frame.h))
	};
}

function inside(frame: Rect, box: Rect): boolean {
	return (
		frame.x >= box.x - EPS &&
		frame.y >= box.y - EPS &&
		frame.x + frame.w <= box.x + box.w + EPS &&
		frame.y + frame.h <= box.y + box.h + EPS
	);
}

/** The smallest width with no side under MIN_CHART_SIDE_MM. */
function minWidth(aspect: number): number {
	return MIN_CHART_SIDE_MM * Math.max(1, aspect);
}

/** The largest width at `aspect` that fits `box`. */
function maxWidth(box: Rect, aspect: number): number {
	return Math.min(box.w, box.h * aspect);
}

function uniqueSorted(values: readonly number[]): number[] {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] > EPS);
}
