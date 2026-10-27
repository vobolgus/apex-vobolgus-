import { describe, expect, it } from 'vitest';

import {
	CHART_CANVAS_BACKING_PX,
	MAX_FOV_DEG_PINHOLE,
	PINHOLE_ASPECT_RATIO_MAX,
	PINHOLE_ASPECT_RATIO_MIN,
	PINHOLE_CLIP_MARGIN_PX,
	PINHOLE_HANDLE_GAP_PX,
	PINHOLE_HEIGHT_FRAC_MAX,
	PINHOLE_HEIGHT_FRAC_MIN,
	PINHOLE_KEY_STEP_DEG,
	PINHOLE_KEY_STEP_SHIFT_DEG,
	PINHOLE_READOUT_GAP_PX,
	PINHOLE_READOUT_HEIGHT_PX
} from '../constants';
import {
	CORNER_HANDLES,
	EDGE_HANDLES,
	beginPinholeDrag,
	bracketPath,
	formatPinholeReadout,
	isNearRect,
	mirrorHandle,
	nearestAspectName,
	pinholeDragRequest,
	pinholeFovRange,
	pinholeFrameRect,
	pinholeHandleLayout,
	pinholeHandleState,
	pinholeKeyRequest,
	pinholeKeyStep,
	pinholeLimitState,
	pinholeLimits,
	pxPerFrac,
	readoutPlacement,
	resolvePinholeResize,
	verticalFovDeg,
	type PinholeLimits,
	type PinholeShape
} from './pinhole-frame';
import { getProjectionFrameParams } from './projection';

const S = 720;
const FINE_HITS = { edge: 16, edgeInset: 4, corner: 32 };
const DEFAULT_SHAPE: PinholeShape = { fovDeg: 120, aspectRatio: 1.9 / 1.18, heightFrac: 1.18 };
const MID_SHAPE: PinholeShape = { fovDeg: 72, aspectRatio: 16 / 9, heightFrac: 1 };

/** Roomy clip box: only the fixed fov / aspect / height bounds apply. */
function roomyLimits(shape: PinholeShape): PinholeLimits {
	return pinholeLimits(S, 2000, 2000, shape);
}

function widthOf(shape: PinholeShape): number {
	return shape.aspectRatio * shape.heightFrac;
}

function tanHalf(deg: number): number {
	return Math.tan((deg * Math.PI) / 360);
}

/** Centre of an SVG arc with rx = ry = r, no rotation, large-arc 0 (SVG spec F.6.5). */
function arcCentre(x1: number, y1: number, x2: number, y2: number, r: number, sweep: number) {
	const hx = (x1 - x2) / 2;
	const hy = (y1 - y2) / 2;
	const d2 = hx * hx + hy * hy;
	const coef = (sweep === 1 ? 1 : -1) * Math.sqrt(Math.max(0, (r * r - d2) / d2));
	return { x: coef * hy + (x1 + x2) / 2, y: -coef * hx + (y1 + y2) / 2 };
}

/** Parse `M x y L x y A R R 0 0 s x y L x y` into numbers. */
function parseBracket(d: string) {
	const n = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
	return {
		start: { x: n[0], y: n[1] },
		arcFrom: { x: n[2], y: n[3] },
		radius: n[4],
		sweep: n[8],
		arcTo: { x: n[9], y: n[10] },
		end: { x: n[11], y: n[12] }
	};
}

describe('pinholeFrameRect', () => {
	it('matches the renderer frame scaled from the canvas backing store', () => {
		const frame = pinholeFrameRect(S, MID_SHAPE.aspectRatio, MID_SHAPE.heightFrac);
		const canvas = getProjectionFrameParams(
			CHART_CANVAS_BACKING_PX,
			CHART_CANVAS_BACKING_PX,
			1,
			180,
			MID_SHAPE.fovDeg,
			MID_SHAPE.aspectRatio,
			MID_SHAPE.heightFrac
		);
		const scale = S / CHART_CANVAS_BACKING_PX;
		expect(frame.width).toBeCloseTo(canvas.pinholeViewportWidth * scale, 6);
		expect(frame.height).toBeCloseTo(canvas.pinholeViewportHeight * scale, 6);
		expect(frame.x + frame.width / 2).toBeCloseTo(S / 2, 9);
		expect(frame.y + frame.height / 2).toBeCloseTo(S / 2, 9);
	});

	it('scales the corner radius to CSS px and clamps it to half the short side', () => {
		expect(pinholeFrameRect(S, 1.6, 1.18).cornerRadius).toBeCloseTo(13.2, 6);
		const tiny = pinholeFrameRect(S, 1, 0.05);
		expect(tiny.cornerRadius).toBeCloseTo(tiny.height / 2, 9);
	});
});

