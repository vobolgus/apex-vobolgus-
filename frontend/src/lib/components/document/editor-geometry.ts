/**
 * Screen geometry of the page editor: where the three pages sit on the stage,
 * screen px ↔ page mm, which page a dragged chart is over, and the raw frames a
 * pointer drag asks the layout engine for. Pure functions, no DOM.
 *
 * Every page on the stage is drawn at one shared scale (screen px per mm), so a
 * chart dragged onto a neighbouring page keeps its size on screen and on paper.
 */

import type { ResizeAnchor } from '$lib/document/geometry';
import type { Rect } from '$lib/document/types';

export interface Size {
	w: number;
	h: number;
}

export interface Point {
	x: number;
	y: number;
}

/** A box in screen px, the shape of a DOMRect. */
export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export type SlotRole = 'prev' | 'current' | 'next';

export interface EditorLayoutOptions {
	/** Height of the label row above each page, px. */
	labelHeight: number;
	/** Between neighbouring pages when all three are in view, px. */
	gap: number;
	/** Between pages in the narrow layout, px. */
	narrowGap: number;
	/** Stage padding around the pages, px. */
	padding: number;
	/** In the narrow layout, how much of each neighbour stays in view, px. */
	peek: number;
	/** Largest zoom, px per mm: a page on a 4K screen stays a page, not a poster. */
	maxScale: number;
	/** Fitting all three pages may shrink them to this share of the narrow layout's size. */
	narrowRatio: number;
}

export const EDITOR_LAYOUT: EditorLayoutOptions = {
	labelHeight: 36,
	gap: 40,
	narrowGap: 16,
	padding: 24,
	peek: 16,
	maxScale: 3,
	narrowRatio: 0.55
};

/** Below this zoom the stage is not laid out yet (no size); keep the math finite. */
const MIN_SCALE = 0.05;

export interface EditorLayout {
	/** Screen px per mm, shared by every page on the stage. */
	scale: number;
	/** The current page fills the stage and its neighbours only peek in at the edges. */
	narrow: boolean;
	/** Each page's paper, in stage px. */
	slots: Partial<Record<SlotRole, Box>>;
}

/**
 * Previous, current and next page side by side, the current one centred and the
 * page tops aligned. All three fit when that keeps them at least `narrowRatio` of
 * the size the current page would have alone; otherwise (a phone) the current page
 * takes the width and its neighbours peek in by `peek` px, clipped by the stage.
 * The space for a missing neighbour stays reserved, so the current page never
 * jumps sideways at either end of the document.
 */
export function editorLayout(
	stage: Size,
	pages: { prev: Size | null; current: Size; next: Size | null },
	options: EditorLayoutOptions = EDITOR_LAYOUT
): EditorLayout {
	const { labelHeight, gap, narrowGap, padding, peek, maxScale, narrowRatio } = options;
	const { prev, current, next } = pages;
	const tallest = Math.max(current.h, prev?.h ?? 0, next?.h ?? 0);
	const side = Math.max(prev?.w ?? 0, next?.w ?? 0);
	const byHeight = (stage.h - 2 * padding - labelHeight) / tallest;
	const alone = (stage.w - 2 * padding) / current.w;

	let scale: number;
	let narrow = false;
	if (side === 0) {
		scale = Math.min(byHeight, alone, maxScale);
	} else {
		// Half the stage holds half the current page, a gap and the wider neighbour.
		const byWidth = (stage.w / 2 - padding - gap) / (current.w / 2 + side);
		const wide = Math.min(byHeight, byWidth, maxScale);
		const peeking = Math.min(byHeight, (stage.w - 2 * (narrowGap + peek)) / current.w, maxScale);
		narrow = wide < narrowRatio * peeking;
		scale = narrow ? peeking : wide;
	}
	scale = Math.max(MIN_SCALE, scale);

	const band = labelHeight + tallest * scale;
	const top = Math.max(padding, (stage.h - band) / 2) + labelHeight;
	const width = current.w * scale;
	const left = (stage.w - width) / 2;
	const between = narrow ? narrowGap : gap;
	const slots: EditorLayout['slots'] = {
		current: { left, top, width, height: current.h * scale }
	};
	if (prev) {
		slots.prev = {
			left: left - between - prev.w * scale,
			top,
			width: prev.w * scale,
			height: prev.h * scale
		};
	}
	if (next) {
		slots.next = {
			left: left + width + between,
			top,
			width: next.w * scale,
			height: next.h * scale
		};
	}
	return { scale, narrow, slots };
}

/** `box` moved by `dx`, `dy` (stage px to screen px: add the stage's own offset). */
export function offsetBox(box: Box, dx: number, dy: number): Box {
	return { ...box, left: box.left + dx, top: box.top + dy };
}

