import { describe, expect, it } from 'vitest';
import { pageSize, snapResize, type ResizeAnchor } from '$lib/document/geometry';
import {
	anchorOf,
	containsPoint,
	cornerOf,
	dropTarget,
	EDITOR_LAYOUT,
	editorLayout,
	frameUnderPointer,
	mmToScreen,
	nudgeDelta,
	offsetBox,
	resizeRect,
	screenToMm,
	sizeLabel,
	spokenSize,
	type Box
} from './editor-geometry';

const PORTRAIT = pageSize('portrait');
const LANDSCAPE = pageSize('landscape');
const { labelHeight, gap, narrowGap, padding, peek, maxScale } = EDITOR_LAYOUT;

function right(box: Box) {
	return box.left + box.width;
}

describe('editorLayout', () => {
	it('puts three portrait pages side by side, the current one centred, at one scale', () => {
		const stage = { w: 1400, h: 700 };
		const { scale, narrow, slots } = editorLayout(stage, {
			prev: PORTRAIT,
			current: PORTRAIT,
			next: PORTRAIT
		});
		expect(narrow).toBe(false);
		const { prev, current, next } = slots;
		expect(current!.left + current!.width / 2).toBeCloseTo(stage.w / 2);
		for (const box of [prev!, current!, next!]) {
			expect(box.width).toBeCloseTo(210 * scale);
			expect(box.height).toBeCloseTo(297 * scale);
			expect(box.top).toBe(current!.top);
		}
		expect(current!.left - right(prev!)).toBeCloseTo(gap);
		expect(next!.left - right(current!)).toBeCloseTo(gap);
	});

	it('fits the tallest page into the stage height under its label', () => {
		const stage = { w: 3000, h: 600 };
		const { scale, slots } = editorLayout(stage, { prev: null, current: PORTRAIT, next: null });
		expect(scale).toBeCloseTo((stage.h - 2 * padding - labelHeight) / 297);
		const paper = slots.current!;
		expect(paper.top - labelHeight).toBeGreaterThanOrEqual(padding - 1e-9);
		expect(paper.top + paper.height).toBeLessThanOrEqual(stage.h - padding + 1e-9);
	});

	it('fits the width when the stage is short of it, keeping every page in view', () => {
		const stage = { w: 1100, h: 600 };
		const { narrow, slots } = editorLayout(stage, {
			prev: PORTRAIT,
			current: PORTRAIT,
			next: PORTRAIT
		});
		expect(narrow).toBe(false);
		expect(slots.prev!.left).toBeGreaterThanOrEqual(padding - 1e-9);
		expect(right(slots.next!)).toBeLessThanOrEqual(stage.w - padding + 1e-9);
	});

	it('keeps the current page centred at either end of the document', () => {
		const stage = { w: 1400, h: 700 };
		const both = editorLayout(stage, { prev: PORTRAIT, current: PORTRAIT, next: PORTRAIT });
		const first = editorLayout(stage, { prev: null, current: PORTRAIT, next: PORTRAIT });
		const last = editorLayout(stage, { prev: PORTRAIT, current: PORTRAIT, next: null });
		expect(first.slots.prev).toBeUndefined();
		expect(last.slots.next).toBeUndefined();
		expect(first.slots.current).toEqual(both.slots.current);
		expect(last.slots.current).toEqual(both.slots.current);
	});

	it('reserves the wider neighbour on both sides, so a landscape one keeps the centre', () => {
		const stage = { w: 1400, h: 700 };
		const { slots } = editorLayout(stage, { prev: PORTRAIT, current: PORTRAIT, next: LANDSCAPE });
		expect(slots.current!.left + slots.current!.width / 2).toBeCloseTo(stage.w / 2);
		expect(right(slots.next!)).toBeLessThanOrEqual(stage.w - padding + 1e-9);
		expect(slots.next!.width / slots.next!.height).toBeCloseTo(297 / 210);
	});

	it('on a phone gives the current page the width and lets its neighbours peek in', () => {
		const stage = { w: 390, h: 700 };
		const { scale, narrow, slots } = editorLayout(stage, {
			prev: PORTRAIT,
			current: PORTRAIT,
			next: PORTRAIT
		});
		expect(narrow).toBe(true);
		expect(scale).toBeCloseTo((stage.w - 2 * (narrowGap + peek)) / 210);
		expect(right(slots.prev!)).toBeCloseTo(peek);
		expect(slots.next!.left).toBeCloseTo(stage.w - peek);
	});

	it('does not zoom past the largest scale', () => {
		const { scale } = editorLayout(
			{ w: 5000, h: 4000 },
			{ prev: PORTRAIT, current: PORTRAIT, next: PORTRAIT }
		);
		expect(scale).toBe(maxScale);
	});

	it('stays finite on a stage with no size yet', () => {
		const { scale, slots } = editorLayout(
			{ w: 0, h: 0 },
			{ prev: PORTRAIT, current: LANDSCAPE, next: null }
		);
		expect(scale).toBeGreaterThan(0);
		expect(Number.isFinite(slots.current!.left)).toBe(true);
	});
});