describe('bracketPath', () => {
	it('draws every corner bracket concentric with the frame corner arc', () => {
		const frame = pinholeFrameRect(S, MID_SHAPE.aspectRatio, MID_SHAPE.heightFrac);
		const layout = pinholeHandleLayout(frame, FINE_HITS);
		const r = frame.cornerRadius;
		const arcCentres = {
			nw: { x: frame.x + r, y: frame.y + r },
			ne: { x: frame.x + frame.width - r, y: frame.y + r },
			se: { x: frame.x + frame.width - r, y: frame.y + frame.height - r },
			sw: { x: frame.x + r, y: frame.y + frame.height - r }
		};
		for (const corner of CORNER_HANDLES) {
			const b = parseBracket(layout.brackets[corner]);
			expect(b.radius).toBeCloseTo(r + PINHOLE_HANDLE_GAP_PX, 9);
			const c = arcCentre(b.arcFrom.x, b.arcFrom.y, b.arcTo.x, b.arcTo.y, b.radius, b.sweep);
			expect(c.x).toBeCloseTo(arcCentres[corner].x, 6);
			expect(c.y).toBeCloseTo(arcCentres[corner].y, 6);
		}
	});

	it('runs its arms along the sides, gap px outside the frame', () => {
		const b = parseBracket(bracketPath(100, 50, -1, -1, 13, 5, 14, 14));
		// Vertical arm on x = 100 − 5, horizontal arm on y = 50 − 5.
		expect(b.start.x).toBe(95);
		expect(b.arcFrom.x).toBe(95);
		expect(b.arcTo.y).toBe(45);
		expect(b.end.y).toBe(45);
		expect(b.start.y - b.arcFrom.y).toBe(14);
		expect(b.end.x - b.arcTo.x).toBe(14);
	});
});

describe('pinholeHandleLayout', () => {
	it('drops the pills of sides shorter than 120 px and the arms of sides under 40 px', () => {
		// 30 × 100 px frame: no pills on either axis, no arms along the 30 px width.
		const k = pxPerFrac(S);
		const frame = pinholeFrameRect(S, 30 / 100, 100 / k);
		const layout = pinholeHandleLayout(frame, FINE_HITS);
		expect(layout.pills.n).toBeNull();
		expect(layout.pills.e).toBeNull();
		const nw = parseBracket(layout.brackets.nw);
		expect(nw.end.x).toBeCloseTo(nw.arcTo.x, 9);
		// The 100 px side keeps its full arm.
		expect(nw.start.y - nw.arcFrom.y).toBeCloseTo(14, 9);
	});

	it('keeps the two brackets of a side apart', () => {
		const k = pxPerFrac(S);
		const frame = pinholeFrameRect(S, 300 / 50, 50 / k);
		const layout = pinholeHandleLayout(frame, FINE_HITS);
		const nw = parseBracket(layout.brackets.nw);
		const sw = parseBracket(layout.brackets.sw);
		expect(nw.start.y).toBeLessThan(sw.start.y);
	});

	it('puts most of each hit outside the frame, corners flush with the edges outer line', () => {
		const frame = pinholeFrameRect(S, MID_SHAPE.aspectRatio, MID_SHAPE.heightFrac);
		const { hits } = pinholeHandleLayout(frame, FINE_HITS);
		expect(hits.n.y).toBeCloseTo(frame.y - 12, 9);
		expect(hits.n.y + hits.n.height).toBeCloseTo(frame.y + 4, 9);
		expect(hits.e.x).toBeCloseTo(frame.x + frame.width - 4, 9);
		expect(hits.n.x).toBeCloseTo(frame.x + frame.cornerRadius, 9);
		expect(hits.n.width).toBeCloseTo(frame.width - 2 * frame.cornerRadius, 9);
		expect(hits.nw.x).toBeCloseTo(hits.w.x, 9);
		expect(hits.nw.y).toBeCloseTo(hits.n.y, 9);
		expect(hits.se.x + hits.se.width).toBeCloseTo(hits.e.x + hits.e.width, 9);
		expect(hits.se.width).toBe(32);
	});
});