export function containsPoint(box: Box, point: Point, slack = 0): boolean {
	return (
		point.x >= box.left - slack &&
		point.x <= box.left + box.width + slack &&
		point.y >= box.top - slack &&
		point.y <= box.top + box.height + slack
	);
}

/** A screen point in a page's mm, the page's paper at `box` drawn at `scale` px per mm. */
export function screenToMm(point: Point, box: Box, scale: number): Point {
	return { x: (point.x - box.left) / scale, y: (point.y - box.top) / scale };
}

/** A page's mm point on screen; the inverse of `screenToMm`. */
export function mmToScreen(point: Point, box: Box, scale: number): Point {
	return { x: box.left + point.x * scale, y: box.top + point.y * scale };
}

/**
 * The page a chart dragged to `point` would land on: the page under the pointer,
 * or the current page while the pointer is within `slack` px of it (pushing a chart
 * against the margin often takes the pointer a little past the paper's edge).
 * Anywhere else is null: dropped there, the chart goes back where it was.
 */
export function dropTarget(
	point: Point,
	pages: readonly { id: string; box: Box }[],
	currentId: string,
	slack: number
): string | null {
	const hit = pages.find((page) => containsPoint(page.box, point));
	if (hit) return hit.id;
	const current = pages.find((page) => page.id === currentId);
	return current && containsPoint(current.box, point, slack) ? currentId : null;
}

/**
 * Where a chart lands under the pointer: the point of the chart that was grabbed
 * (`grab`, mm from the chart's top-left) goes under `pointer` (mm on the target
 * page). `size` may be smaller than the chart was, when the target page is too
 * small for it; the grab point scales with it so the chart stays under the pointer.
 */
export function frameUnderPointer(pointer: Point, grab: Point, from: Size, size: Size): Rect {
	const kx = size.w / from.w;
	const ky = size.h / from.h;
	return { x: pointer.x - grab.x * kx, y: pointer.y - grab.y * ky, w: size.w, h: size.h };
}

/** The corner a resize keeps fixed when `handle` is dragged: the opposite one. */
export function anchorOf(handle: ResizeAnchor): ResizeAnchor {
	const opposite: Record<ResizeAnchor, ResizeAnchor> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
	return opposite[handle];
}

/** A corner of `frame`. */
export function cornerOf(frame: Rect, corner: ResizeAnchor): Point {
	return {
		x: corner === 'nw' || corner === 'sw' ? frame.x : frame.x + frame.w,
		y: corner === 'nw' || corner === 'ne' ? frame.y : frame.y + frame.h
	};
}

/**
 * The rect from a fixed `anchor` corner (at `anchorPoint`) to the dragged corner
 * (at `pointer`), in the form `snapResize` takes: it grows away from the anchor and
 * goes negative where the pointer crossed it.
 */
export function resizeRect(anchor: ResizeAnchor, anchorPoint: Point, pointer: Point): Rect {
	const sx = anchor === 'nw' || anchor === 'sw' ? 1 : -1;
	const sy = anchor === 'nw' || anchor === 'ne' ? 1 : -1;
	return {
		x: sx > 0 ? anchorPoint.x : pointer.x,
		y: sy > 0 ? anchorPoint.y : pointer.y,
		w: sx * (pointer.x - anchorPoint.x),
		h: sy * (pointer.y - anchorPoint.y)
	};
}

/** The nudge an arrow key asks for, mm: 1 mm, 10 with Shift. Null for any other key. */
export function nudgeDelta(key: string, shift: boolean): Point | null {
	const step = shift ? 10 : 1;
	switch (key) {
		case 'ArrowLeft':
			return { x: -step, y: 0 };
		case 'ArrowRight':
			return { x: step, y: 0 };
		case 'ArrowUp':
			return { x: 0, y: -step };
		case 'ArrowDown':
			return { x: 0, y: step };
		default:
			return null;
	}
}

/**
 * The size step a key asks for: 1 for + (or =, the same key without Shift), −1 for
 * −, also on the number pad; 0 for any other key. By the character typed, which
 * puts them where the keycaps say on every layout.
 */
export function sizeStep(key: string, code: string): 1 | -1 | 0 {
	if (key === '+' || key === '=' || code === 'NumpadAdd') return 1;
	if (key === '-' || key === '−' || code === 'NumpadSubtract') return -1;
	return 0;
}

/** "90 by 90 mm": a chart's size for its accessible name, to the millimetre. */
export function spokenSize(frame: Rect): string {
	return `${Math.round(frame.w)} by ${Math.round(frame.h)} mm`;
}

/** "120 × 90 mm": the size readout while a chart is resized. */
export function sizeLabel(frame: Rect): string {
	return `${Math.round(frame.w)} × ${Math.round(frame.h)} mm`;
}
