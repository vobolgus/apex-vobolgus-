import { describe, expect, it } from 'vitest';
import { CHART_CANVAS_BACKING_PX, CHART_RADIUS_FRAC } from '$lib/constants';
import {
	contentBox,
	findPlacement,
	fitFrame,
	GUTTER_MM,
	gridLines,
	MIN_CHART_SIDE_MM,
	overlaps,
	pageSize,
	placeFrame,
	PRINT_MM_PER_PREVIEW_PX,
	refitFrames,
	sizeCandidates,
	snapMove,
	snapResize,
	snapThresholdMm,
	stepSize,
	trackSize,
	type ResizeAnchor,
	type SnapGuide
} from './geometry';
import type { DocItem, DocPage, PageOrientation, Rect } from './types';

const PORTRAIT_X_EDGES = [12, 54, 60, 70, 76, 102, 108, 134, 140, 150, 156, 198];
const PORTRAIT_X_CENTRES = [33, 41, 57, 81, 105, 129, 153, 169, 177];
const PORTRAIT_Y_EDGES = [12, 75.75, 81.75, 99, 105, 145.5, 151.5, 192, 198, 215.25, 221.25, 285];
const PORTRAIT_Y_CENTRES = [43.875, 55.5, 78.75, 113.625, 148.5, 183.375, 218.25, 241.5, 253.125];

function expectRect(actual: Rect, expected: Rect) {
	expect(actual.x).toBeCloseTo(expected.x, 9);
	expect(actual.y).toBeCloseTo(expected.y, 9);
	expect(actual.w).toBeCloseTo(expected.w, 9);
	expect(actual.h).toBeCloseTo(expected.h, 9);
}

function expectGuides(actual: SnapGuide[], expected: SnapGuide[]) {
	const key = (g: SnapGuide) => `${g.axis}:${g.at.toFixed(6)}`;
	const sorted = (list: SnapGuide[]) => [...list].sort((a, b) => key(a).localeCompare(key(b)));
	const a = sorted(actual);
	const e = sorted(expected);
	expect(a.map(key)).toEqual(e.map(key));
	a.forEach((guide, i) => {
		expect(guide.from).toBeCloseTo(e[i].from, 9);
		expect(guide.to).toBeCloseTo(e[i].to, 9);
	});
}

function insideBox(frame: Rect, o: PageOrientation, eps = 1e-9): boolean {
	const box = contentBox(o);
	return (
		frame.x >= box.x - eps &&
		frame.y >= box.y - eps &&
		frame.x + frame.w <= box.x + box.w + eps &&
		frame.y + frame.h <= box.y + box.h + eps
	);
}

/** Deterministic PRNG (mulberry32) so property loops are reproducible. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function between(random: () => number, lo: number, hi: number) {
	return lo + (hi - lo) * random();
}

/** A random chart frame inside the content box, keeping `aspect`. */
function randomFrame(random: () => number, o: PageOrientation, aspect: number): Rect {
	const box = contentBox(o);
	const minW = MIN_CHART_SIDE_MM * Math.max(1, aspect);
	const maxW = Math.min(box.w, box.h * aspect);
	const w = between(random, minW, maxW);
	const h = w / aspect;
	return {
		x: between(random, box.x, box.x + box.w - w),
		y: between(random, box.y, box.y + box.h - h),
		w,
		h
	};
}

let nextId = 0;
function item(frame: Rect, aspect = frame.w / frame.h): DocItem {
	nextId += 1;
	return {
		id: `item-${nextId}`,
		frame,
		chart: {
			view: {
				projection: aspect === 1 ? 'stereographic' : 'pinhole',
				orientation: { x: 0, y: 0, z: 0, w: 1 },
				stereoFovDeg: 180,
				pinholeFovDeg: 100,
				pinholeAspectRatio: aspect,
				pinholeHeightFrac: 1
			},
			layers: {
				constellations: true,
				constellationBoundaries: false,
				equator: false,
				ecliptic: false,
				galacticEquator: false,
				planets: false
			},
			aspect,
			createdAt: '2026-10-27T12:00:00.000Z'
		}
	};
}

function page(orientation: PageOrientation, frames: Rect[] = []): DocPage {
	nextId += 1;
	return { id: `page-${nextId}`, orientation, items: frames.map((f) => item(f)) };
}