describe('handles and hover', () => {
	it('mirrors every handle across the centre', () => {
		expect(mirrorHandle('e')).toBe('w');
		expect(mirrorHandle('n')).toBe('s');
		expect(mirrorHandle('nw')).toBe('se');
		expect(mirrorHandle('sw')).toBe('ne');
	});

	it('lights the lead handle, its mirror half-way, and dims the rest', () => {
		const frame = pinholeFrameRect(S, MID_SHAPE.aspectRatio, MID_SHAPE.heightFrac);
		const { pills } = pinholeHandleLayout(frame, FINE_HITS);
		const states = (input: Parameters<typeof pinholeHandleState>[1]) =>
			Object.fromEntries(
				[...EDGE_HANDLES, ...CORNER_HANDLES].map((h) => [h, pinholeHandleState(h, input, pills)])
			);
		expect(states({ lead: 'e', hovered: 'n', near: true })).toMatchObject({
			e: 'active',
			w: 'mirror',
			n: 'dim',
			ne: 'dim',
			sw: 'dim'
		});
		expect(states({ lead: null, hovered: 'se', near: true })).toMatchObject({
			se: 'hover',
			nw: 'near',
			e: 'near'
		});
		expect(states({ lead: null, hovered: null, near: false }).n).toBe('idle');
	});

	it('lets the corner brackets stand for an edge whose pill is hidden', () => {
		// 400 × 100 px frame: no e/w pills on the short sides, n/s pills kept.
		const k = pxPerFrac(S);
		const frame = pinholeFrameRect(S, 4, 100 / k);
		const { pills } = pinholeHandleLayout(frame, FINE_HITS);
		expect(pills.e).toBeNull();
		expect(pills.n).not.toBeNull();
		const focusE = { lead: 'e', hovered: null, near: false } as const;
		expect(pinholeHandleState('ne', focusE, pills)).toBe('active');
		expect(pinholeHandleState('se', focusE, pills)).toBe('active');
		expect(pinholeHandleState('nw', focusE, pills)).toBe('mirror');
		expect(pinholeHandleState('sw', focusE, pills)).toBe('mirror');
		expect(pinholeHandleState('n', focusE, pills)).toBe('dim');
		const hoverW = { lead: null, hovered: 'w', near: true } as const;
		expect(pinholeHandleState('nw', hoverW, pills)).toBe('hover');
		expect(pinholeHandleState('ne', hoverW, pills)).toBe('near');
		// An edge that keeps its pill lights only the pill.
		const focusN = { lead: 'n', hovered: null, near: false } as const;
		expect(pinholeHandleState('n', focusN, pills)).toBe('active');
		expect(pinholeHandleState('nw', focusN, pills)).toBe('dim');
	});

	it('counts a pointer within the margin as near', () => {
		const rect = { x: 100, y: 100, width: 200, height: 100 };
		expect(isNearRect(150, 150, rect, 24)).toBe(true);
		expect(isNearRect(80, 150, rect, 24)).toBe(true);
		expect(isNearRect(70, 150, rect, 24)).toBe(false);
		expect(isNearRect(150, 225, rect, 24)).toBe(false);
	});
});