describe('screen px and page mm', () => {
	const box: Box = { left: 100, top: 50, width: 420, height: 594 };

	it('maps a screen point into the page at its scale', () => {
		expect(screenToMm({ x: 100, y: 50 }, box, 2)).toEqual({ x: 0, y: 0 });
		expect(screenToMm({ x: 124, y: 74 }, box, 2)).toEqual({ x: 12, y: 12 });
		expect(screenToMm({ x: 520, y: 644 }, box, 2)).toEqual({ x: 210, y: 297 });
		// Off the page is outside 0..size, not clamped.
		expect(screenToMm({ x: 90, y: 40 }, box, 2)).toEqual({ x: -5, y: -5 });
	});

	it('maps back to the same screen point', () => {
		const point = { x: 333.3, y: 211.7 };
		const mm = screenToMm(point, box, 1.73);
		const back = mmToScreen(mm, box, 1.73);
		expect(back.x).toBeCloseTo(point.x);
		expect(back.y).toBeCloseTo(point.y);
	});

	it('moves a stage box to the screen by the stage offset', () => {
		expect(offsetBox(box, 12, -8)).toEqual({ left: 112, top: 42, width: 420, height: 594 });
	});

	it('contains points on the edges and within the slack', () => {
		expect(containsPoint(box, { x: 100, y: 50 })).toBe(true);
		expect(containsPoint(box, { x: 520, y: 644 })).toBe(true);
		expect(containsPoint(box, { x: 99, y: 60 })).toBe(false);
		expect(containsPoint(box, { x: 90, y: 60 }, 10)).toBe(true);
		expect(containsPoint(box, { x: 89, y: 60 }, 10)).toBe(false);
	});
});

describe('dropTarget', () => {
	const pages = [
		{ id: 'prev', box: { left: 0, top: 0, width: 200, height: 280 } },
		{ id: 'current', box: { left: 240, top: 0, width: 200, height: 280 } },
		{ id: 'next', box: { left: 480, top: 0, width: 280, height: 200 } }
	];

	it('is the page under the pointer', () => {
		expect(dropTarget({ x: 300, y: 100 }, pages, 'current', 24)).toBe('current');
		expect(dropTarget({ x: 50, y: 100 }, pages, 'current', 24)).toBe('prev');
		expect(dropTarget({ x: 600, y: 150 }, pages, 'current', 24)).toBe('next');
	});

	it('keeps the current page while the pointer strays just past its edge', () => {
		expect(dropTarget({ x: 300, y: 300 }, pages, 'current', 24)).toBe('current');
		expect(dropTarget({ x: 230, y: 100 }, pages, 'current', 24)).toBe('current');
	});

	it('prefers a neighbour under the pointer to the slack around the current page', () => {
		expect(dropTarget({ x: 460, y: 100 }, pages, 'current', 24)).toBe('current');
		expect(dropTarget({ x: 482, y: 100 }, pages, 'current', 24)).toBe('next');
	});

	it('is null off every page, even below a neighbour', () => {
		expect(dropTarget({ x: 300, y: 400 }, pages, 'current', 24)).toBeNull();
		expect(dropTarget({ x: 600, y: 230 }, pages, 'current', 24)).toBeNull();
		expect(dropTarget({ x: -40, y: 100 }, pages, 'current', 24)).toBeNull();
	});

	it('is null with no pages', () => {
		expect(dropTarget({ x: 0, y: 0 }, [], 'current', 24)).toBeNull();
	});
});