describe('page geometry', () => {
	it('maps a full-width portrait chart onto the preview disc', () => {
		expect(PRINT_MM_PER_PREVIEW_PX).toBe(186 / 1104);
		expect(PRINT_MM_PER_PREVIEW_PX).toBeCloseTo(
			contentBox('portrait').w / (2 * CHART_RADIUS_FRAC * CHART_CANVAS_BACKING_PX),
			12
		);
	});

	it('sizes A4 in both orientations', () => {
		expect(pageSize('portrait')).toEqual({ w: 210, h: 297 });
		expect(pageSize('landscape')).toEqual({ w: 297, h: 210 });
	});

	it('insets the content box by the margin on every side', () => {
		expect(contentBox('portrait')).toEqual({ x: 12, y: 12, w: 186, h: 273 });
		expect(contentBox('landscape')).toEqual({ x: 12, y: 12, w: 273, h: 186 });
	});

	it('splits a length into 1..4 tracks with gutters', () => {
		expect([1, 2, 3, 4].map((n) => trackSize(186, n))).toEqual([186, 90, 58, 42]);
		expect([1, 2, 3, 4].map((n) => trackSize(273, n))).toEqual([273, 133.5, 87, 63.75]);
		// n tracks and n − 1 gutters fill the length exactly.
		for (const n of [1, 2, 3, 4]) {
			expect(n * trackSize(186, n) + (n - 1) * GUTTER_MM).toBeCloseTo(186, 12);
		}
	});

	it('puts grid lines at cell edges and cell centres', () => {
		expect(gridLines('portrait', 'x')).toEqual({
			edges: PORTRAIT_X_EDGES,
			centres: PORTRAIT_X_CENTRES
		});
		expect(gridLines('portrait', 'y')).toEqual({
			edges: PORTRAIT_Y_EDGES,
			centres: PORTRAIT_Y_CENTRES
		});
		// Landscape swaps the axes.
		expect(gridLines('landscape', 'x')).toEqual(gridLines('portrait', 'y'));
		expect(gridLines('landscape', 'y')).toEqual(gridLines('portrait', 'x'));
	});

	it('converts the snap threshold from screen px', () => {
		expect(snapThresholdMm(2)).toBe(4);
		expect(snapThresholdMm(0.5)).toBe(16);
	});
});

describe('sizeCandidates', () => {
	it('lists the spans of both axes for a disc on a portrait page', () => {
		// Width spans 42, 58, 90, 122, 138, 186; height spans 63.75, 87, 133.5, 180 fit too.
		expect(sizeCandidates('portrait', 1)).toEqual([
			42, 58, 63.75, 87, 90, 122, 133.5, 138, 180, 186
		]);
	});

	it('gives a disc the same sizes on a landscape page', () => {
		expect(sizeCandidates('landscape', 1)).toEqual(sizeCandidates('portrait', 1));
	});

	it('converts height spans through the aspect and drops sides under the minimum', () => {
		// 42 and 58 wide would be 21 and 29 mm tall; height spans 63.75 and 87 become 127.5, 174.
		expect(sizeCandidates('portrait', 2)).toEqual([90, 122, 127.5, 138, 174, 186]);
		// Width is capped by the content height: 186 × 0.5 = 93.
		expect(sizeCandidates('landscape', 0.5)).toEqual([45, 61, 63.75, 69, 87, 93]);
	});

	it('only returns sizes that fit the content box, sorted, with no duplicates', () => {
		for (const o of ['portrait', 'landscape'] as const) {
			for (const aspect of [0.4, 0.75, 1, 1.61, 2.5, 3.5]) {
				const sizes = sizeCandidates(o, aspect);
				const box = contentBox(o);
				expect(sizes.length).toBeGreaterThan(0);
				sizes.forEach((w, i) => {
					expect(w).toBeLessThanOrEqual(box.w + 1e-9);
					expect(w / aspect).toBeLessThanOrEqual(box.h + 1e-9);
					expect(Math.min(w, w / aspect)).toBeGreaterThanOrEqual(MIN_CHART_SIDE_MM - 1e-9);
					if (i > 0) expect(w).toBeGreaterThan(sizes[i - 1] + 1e-9);
				});
			}
		}
	});
});

describe('overlaps', () => {
	const a = { x: 12, y: 12, w: 50, h: 50 };

	it('treats touching frames as apart', () => {
		expect(overlaps(a, { x: 62, y: 12, w: 50, h: 50 })).toBe(false);
		expect(overlaps(a, { x: 12, y: 62, w: 50, h: 50 })).toBe(false);
	});

	it('detects an intersection', () => {
		expect(overlaps(a, { x: 61, y: 61, w: 10, h: 10 })).toBe(true);
		expect(overlaps(a, { x: 20, y: 20, w: 5, h: 5 })).toBe(true);
	});

	it('needs the gutter between frames when one is given', () => {
		expect(overlaps(a, { x: 68, y: 12, w: 50, h: 50 }, 6)).toBe(false);
		expect(overlaps(a, { x: 67.9, y: 12, w: 50, h: 50 }, 6)).toBe(true);
		expect(overlaps({ x: 67.9, y: 12, w: 50, h: 50 }, a, 6)).toBe(true);
	});

	it('is apart when the frames are clear on either axis', () => {
		expect(overlaps(a, { x: 30, y: 100, w: 50, h: 50 }, 6)).toBe(false);
		expect(overlaps(a, { x: 100, y: 30, w: 50, h: 50 }, 6)).toBe(false);
	});
});