describe('pinholeDragRequest', () => {
	const frame = pinholeFrameRect(S, MID_SHAPE.aspectRatio, MID_SHAPE.heightFrac);
	const k = pxPerFrac(S);
	const cx = 400;
	const cy = 300;

	it('grows the frame by twice the pointer travel, without a jump on grab', () => {
		// Grab 3 px outside the east edge.
		const downX = cx + frame.width / 2 + 3;
		const origin = beginPinholeDrag('e', downX, cy, cx, cy, frame, k);
		const still = pinholeDragRequest(origin, downX, cy, false);
		expect(still.widthFrac * k).toBeCloseTo(frame.width, 9);
		expect(still.heightFrac * k).toBeCloseTo(frame.height, 9);
		expect(still).toMatchObject({ x: true, y: false, square: false });
		const moved = pinholeDragRequest(origin, downX + 10, cy + 40, false);
		expect(moved.widthFrac * k).toBeCloseTo(frame.width + 20, 9);
		expect(moved.heightFrac * k).toBeCloseTo(frame.height, 9);
	});

	it('works from the west and north edges too', () => {
		const west = beginPinholeDrag('w', cx - frame.width / 2, cy, cx, cy, frame, k);
		expect(pinholeDragRequest(west, cx - frame.width / 2 - 5, cy, false).widthFrac * k).toBeCloseTo(
			frame.width + 10,
			9
		);
		const north = beginPinholeDrag('n', cx, cy - frame.height / 2, cx, cy, frame, k);
		const r = pinholeDragRequest(north, cx, cy - frame.height / 2 + 5, false);
		expect(r.heightFrac * k).toBeCloseTo(frame.height - 10, 9);
		expect(r).toMatchObject({ x: false, y: true });
	});

	it('snaps square with Shift, taking the axis that moved further', () => {
		const corner = beginPinholeDrag(
			'se',
			cx + frame.width / 2,
			cy + frame.height / 2,
			cx,
			cy,
			frame,
			k
		);
		const r = pinholeDragRequest(
			corner,
			cx + frame.width / 2 - 2,
			cy + frame.height / 2 + 30,
			true
		);
		expect(r.square).toBe(true);
		expect(r.widthFrac).toBeCloseTo(r.heightFrac, 12);
		expect(r.heightFrac * k).toBeCloseTo(frame.height + 60, 9);

		const edge = beginPinholeDrag('e', cx + frame.width / 2, cy, cx, cy, frame, k);
		const e = pinholeDragRequest(edge, cx + frame.width / 2 - 10, cy, true);
		expect(e.widthFrac * k).toBeCloseTo(frame.width - 20, 9);
		expect(e.heightFrac).toBeCloseTo(e.widthFrac, 12);
	});
});