describe('frameUnderPointer', () => {
	it('puts the grabbed point under the pointer', () => {
		const frame = frameUnderPointer(
			{ x: 100, y: 80 },
			{ x: 30, y: 20 },
			{ w: 90, h: 90 },
			{
				w: 90,
				h: 90
			}
		);
		expect(frame).toEqual({ x: 70, y: 60, w: 90, h: 90 });
	});

	it('scales the grab point with a chart shrunk to fit its new page', () => {
		const frame = frameUnderPointer(
			{ x: 100, y: 80 },
			{ x: 100, y: 40 },
			{ w: 200, h: 100 },
			{
				w: 100,
				h: 50
			}
		);
		expect(frame).toEqual({ x: 50, y: 60, w: 100, h: 50 });
	});
});

describe('resize helpers', () => {
	const frame = { x: 20, y: 30, w: 80, h: 50 };

	it('anchors the opposite corner', () => {
		expect(anchorOf('nw')).toBe('se');
		expect(anchorOf('ne')).toBe('sw');
		expect(anchorOf('sw')).toBe('ne');
		expect(anchorOf('se')).toBe('nw');
	});

	it('finds each corner of a frame', () => {
		expect(cornerOf(frame, 'nw')).toEqual({ x: 20, y: 30 });
		expect(cornerOf(frame, 'ne')).toEqual({ x: 100, y: 30 });
		expect(cornerOf(frame, 'sw')).toEqual({ x: 20, y: 80 });
		expect(cornerOf(frame, 'se')).toEqual({ x: 100, y: 80 });
	});

	it('gives back the frame when the dragged corner has not moved, from every handle', () => {
		for (const handle of ['nw', 'ne', 'sw', 'se'] as ResizeAnchor[]) {
			const anchor = anchorOf(handle);
			expect(resizeRect(anchor, cornerOf(frame, anchor), cornerOf(frame, handle))).toEqual(frame);
		}
	});

	it('goes negative where the pointer crosses the anchor', () => {
		expect(resizeRect('nw', { x: 20, y: 30 }, { x: 10, y: 20 })).toEqual({
			x: 20,
			y: 30,
			w: -10,
			h: -10
		});
	});

	it('feeds snapResize a rect it keeps anchored', () => {
		const disc = { x: 12, y: 12, w: 90, h: 90 };
		for (const handle of ['nw', 'ne', 'sw', 'se'] as ResizeAnchor[]) {
			const anchor = anchorOf(handle);
			const fixed = cornerOf(disc, anchor);
			const corner = cornerOf(disc, handle);
			// Pull the dragged corner 10 mm outwards along x.
			const out = handle === 'nw' || handle === 'sw' ? -10 : 10;
			const raw = resizeRect(anchor, fixed, { x: corner.x + out, y: corner.y });
			const { frame: snapped } = snapResize(raw, anchor, 1, [], 'portrait', 0);
			expect(cornerOf(snapped, anchor).x).toBeCloseTo(Math.min(Math.max(fixed.x, 12), 198));
			expect(snapped.w).toBeCloseTo(snapped.h);
		}
	});
});

describe('keys and words', () => {
	it('nudges 1 mm, 10 with Shift, and ignores other keys', () => {
		expect(nudgeDelta('ArrowLeft', false)).toEqual({ x: -1, y: 0 });
		expect(nudgeDelta('ArrowRight', false)).toEqual({ x: 1, y: 0 });
		expect(nudgeDelta('ArrowUp', true)).toEqual({ x: 0, y: -10 });
		expect(nudgeDelta('ArrowDown', true)).toEqual({ x: 0, y: 10 });
		expect(nudgeDelta('Enter', false)).toBeNull();
	});

	it('says and shows a size to the millimetre', () => {
		const frame = { x: 0, y: 0, w: 89.6, h: 56.04 };
		expect(spokenSize(frame)).toBe('90 by 56 mm');
		expect(sizeLabel(frame)).toBe('90 × 56 mm');
	});
});