describe('snapMove', () => {
	const other = { x: 30.25, y: 200, w: 50, h: 50 };

	it('leaves a frame alone when nothing is within the threshold', () => {
		const frame = { x: 113, y: 120, w: 50, h: 50 };
		const result = snapMove(frame, [], 'portrait', 1);
		expectRect(result.frame, frame);
		expect(result.guides).toEqual([]);
	});

	it('snaps an edge to a column line', () => {
		const result = snapMove({ x: 100.5, y: 120, w: 50, h: 50 }, [], 'portrait', 1);
		expectRect(result.frame, { x: 100, y: 120, w: 50, h: 50 });
		expectGuides(result.guides, [{ axis: 'x', at: 150, from: 12, to: 285 }]);
	});

	it('snaps the centre to a cell centre', () => {
		const result = snapMove({ x: 79.5, y: 120, w: 50, h: 50 }, [], 'portrait', 1);
		expectRect(result.frame, { x: 80, y: 120, w: 50, h: 50 });
		expectGuides(result.guides, [{ axis: 'x', at: 105, from: 12, to: 285 }]);
	});

	it('takes the nearest line when several are in reach', () => {
		// Left is 0.6 from 102, right 0.4 from 150.
		const result = snapMove({ x: 101.4, y: 120, w: 48.2, h: 50 }, [], 'portrait', 1);
		expectRect(result.frame, { x: 101.8, y: 120, w: 48.2, h: 50 });
		expectGuides(result.guides, [{ axis: 'x', at: 150, from: 12, to: 285 }]);
	});

	it('snaps at exactly the threshold and not beyond it', () => {
		const frame = { x: 100.5, y: 120, w: 50, h: 50 };
		expect(snapMove(frame, [], 'portrait', 0.5).frame.x).toBeCloseTo(100, 9);
		const missed = snapMove(frame, [], 'portrait', 0.49);
		expect(missed.frame.x).toBe(100.5);
		expect(missed.guides).toEqual([]);
	});

	it('snaps the top to a row line', () => {
		const result = snapMove({ x: 113, y: 98.4, w: 50, h: 40 }, [], 'portrait', 1);
		expectRect(result.frame, { x: 113, y: 99, w: 50, h: 40 });
		expectGuides(result.guides, [{ axis: 'y', at: 99, from: 12, to: 198 }]);
	});

	it('snaps both axes at once', () => {
		const result = snapMove({ x: 100.5, y: 98.4, w: 50, h: 40 }, [], 'portrait', 1);
		expectRect(result.frame, { x: 100, y: 99, w: 50, h: 40 });
		expectGuides(result.guides, [
			{ axis: 'x', at: 150, from: 12, to: 285 },
			{ axis: 'y', at: 99, from: 12, to: 198 }
		]);
	});

	it("aligns an edge with another chart's edge, the guide spanning both", () => {
		const result = snapMove({ x: 30.75, y: 120, w: 44, h: 44 }, [other], 'portrait', 1);
		expectRect(result.frame, { x: 30.25, y: 120, w: 44, h: 44 });
		expectGuides(result.guides, [{ axis: 'x', at: 30.25, from: 120, to: 250 }]);
	});

	it('keeps one gutter from another chart', () => {
		// other.right + gutter = 86.25.
		const result = snapMove({ x: 86.75, y: 120, w: 44, h: 44 }, [other], 'portrait', 1);
		expectRect(result.frame, { x: 86.25, y: 120, w: 44, h: 44 });
		expectGuides(result.guides, [{ axis: 'x', at: 86.25, from: 120, to: 250 }]);
	});

	it('only offers the gutter line to the side that faces the other chart', () => {
		// The right edge (86.5) is near other.right + gutter, which only a left edge may take.
		const result = snapMove({ x: 42, y: 120, w: 44.5, h: 44 }, [other], 'portrait', 1);
		expect(result.frame.x).toBe(42);
		expect(result.guides).toEqual([]);
	});

	it('keeps one gutter above another chart', () => {
		// other.top − gutter = 194.
		const result = snapMove({ x: 113.5, y: 150.4, w: 44, h: 44 }, [other], 'portrait', 1);
		expectRect(result.frame, { x: 113.5, y: 150, w: 44, h: 44 });
		expectGuides(result.guides, [{ axis: 'y', at: 194, from: 30.25, to: 157.5 }]);
	});

	it("centres on another chart's centre", () => {
		const result = snapMove({ x: 34, y: 120, w: 43, h: 43 }, [other], 'portrait', 0.5);
		expectRect(result.frame, { x: 33.75, y: 120, w: 43, h: 43 });
		expectGuides(result.guides, [{ axis: 'x', at: 55.25, from: 120, to: 250 }]);
	});

	it('merges guides that land on the same line', () => {
		// Same width as the other chart, whose left edge is also a column line: every x
		// feature aligns at once.
		const twin = { x: 102, y: 200, w: 40, h: 40 };
		const result = snapMove({ x: 102.4, y: 120, w: 40, h: 40 }, [twin], 'portrait', 1);
		expectRect(result.frame, { x: 102, y: 120, w: 40, h: 40 });
		expectGuides(result.guides, [
			{ axis: 'x', at: 102, from: 12, to: 285 },
			{ axis: 'x', at: 122, from: 120, to: 240 },
			{ axis: 'x', at: 142, from: 120, to: 240 }
		]);
	});

	it('clamps a frame dragged off the content box and shows the edges it hit', () => {
		const result = snapMove({ x: 170, y: 300, w: 50, h: 50 }, [], 'portrait', 1);
		expectRect(result.frame, { x: 148, y: 235, w: 50, h: 50 });
		expectGuides(result.guides, [
			{ axis: 'x', at: 198, from: 12, to: 285 },
			{ axis: 'y', at: 285, from: 12, to: 198 }
		]);

		const topLeft = snapMove({ x: -20, y: -5, w: 60, h: 60 }, [], 'portrait', 1);
		expectRect(topLeft.frame, { x: 12, y: 12, w: 60, h: 60 });
		expectGuides(topLeft.guides, [
			{ axis: 'x', at: 12, from: 12, to: 285 },
			{ axis: 'y', at: 12, from: 12, to: 198 }
		]);
	});

	it('uses the landscape grid and spans', () => {
		const result = snapMove({ x: 160, y: 113, w: 55, h: 30 }, [], 'landscape', 0.5);
		expectRect(result.frame, { x: 160.25, y: 113, w: 55, h: 30 });
		expectGuides(result.guides, [{ axis: 'x', at: 215.25, from: 12, to: 198 }]);
	});

	it('keeps random frames inside the content box and at their size', () => {
		const random = rng(1);
		for (let i = 0; i < 2000; i++) {
			const o: PageOrientation = random() < 0.5 ? 'portrait' : 'landscape';
			const aspect = between(random, 0.4, 3.5);
			const start = randomFrame(random, o, aspect);
			const frame = {
				...start,
				x: start.x + between(random, -80, 80),
				y: start.y + between(random, -80, 80)
			};
			const others = Array.from({ length: Math.floor(random() * 5) }, () =>
				randomFrame(random, o, between(random, 0.4, 3.5))
			);
			const { frame: snapped, guides } = snapMove(frame, others, o, between(random, 0, 12));
			expect(insideBox(snapped, o)).toBe(true);
			expect(snapped.w).toBe(frame.w);
			expect(snapped.h).toBe(frame.h);
			expect(snapped.w / snapped.h).toBeCloseTo(aspect, 9);
			for (const guide of guides) {
				const [lo, size] = guide.axis === 'x' ? [snapped.x, snapped.w] : [snapped.y, snapped.h];
				const features = [lo, lo + size / 2, lo + size];
				expect(features.some((f) => Math.abs(f - guide.at) < 1e-6)).toBe(true);
				expect(guide.from).toBeLessThanOrEqual(guide.to);
			}
		}
	});
});