describe('resolvePinholeResize', () => {
	it('keeps the stars still: width stays proportional to tan(fov/2)', () => {
		const limits = roomyLimits(MID_SHAPE);
		const next = resolvePinholeResize(
			MID_SHAPE,
			{ widthFrac: 1.5, heightFrac: 1, x: true, y: false, square: false },
			limits
		);
		expect(widthOf(next)).toBeCloseTo(1.5, 9);
		expect(next.heightFrac).toBe(1);
		expect(widthOf(next) / tanHalf(next.fovDeg)).toBeCloseTo(
			widthOf(MID_SHAPE) / tanHalf(MID_SHAPE.fovDeg),
			9
		);
	});

	it('stops the width at the fov limit and comes back without a jump', () => {
		// The default pinhole fov is already at its 120° maximum: the frame cannot widen.
		const limits = roomyLimits(DEFAULT_SHAPE);
		const widths = [1.8, 1.9, 2.0, 2.5, 2.0, 1.85].map((widthFrac) =>
			widthOf(
				resolvePinholeResize(
					DEFAULT_SHAPE,
					{ widthFrac, heightFrac: DEFAULT_SHAPE.heightFrac, x: true, y: false, square: false },
					limits
				)
			)
		);
		expect(widths[0]).toBeCloseTo(1.8, 9);
		for (const w of widths.slice(1, 5)) expect(w).toBeCloseTo(1.9, 9);
		expect(widths[5]).toBeCloseTo(1.85, 9);
	});

	it('enforces the aspect bounds on a height drag instead of letting them drift', () => {
		const limits = roomyLimits(MID_SHAPE);
		const tall = resolvePinholeResize(
			MID_SHAPE,
			{ widthFrac: widthOf(MID_SHAPE), heightFrac: 1.9, x: false, y: true, square: false },
			limits
		);
		expect(widthOf(tall)).toBeCloseTo(widthOf(MID_SHAPE), 9);
		expect(tall.heightFrac).toBeCloseTo(1.9, 9);

		const narrow: PinholeShape = { fovDeg: 40, aspectRatio: 0.5, heightFrac: 1 };
		const capped = resolvePinholeResize(
			narrow,
			{ widthFrac: 0.5, heightFrac: 1.8, x: false, y: true, square: false },
			roomyLimits(narrow)
		);
		expect(capped.aspectRatio).toBeCloseTo(PINHOLE_ASPECT_RATIO_MIN, 9);
		expect(capped.heightFrac).toBeCloseTo(0.5 / PINHOLE_ASPECT_RATIO_MIN, 9);
		expect(capped.fovDeg).toBeCloseTo(40, 9);
	});

	it('clamps the height to its fixed range', () => {
		const square: PinholeShape = { fovDeg: 60, aspectRatio: 1, heightFrac: 1 };
		const lo = resolvePinholeResize(
			square,
			{ widthFrac: 1, heightFrac: 0, x: false, y: true, square: false },
			roomyLimits(square)
		);
		expect(lo.heightFrac).toBeCloseTo(PINHOLE_HEIGHT_FRAC_MIN, 9);
		const hi = resolvePinholeResize(
			square,
			{ widthFrac: 1, heightFrac: 10, x: false, y: true, square: false },
			roomyLimits(square)
		);
		expect(hi.heightFrac).toBeCloseTo(PINHOLE_HEIGHT_FRAC_MAX, 9);
	});

	it('makes a Shift drag exactly square', () => {
		const next = resolvePinholeResize(
			MID_SHAPE,
			{ widthFrac: 1.2, heightFrac: 1.2, x: true, y: true, square: true },
			roomyLimits(MID_SHAPE)
		);
		expect(next.aspectRatio).toBeCloseTo(1, 12);
		expect(next.heightFrac).toBeCloseTo(1.2, 9);
	});

	it('keeps corner drags inside every bound', () => {
		const limits = roomyLimits(MID_SHAPE);
		for (const [w, h] of [
			[10, 10],
			[0, 0],
			[10, 0],
			[0, 10],
			[2, 0.31]
		]) {
			const next = resolvePinholeResize(
				MID_SHAPE,
				{ widthFrac: w, heightFrac: h, x: true, y: true, square: false },
				limits
			);
			expect(next.fovDeg).toBeLessThanOrEqual(MAX_FOV_DEG_PINHOLE + 1e-9);
			expect(next.fovDeg).toBeGreaterThanOrEqual(20 - 1e-9);
			expect(next.aspectRatio).toBeGreaterThanOrEqual(0.4 - 1e-9);
			expect(next.aspectRatio).toBeLessThanOrEqual(3.5 + 1e-9);
			expect(next.heightFrac).toBeGreaterThanOrEqual(PINHOLE_HEIGHT_FRAC_MIN - 1e-9);
			expect(next.heightFrac).toBeLessThanOrEqual(PINHOLE_HEIGHT_FRAC_MAX + 1e-9);
		}
	});
});

describe('pinholeLimits', () => {
	it('leaves the desktop bounds alone', () => {
		const limits = pinholeLimits(720, 1416, 760, MID_SHAPE);
		expect(limits.maxWidthFrac).toBeCloseTo(1 / 0.46, 9);
		expect(limits.maxHeightFrac).toBeCloseTo(PINHOLE_HEIGHT_FRAC_MAX, 9);
	});

	it('keeps the frame clear of the clip edge where the surface fills the width', () => {
		// 390 px phone: the surface is 366 px, the clip box is the full width.
		const k = pxPerFrac(366);
		const small: PinholeShape = { fovDeg: 60, aspectRatio: 1, heightFrac: 1 };
		const limits = pinholeLimits(366, 390, 600, small);
		expect(limits.maxWidthFrac * k).toBeCloseTo(390 - 2 * PINHOLE_CLIP_MARGIN_PX, 9);
		// A frame already wider than that keeps its own width as the bound.
		const wide: PinholeShape = { fovDeg: 60, aspectRatio: 2, heightFrac: 1 };
		expect(pinholeLimits(366, 390, 600, wide).maxWidthFrac).toBeCloseTo(2, 9);
	});
});