describe('snapResize', () => {
	it('snaps the moving edge to a column line, the height following', () => {
		const result = snapResize({ x: 12, y: 12, w: 89.5, h: 80 }, 'nw', 1, [], 'portrait', 1);
		expectRect(result.frame, { x: 12, y: 12, w: 90, h: 90 });
		expectGuides(result.guides, [{ axis: 'x', at: 102, from: 12, to: 285 }]);
	});

	it('snaps the moving edge to a row line, the width following', () => {
		// The bottom (97) is 2 from row 99; the size candidate 174 is 4 away on x.
		const result = snapResize({ x: 12, y: 12, w: 170, h: 85 }, 'nw', 2, [], 'portrait', 2.5);
		expectRect(result.frame, { x: 12, y: 12, w: 174, h: 87 });
		expectGuides(result.guides, [{ axis: 'y', at: 99, from: 12, to: 198 }]);
	});

	it('snaps to a size candidate away from the grid', () => {
		const result = snapResize({ x: 30, y: 30, w: 89, h: 89 }, 'nw', 1, [], 'portrait', 1.5);
		expectRect(result.frame, { x: 30, y: 30, w: 90, h: 90 });
		expect(result.guides).toEqual([]);
	});

	it('snaps at exactly the threshold and not beyond it', () => {
		const frame = { x: 30, y: 30, w: 89, h: 89 };
		expect(snapResize(frame, 'nw', 1, [], 'portrait', 1).frame.w).toBeCloseTo(90, 9);
		expect(snapResize(frame, 'nw', 1, [], 'portrait', 0.99).frame.w).toBe(89);
	});

	it('measures a size snap at the corner, on both axes', () => {
		// At aspect 0.5 the candidate 58 is 1 mm away in width but 2 mm in height.
		const frame = { x: 30, y: 40, w: 57, h: 114 };
		expect(snapResize(frame, 'nw', 0.5, [], 'portrait', 1.5).frame.w).toBe(57);
		expect(snapResize(frame, 'nw', 0.5, [], 'portrait', 2).frame.w).toBeCloseTo(58, 9);
	});

	it("stops one gutter short of another chart's edge", () => {
		const other = { x: 150, y: 150, w: 40, h: 40 };
		const result = snapResize(
			{ x: 30, y: 30, w: 113.3, h: 113.3 },
			'nw',
			1,
			[other],
			'portrait',
			1
		);
		expectRect(result.frame, { x: 30, y: 30, w: 114, h: 114 });
		expectGuides(result.guides, [
			{ axis: 'x', at: 144, from: 30, to: 190 },
			{ axis: 'y', at: 144, from: 30, to: 190 }
		]);
	});

	it('follows the pointer along the dominant axis', () => {
		const result = snapResize({ x: 40, y: 40, w: 50, h: 80 }, 'nw', 1, [], 'portrait', 0);
		expectRect(result.frame, { x: 40, y: 40, w: 80, h: 80 });
	});

	it('never goes under the smallest side', () => {
		const tiny = { x: 12, y: 12, w: 5, h: 5 };
		expectRect(snapResize(tiny, 'nw', 1, [], 'portrait', 1).frame, {
			x: 12,
			y: 12,
			w: 40,
			h: 40
		});
		expectRect(snapResize(tiny, 'nw', 2, [], 'portrait', 1).frame, {
			x: 12,
			y: 12,
			w: 80,
			h: 40
		});
		expectRect(snapResize(tiny, 'nw', 0.5, [], 'portrait', 1).frame, {
			x: 12,
			y: 12,
			w: 40,
			h: 80
		});
		// A pointer dragged back across the anchor is a negative size.
		expectRect(snapResize({ x: 50, y: 50, w: -30, h: -30 }, 'nw', 1, [], 'portrait', 1).frame, {
			x: 50,
			y: 50,
			w: 40,
			h: 40
		});
	});

	it('stops at the content box, where its edges are guides', () => {
		const grown = snapResize({ x: 12, y: 12, w: 500, h: 500 }, 'nw', 1, [], 'portrait', 1);
		expectRect(grown.frame, { x: 12, y: 12, w: 186, h: 186 });
		// 198 is also a row line (the top of the third of three rows).
		expectGuides(grown.guides, [
			{ axis: 'x', at: 198, from: 12, to: 285 },
			{ axis: 'y', at: 198, from: 12, to: 198 }
		]);

		// Anchored at the bottom-right corner, growing up and left.
		const up = snapResize({ x: -300, y: -300, w: 498, h: 585 }, 'se', 1, [], 'portrait', 1);
		expectRect(up.frame, { x: 12, y: 99, w: 186, h: 186 });
		expectGuides(up.guides, [
			{ axis: 'x', at: 12, from: 12, to: 285 },
			{ axis: 'y', at: 99, from: 12, to: 198 }
		]);
	});

	it('keeps each anchor corner fixed', () => {
		const sw = snapResize({ x: 12, y: 195.5, w: 89.5, h: 89.5 }, 'sw', 1, [], 'portrait', 1);
		expectRect(sw.frame, { x: 12, y: 195, w: 90, h: 90 });
		expectGuides(sw.guides, [{ axis: 'x', at: 102, from: 12, to: 285 }]);

		const ne = snapResize({ x: 108.5, y: 12, w: 89.5, h: 89.5 }, 'ne', 1, [], 'portrait', 1);
		expectRect(ne.frame, { x: 108, y: 12, w: 90, h: 90 });
		expectGuides(ne.guides, [{ axis: 'x', at: 108, from: 12, to: 285 }]);
	});

	it('moves an anchor with no room for the smallest chart back into the box', () => {
		const result = snapResize({ x: 190, y: 280, w: 30, h: 30 }, 'nw', 1, [], 'portrait', 1);
		expectRect(result.frame, { x: 158, y: 245, w: 40, h: 40 });
		expect(result.guides).toEqual([]);
	});

	it('keeps random resizes inside the box, at the aspect and above the minimum', () => {
		const random = rng(2);
		const anchors: ResizeAnchor[] = ['nw', 'ne', 'sw', 'se'];
		for (let i = 0; i < 2000; i++) {
			const o: PageOrientation = random() < 0.5 ? 'portrait' : 'landscape';
			const aspect = between(random, 0.4, 3.5);
			const start = randomFrame(random, o, aspect);
			const anchor = anchors[Math.floor(random() * 4)];
			const ax = anchor === 'nw' || anchor === 'sw' ? start.x : start.x + start.w;
			const ay = anchor === 'nw' || anchor === 'ne' ? start.y : start.y + start.h;
			// The rect from the anchor to a pointer anywhere around the page.
			const px = between(random, -40, 340);
			const py = between(random, -40, 340);
			const sx = anchor === 'nw' || anchor === 'sw' ? 1 : -1;
			const sy = anchor === 'nw' || anchor === 'ne' ? 1 : -1;
			const raw = {
				x: sx > 0 ? ax : px,
				y: sy > 0 ? ay : py,
				w: sx * (px - ax),
				h: sy * (py - ay)
			};
			const others = Array.from({ length: Math.floor(random() * 5) }, () =>
				randomFrame(random, o, between(random, 0.4, 3.5))
			);
			const { frame, guides } = snapResize(raw, anchor, aspect, others, o, between(random, 0, 12));
			expect(insideBox(frame, o)).toBe(true);
			expect(frame.w / frame.h).toBeCloseTo(aspect, 9);
			expect(Math.min(frame.w, frame.h)).toBeGreaterThanOrEqual(MIN_CHART_SIDE_MM - 1e-9);
			// A valid frame always has room for the smallest chart, so the anchor holds.
			expect(sx > 0 ? frame.x : frame.x + frame.w).toBeCloseTo(ax, 9);
			expect(sy > 0 ? frame.y : frame.y + frame.h).toBeCloseTo(ay, 9);
			// Guides only mark the edges that moved.
			const movingX = sx > 0 ? frame.x + frame.w : frame.x;
			const movingY = sy > 0 ? frame.y + frame.h : frame.y;
			for (const guide of guides) {
				expect(guide.at).toBeCloseTo(guide.axis === 'x' ? movingX : movingY, 6);
			}
		}
	});
});

describe('findPlacement', () => {
	it('opens a new portrait page at the full content width', () => {
		expect(findPlacement([], 1)).toEqual({
			pageIndex: null,
			frame: { x: 12, y: 12, w: 186, h: 186 }
		});
	});

	it('caps a tall chart on a new page by the content height', () => {
		const { pageIndex, frame } = findPlacement([], 0.5);
		expect(pageIndex).toBeNull();
		expectRect(frame, { x: 12, y: 12, w: 136.5, h: 273 });
	});

	it('fills an empty page at the full width', () => {
		expect(findPlacement([page('portrait')], 1)).toEqual({
			pageIndex: 0,
			frame: { x: 12, y: 12, w: 186, h: 186 }
		});
		const wide = findPlacement([page('portrait')], 1.61);
		expect(wide.pageIndex).toBe(0);
		expectRect(wide.frame, { x: 12, y: 12, w: 186, h: 186 / 1.61 });
	});

	it('fills an empty landscape page as high as it goes', () => {
		expect(findPlacement([page('landscape')], 1)).toEqual({
			pageIndex: 0,
			frame: { x: 12, y: 12, w: 186, h: 186 }
		});
	});

	it('puts later charts at half the width, left to right then top to bottom', () => {
		const half = { x: 12, y: 12, w: 90, h: 90 };
		const p = page('portrait', [half]);
		expect(findPlacement([p], 1).frame).toEqual({ x: 108, y: 12, w: 90, h: 90 });
		p.items.push(item({ x: 108, y: 12, w: 90, h: 90 }));
		expect(findPlacement([p], 1).frame).toEqual({ x: 12, y: 108, w: 90, h: 90 });
		p.items.push(item({ x: 12, y: 108, w: 90, h: 90 }));
		expect(findPlacement([p], 1).frame).toEqual({ x: 108, y: 108, w: 90, h: 90 });
	});

	it('steps down to a smaller size to fit under a full-width chart', () => {
		// 90 and 87 do not fit in the 81 mm left under the disc; 63.75 (a quarter of the
		// height) does, one gutter below it.
		const p = page('portrait', [{ x: 12, y: 12, w: 186, h: 186 }]);
		expect(findPlacement([p], 1)).toEqual({
			pageIndex: 0,
			frame: { x: 12, y: 204, w: 63.75, h: 63.75 }
		});
	});

	it('goes no smaller than a third of the width', () => {
		// The bottom row of 63.75s has room for nothing of at least 58 next to it.
		const p = page('portrait', [
			{ x: 12, y: 12, w: 186, h: 186 },
			{ x: 12, y: 204, w: 63.75, h: 63.75 },
			{ x: 81.75, y: 204, w: 63.75, h: 63.75 }
		]);
		expect(findPlacement([p], 1).pageIndex).toBeNull();
	});

	it('tries the pages in order and creates one when all are full', () => {
		const full = page('portrait', [{ x: 12, y: 12, w: 186, h: 273 }]);
		const half = page('portrait', [{ x: 12, y: 12, w: 90, h: 90 }]);
		expect(findPlacement([full, half], 1)).toEqual({
			pageIndex: 1,
			frame: { x: 108, y: 12, w: 90, h: 90 }
		});
		expect(findPlacement([full, full], 1).pageIndex).toBeNull();
		// An empty page later in the document still takes the chart.
		expect(findPlacement([full, page('landscape')], 1).pageIndex).toBe(1);
	});

	it('places side by side on a landscape page', () => {
		const p = page('landscape', [{ x: 12, y: 12, w: 133.5, h: 133.5 }]);
		expect(findPlacement([p], 1).frame).toEqual({ x: 151.5, y: 12, w: 133.5, h: 133.5 });
	});

	it('lets a tall chart onto a landscape page at the full height', () => {
		const empty = findPlacement([page('landscape')], 0.4);
		expectRect(empty.frame, { x: 12, y: 12, w: 74.4, h: 186 });
		const p = page('landscape', [empty.frame]);
		const next = findPlacement([p], 0.4);
		expect(next.pageIndex).toBe(0);
		expectRect(next.frame, { x: 92.4, y: 12, w: 74.4, h: 186 });
	});

	it('puts a panorama too wide for half the width next to a chart, at its smallest size', () => {
		// Past 2.25:1 every size is over 90 mm: 122 (two thirds of the width) is the smallest.
		const disc = page('portrait', [{ x: 12, y: 12, w: 42, h: 42 }]);
		expect(sizeCandidates('portrait', 2.3)[0]).toBe(122);
		const placed = findPlacement([disc], 2.3);
		expect(placed.pageIndex).toBe(0);
		expectRect(placed.frame, { x: 60, y: 12, w: 122, h: 122 / 2.3 });

		// On a landscape page past 3.34:1 (over 133.5 mm): 42 × 3.4 = 142.8.
		const landscape = page('landscape', [{ x: 12, y: 12, w: 42, h: 42 }]);
		const wide = findPlacement([landscape], 3.4);
		expect(wide.pageIndex).toBe(0);
		expectRect(wide.frame, { x: 60, y: 12, w: 142.8, h: 42 });
	});

	it('packs several panoramas onto one page instead of a page each', () => {
		for (const aspect of [21 / 9, 3, 3.5]) {
			const pages: DocPage[] = [];
			for (let i = 0; i < 3; i++) {
				const { pageIndex, frame } = findPlacement(pages, aspect);
				const target = pageIndex === null ? page('portrait') : pages[pageIndex];
				if (pageIndex === null) pages.push(target);
				for (const existing of target.items) {
					expect(overlaps(frame, existing.frame, GUTTER_MM)).toBe(false);
				}
				target.items.push(item(frame, aspect));
			}
			expect(pages, `aspect ${aspect}`).toHaveLength(1);
		}
	});

	it('packs random charts into pages with no overlap', () => {
		const random = rng(3);
		for (let run = 0; run < 20; run++) {
			const pages: DocPage[] = Array.from({ length: Math.floor(random() * 3) }, () =>
				page(random() < 0.5 ? 'portrait' : 'landscape')
			);
			for (let i = 0; i < 30; i++) {
				const aspect = random() < 0.4 ? 1 : between(random, 0.4, 3.5);
				const { pageIndex, frame } = findPlacement(pages, aspect);
				const target = pageIndex === null ? page('portrait') : pages[pageIndex];
				if (pageIndex === null) pages.push(target);
				expect(insideBox(frame, target.orientation)).toBe(true);
				expect(frame.w / frame.h).toBeCloseTo(aspect, 9);
				expect(Math.min(frame.w, frame.h)).toBeGreaterThanOrEqual(MIN_CHART_SIDE_MM - 1e-9);
				for (const existing of target.items) {
					expect(overlaps(frame, existing.frame, GUTTER_MM)).toBe(false);
				}
				target.items.push(item(frame, aspect));
			}
		}
	});
});