describe('keyboard steps', () => {
	it('raises the value on → and ↑ and lowers it on ← and ↓, Shift for the big step', () => {
		expect(pinholeKeyStep('ArrowRight', false)).toBe(PINHOLE_KEY_STEP_DEG);
		expect(pinholeKeyStep('ArrowUp', false)).toBe(PINHOLE_KEY_STEP_DEG);
		expect(pinholeKeyStep('ArrowLeft', false)).toBe(-PINHOLE_KEY_STEP_DEG);
		expect(pinholeKeyStep('ArrowDown', false)).toBe(-PINHOLE_KEY_STEP_DEG);
		expect(pinholeKeyStep('ArrowUp', true)).toBe(PINHOLE_KEY_STEP_SHIFT_DEG);
		expect(pinholeKeyStep('ArrowLeft', true)).toBe(-PINHOLE_KEY_STEP_SHIFT_DEG);
		expect(pinholeKeyStep('Home', false)).toBe(-Infinity);
		expect(pinholeKeyStep('End', true)).toBe(Infinity);
		expect(pinholeKeyStep('a', false)).toBeNull();
		expect(pinholeKeyStep('PageUp', false)).toBeNull();
	});

	it('steps the horizontal fov by whole degrees', () => {
		const shape: PinholeShape = { fovDeg: 72.4, aspectRatio: 16 / 9, heightFrac: 1 };
		const limits = roomyLimits(shape);
		const up = resolvePinholeResize(shape, pinholeKeyRequest(shape, 'x', 1), limits);
		expect(up.fovDeg).toBeCloseTo(73, 9);
		expect(up.heightFrac).toBe(1);
		const down = resolvePinholeResize(shape, pinholeKeyRequest(shape, 'x', -5), limits);
		expect(down.fovDeg).toBeCloseTo(67, 9);
	});

	it('steps the vertical fov with the width and the stars held still', () => {
		const limits = roomyLimits(MID_SHAPE);
		const next = resolvePinholeResize(MID_SHAPE, pinholeKeyRequest(MID_SHAPE, 'y', 1), limits);
		const vBefore = Math.round(verticalFovDeg(MID_SHAPE.fovDeg, MID_SHAPE.aspectRatio));
		expect(verticalFovDeg(next.fovDeg, next.aspectRatio)).toBeCloseTo(vBefore + 1, 9);
		expect(next.fovDeg).toBeCloseTo(MID_SHAPE.fovDeg, 9);
		expect(widthOf(next)).toBeCloseTo(widthOf(MID_SHAPE), 9);
	});

	it('jumps to the bounds and reports the slider range', () => {
		const limits = roomyLimits(MID_SHAPE);
		const range = pinholeFovRange(MID_SHAPE, 'x', limits);
		const end = resolvePinholeResize(
			MID_SHAPE,
			pinholeKeyRequest(MID_SHAPE, 'x', Infinity),
			limits
		);
		const home = resolvePinholeResize(
			MID_SHAPE,
			pinholeKeyRequest(MID_SHAPE, 'x', -Infinity),
			limits
		);
		expect(end.fovDeg).toBeCloseTo(range.max, 9);
		expect(home.fovDeg).toBeCloseTo(range.min, 9);
		expect(range.min).toBeGreaterThanOrEqual(20 - 1e-9);
		expect(range.max).toBeLessThanOrEqual(120 + 1e-9);
		// The frame reaches the surface width before fov 120°.
		expect(widthOf(end)).toBeCloseTo(1 / 0.46, 9);
	});
});