describe('fitFrame', () => {
	it('leaves a frame that fits alone', () => {
		const frame = { x: 30, y: 40, w: 90, h: 90 };
		expect(fitFrame(frame, 1, 'portrait')).toEqual(frame);
	});

	it('moves a frame back inside without resizing it', () => {
		expect(fitFrame({ x: 150, y: 250, w: 90, h: 90 }, 1, 'portrait')).toEqual({
			x: 108,
			y: 195,
			w: 90,
			h: 90
		});
	});

	it('scales a frame down into the box at its aspect', () => {
		expectRect(fitFrame({ x: 12, y: 12, w: 186, h: 273 }, 186 / 273, 'landscape'), {
			x: 12,
			y: 12,
			w: (186 * 186) / 273,
			h: 186
		});
	});

	it('restores the aspect and the smallest side', () => {
		expectRect(fitFrame({ x: 20, y: 20, w: 10, h: 50 }, 2, 'portrait'), {
			x: 20,
			y: 20,
			w: 80,
			h: 40
		});
	});
});

describe('stepSize', () => {
	it('steps a chart through the size candidates, its top-left kept', () => {
		const frame = { x: 20, y: 30, w: 90, h: 90 };
		expect(stepSize(frame, 1, 'portrait', 1)).toEqual({ x: 20, y: 30, w: 122, h: 122 });
		expect(stepSize(frame, 1, 'portrait', -1)).toEqual({ x: 20, y: 30, w: 87, h: 87 });
		// Off a candidate, the next one either way.
		const odd = { x: 12, y: 12, w: 100, h: 100 };
		expect(stepSize(odd, 1, 'portrait', 1)?.w).toBe(122);
		expect(stepSize(odd, 1, 'portrait', -1)?.w).toBe(90);
	});

	it('moves a grown chart back into the content box', () => {
		const grown = stepSize({ x: 108, y: 150, w: 90, h: 90 }, 1, 'portrait', 1)!;
		expect(grown).toEqual({ x: 76, y: 150, w: 122, h: 122 });
		expect(insideBox(grown, 'portrait')).toBe(true);
	});

	it('has no step past the largest or the smallest size', () => {
		expect(stepSize({ x: 12, y: 12, w: 186, h: 186 }, 1, 'portrait', 1)).toBeNull();
		expect(stepSize({ x: 12, y: 12, w: 42, h: 42 }, 1, 'portrait', -1)).toBeNull();
	});

	it('keeps the aspect', () => {
		const frame = stepSize({ x: 12, y: 12, w: 90, h: 45 }, 2, 'portrait', 1)!;
		expect(frame.w / frame.h).toBeCloseTo(2, 9);
		expect(frame.w).toBe(122);
	});
});

describe('placeFrame', () => {
	it('keeps the chart at its own size in the first free spot', () => {
		const others = [{ x: 12, y: 12, w: 90, h: 90 }];
		expect(placeFrame({ x: 50, y: 200, w: 80, h: 80 }, 1, others, 'portrait')).toEqual({
			x: 108,
			y: 12,
			w: 80,
			h: 80
		});
	});

	it('steps down through the sizes until it fits', () => {
		// Under a full-width disc only 81 mm are left: 63.75 fits, 85 does not.
		const others = [{ x: 12, y: 12, w: 186, h: 186 }];
		expect(placeFrame({ x: 12, y: 12, w: 85, h: 85 }, 1, others, 'portrait')).toEqual({
			x: 12,
			y: 204,
			w: 63.75,
			h: 63.75
		});
	});

	it('fits the chart into the box where it was when there is no room', () => {
		const others = [{ x: 12, y: 12, w: 186, h: 273 }];
		expect(placeFrame({ x: 150, y: 250, w: 90, h: 90 }, 1, others, 'portrait')).toEqual({
			x: 108,
			y: 195,
			w: 90,
			h: 90
		});
	});
});

describe('refitFrames', () => {
	it('keeps frames that still fit', () => {
		const items = [
			{ frame: { x: 12, y: 12, w: 90, h: 90 }, aspect: 1 },
			{ frame: { x: 108, y: 12, w: 90, h: 90 }, aspect: 1 }
		];
		expect(refitFrames(items, 'landscape')).toEqual(items.map((i) => i.frame));
	});

	it('places a frame that fell off the page next to the ones that stayed', () => {
		// Two stacked half-height discs on a portrait page, turned landscape.
		const items = [
			{ frame: { x: 12, y: 12, w: 133.5, h: 133.5 }, aspect: 1 },
			{ frame: { x: 12, y: 151.5, w: 133.5, h: 133.5 }, aspect: 1 }
		];
		const [first, second] = refitFrames(items, 'landscape');
		expect(first).toEqual(items[0].frame);
		expectRect(second, { x: 151.5, y: 12, w: 133.5, h: 133.5 });
	});

	it('scales a frame down when it is larger than the new box', () => {
		const aspect = 186 / 273;
		const [frame] = refitFrames([{ frame: { x: 12, y: 12, w: 186, h: 273 }, aspect }], 'landscape');
		expectRect(frame, { x: 12, y: 12, w: 186 * aspect, h: 186 });
	});

	it('falls back to fitting into the box when the page has no room', () => {
		const aspect = 273 / 186;
		const items = [
			{ frame: { x: 12, y: 12, w: 273, h: 186 }, aspect },
			{ frame: { x: 12, y: 210, w: 60, h: 60 }, aspect: 1 }
		];
		const [kept, squeezed] = refitFrames(items, 'landscape');
		expect(kept).toEqual(items[0].frame);
		expect(insideBox(squeezed, 'landscape')).toBe(true);
		expectRect(squeezed, { x: 12, y: 138, w: 60, h: 60 });
	});

	it('keeps random pages inside the box after a turn, at every aspect', () => {
		const random = rng(4);
		for (let run = 0; run < 300; run++) {
			const from: PageOrientation = random() < 0.5 ? 'portrait' : 'landscape';
			const to: PageOrientation = from === 'portrait' ? 'landscape' : 'portrait';
			const items = Array.from({ length: 1 + Math.floor(random() * 5) }, () => {
				const aspect = between(random, 0.4, 3.5);
				return { frame: randomFrame(random, from, aspect), aspect };
			});
			const frames = refitFrames(items, to);
			frames.forEach((frame, i) => {
				expect(insideBox(frame, to)).toBe(true);
				expect(frame.w / frame.h).toBeCloseTo(items[i].aspect, 9);
			});
		}
	});
});