describe('readout', () => {
	it('derives the vertical fov from the horizontal one and the aspect', () => {
		expect(Math.round(verticalFovDeg(72, 16 / 9))).toBe(44);
		expect(verticalFovDeg(90, 1)).toBeCloseTo(90, 9);
	});

	it('names the nearest aspect ratio', () => {
		expect(nearestAspectName(16 / 9)).toBe('16:9');
		expect(nearestAspectName(1.9 / 1.18)).toBe('16:10');
		expect(nearestAspectName(1.02)).toBe('1:1');
		expect(nearestAspectName(0.52)).toBe('1:2');
		expect(nearestAspectName(1.45)).toBe('3:2');
		// The aspect bounds have names of their own.
		expect(nearestAspectName(PINHOLE_ASPECT_RATIO_MAX)).toBe('7:2');
		expect(nearestAspectName(PINHOLE_ASPECT_RATIO_MIN)).toBe('2:5');
	});

	it('formats "72° × 44° · 16:9", 1:1 while snapping and the limit at a bound', () => {
		const free = { x: 0, y: 0, aspect: 0 } as const;
		expect(formatPinholeReadout(MID_SHAPE, free, false)).toEqual({
			size: '72° × 44°',
			ratio: '16:9'
		});
		expect(formatPinholeReadout(MID_SHAPE, free, true).ratio).toBe('1:1');
		const atMax = pinholeLimitState(DEFAULT_SHAPE, roomyLimits(DEFAULT_SHAPE));
		expect(atMax.x).toBe(1);
		expect(formatPinholeReadout(DEFAULT_SHAPE, atMax, false).size).toMatch(/^120° max × \d+°$/);
		expect(pinholeLimitState(MID_SHAPE, roomyLimits(MID_SHAPE))).toEqual(free);
	});

	it('shows an aspect bound on the ratio, not as a fov bound of the other side', () => {
		// Height dragged in until the frame is 3.5 wide: the width cannot grow any
		// more, but its fov (80°) is nowhere near the 120° bound.
		const start: PinholeShape = { fovDeg: 80, aspectRatio: 1.4, heightFrac: 1 };
		const limits = roomyLimits(start);
		const squat = resolvePinholeResize(
			start,
			{ widthFrac: 1.4, heightFrac: 0, x: false, y: true, square: false },
			limits
		);
		expect(squat.aspectRatio).toBeCloseTo(PINHOLE_ASPECT_RATIO_MAX, 9);
		const state = pinholeLimitState(squat, limits);
		expect(state).toEqual({ x: 0, y: 0, aspect: 1 });
		expect(formatPinholeReadout(squat, state, false)).toEqual({
			size: '80° × 27°',
			ratio: '7:2 max'
		});
	});

	it('marks the size bounds on their own side', () => {
		const tall: PinholeShape = {
			fovDeg: 60,
			aspectRatio: 0.4,
			heightFrac: PINHOLE_HEIGHT_FRAC_MAX
		};
		const state = pinholeLimitState(tall, roomyLimits(tall));
		expect(state).toEqual({ x: 0, y: 1, aspect: -1 });
		expect(formatPinholeReadout(tall, state, false)).toEqual({
			size: '60° × 111° max',
			ratio: '2:5 min'
		});
		const small: PinholeShape = { fovDeg: 20, aspectRatio: 1, heightFrac: PINHOLE_HEIGHT_FRAC_MIN };
		expect(pinholeLimitState(small, roomyLimits(small))).toEqual({ x: -1, y: -1, aspect: 0 });
		// The surface width stops the frame before the fov bound.
		const wide: PinholeShape = { fovDeg: 98, aspectRatio: 1 / 0.46, heightFrac: 1 };
		expect(pinholeLimitState(wide, roomyLimits(wide)).x).toBe(1);
	});

	it('hangs the pill under the frame, or inside it when the clip box has no room', () => {
		const frame = pinholeFrameRect(S, 1.6, 1.18);
		const below = readoutPlacement(frame, S, 760);
		expect(below).toEqual({
			top: frame.y + frame.height + PINHOLE_READOUT_GAP_PX,
			inside: false,
			maxWidth: null
		});
		const full = pinholeFrameRect(S, 1, 2);
		const inside = readoutPlacement(full, S, full.height + 20);
		expect(inside.inside).toBe(true);
		expect(inside.top).toBeCloseTo(
			full.y + full.height - PINHOLE_READOUT_GAP_PX - PINHOLE_READOUT_HEIGHT_PX,
			9
		);
	});

	it('keeps an inside pill clear of the frame sides and on screen', () => {
		// A narrow full-height frame, taller than the clip box.
		const tall = pinholeFrameRect(S, 0.4, 2);
		const clipHeight = tall.height - 100;
		const at = readoutPlacement(tall, S, clipHeight);
		expect(at.inside).toBe(true);
		expect(at.maxWidth).toBeCloseTo(tall.width - 2 * PINHOLE_READOUT_GAP_PX, 9);
		const clipBottom = (S + clipHeight) / 2;
		expect(at.top + PINHOLE_READOUT_HEIGHT_PX).toBeCloseTo(clipBottom - PINHOLE_READOUT_GAP_PX, 9);
	});
});
