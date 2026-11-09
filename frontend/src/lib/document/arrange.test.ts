// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
	aloneFrame,
	aloneSize,
	arrange,
	arrangePage,
	ARRANGE,
	blockedScales,
	chartKind,
	envelopeOf,
	envelopeScale,
	freeSpot,
	insertions,
	layoutFrames,
	leavesOf,
	planAdd,
	raggedPairs,
	transposeTree,
	treeEnumerator,
	treeFromFrames,
	treeString,
	turnLayout,
	typeKey,
	type AddPlan,
	type ArrangeItem,
	type ArrangeResult,
	type PlacedChart,
	type TurnHow
} from './arrange';
import { contentBox, GUTTER_MM, MIN_CHART_SIDE_MM, overlaps, rotateLayout } from './geometry';
import type {
	ChartSnapshot,
	DocItem,
	DocPage,
	PageLayout,
	PageOrientation,
	Rect,
	TurnMemo
} from './types';

// === Charts and pages ===

let nextId = 0;

function snapshot(projection: 'stereographic' | 'pinhole', aspect: number): ChartSnapshot {
	return {
		view: {
			projection,
			orientation: { x: 0, y: 0, z: 0, w: 1 },
			stereoFovDeg: 180,
			pinholeFovDeg: 70,
			pinholeAspectRatio: projection === 'pinhole' ? aspect : 1.61,
			pinholeHeightFrac: 1.18
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
	};
}

/** A stereo chart (a disc), not placed yet. */
function S(): DocItem {
	nextId += 1;
	return {
		id: `s${nextId}`,
		chart: snapshot('stereographic', 1),
		frame: { x: 0, y: 0, w: 1, h: 1 }
	};
}

/** A pinhole chart of `aspect`, not placed yet. */
function P(aspect: number): DocItem {
	nextId += 1;
	return {
		id: `p${nextId}`,
		chart: snapshot('pinhole', aspect),
		frame: { x: 0, y: 0, w: aspect, h: 1 }
	};
}

function item(chart: DocItem): ArrangeItem {
	return { kind: chartKind(chart.chart), aspect: chart.chart.aspect };
}

interface Laid extends DocPage {
	how?: TurnHow;
	belowMin?: boolean;
	/** The arranger's result for a page laid out from scratch. */
	meta?: ArrangeResult;
}

/** `page` with a plan applied, as the store applies it (`added`: the chart at index −1). */
function applied(
	page: DocPage,
	plan: {
		items: PlacedChart[];
		layout?: PageLayout;
		manual?: boolean;
		turnMemo?: TurnMemo;
		belowMin?: boolean;
	},
	orientation = page.orientation,
	added?: DocItem
): Laid {
	const next: Laid = {
		id: page.id,
		orientation,
		items: plan.items.map(({ index, frame }) => ({
			...(index < 0 ? added! : page.items[index]),
			frame
		}))
	};
	if (plan.manual) next.manual = true;
	if (plan.layout) next.layout = plan.layout;
	if (plan.turnMemo) next.turnMemo = plan.turnMemo;
	if (plan.belowMin) next.belowMin = true;
	return next;
}

function empty(orientation: PageOrientation = 'portrait'): DocPage {
	nextId += 1;
	return { id: `page${nextId}`, orientation, items: [] };
}

/** A page of `charts` laid out from scratch. */
function laid(orientation: PageOrientation, charts: DocItem[]): Laid {
	const page = { ...empty(orientation), items: charts };
	return { ...applied(page, arrangePage(page)), meta: arrange(orientation, charts.map(item)) };
}

function turned(page: DocPage, o: PageOrientation): Laid {
	const plan = turnLayout(page, o);
	return { ...applied(page, plan, o), how: plan.how, belowMin: plan.belowMin };
}

interface Added {
	before: DocPage[];
	after: DocPage[];
	plan: AddPlan;
	/** The page the chart went on, in `after`. */
	index: number;
	newPage: boolean;
}

/** Add to PDF on `pages`, as the store does it. */
function add(pages: DocPage[], chart: DocItem, now?: () => number): Added {
	const plan = planAdd(pages, item(chart), now);
	const after = pages.slice();
	const index = plan.pageIndex ?? pages.length;
	const target = plan.pageIndex === null ? empty(plan.orientation) : pages[index];
	after[index] = applied(target, plan, plan.orientation, chart);
	return { before: pages, after, plan, index, newPage: plan.pageIndex === null };
}

// === Checks ===

const near = (a: number, b: number, tol = 0.15) => Math.abs(a - b) <= tol;
const cx = (f: Rect) => f.x + f.w / 2;
const cy = (f: Rect) => f.y + f.h / 2;
const frames = (page: DocPage) => page.items.map((it) => it.frame);
const widths = (page: DocPage) => page.items.map((it) => it.frame.w);

function expectNear(actual: number, expected: number, tol = 0.15) {
	expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
}

function expectFrame(actual: Rect, expected: Rect, tol = 0.15) {
	for (const k of ['x', 'y', 'w', 'h'] as const) expectNear(actual[k], expected[k], tol);
}

function byKind(page: DocPage, kind: 'S' | number): DocItem[] {
	return page.items.filter((it) =>
		kind === 'S'
			? chartKind(it.chart) === 'stereo'
			: chartKind(it.chart) === 'pinhole' && Math.abs(it.chart.aspect - kind) < 1e-6
	);
}

/**
 * Every frame inside the content box at its chart's aspect, none closer than the gutter,
 * every side at least 40 mm (unless the page is below it), the block centred, identical
 * charts at one width.
 */
function expectInvariants(page: Laid, { centred = true } = {}) {
	const B = contentBox(page.orientation);
	const fr = frames(page);
	page.items.forEach((it, i) => {
		const f = fr[i];
		const inside =
			f.x >= B.x - 1e-6 &&
			f.y >= B.y - 1e-6 &&
			f.x + f.w <= B.x + B.w + 1e-6 &&
			f.y + f.h <= B.y + B.h + 1e-6;
		expect(inside, `item ${i} outside the content box`).toBe(true);
		expect(Math.abs(f.w / f.h - it.chart.aspect), `item ${i} aspect`).toBeLessThan(1e-9);
		if (!page.belowMin) {
			expect(Math.min(f.w, f.h), `item ${i} under 40 mm`).toBeGreaterThanOrEqual(
				MIN_CHART_SIDE_MM - 1e-6
			);
		}
		for (let j = 0; j < i; j++) {
			expect(overlaps(f, fr[j], GUTTER_MM), `items ${j} and ${i} closer than the gutter`).toBe(
				false
			);
		}
	});
	if (centred && fr.length) {
		const x0 = Math.min(...fr.map((f) => f.x));
		const x1 = Math.max(...fr.map((f) => f.x + f.w));
		const y0 = Math.min(...fr.map((f) => f.y));
		const y1 = Math.max(...fr.map((f) => f.y + f.h));
		expect(near(x0 - B.x, B.x + B.w - x1, 0.01), 'block not centred across').toBe(true);
		expect(near(y0 - B.y, B.y + B.h - y1, 0.01), 'block not centred down').toBe(true);
	}
	const sizes = new Map<string, number>();
	for (const it of page.items) {
		const k = typeKey(item(it));
		const w = sizes.get(k);
		if (w !== undefined) expectNear(it.frame.w, w, 0.01);
		sizes.set(k, it.frame.w);
	}
}

/** The same charts at the same frames, to 1e-9. */
function expectSamePage(a: DocPage, b: DocPage) {
	expect(b.items.map((it) => it.id).sort()).toEqual(a.items.map((it) => it.id).sort());
	for (const it of a.items) {
		const other = b.items.find((x) => x.id === it.id)!.frame;
		for (const k of ['x', 'y', 'w', 'h'] as const) {
			expect(Math.abs(other[k] - it.frame[k])).toBeLessThan(1e-9);
		}
	}
}

/** The reference's seeded generator (Park–Miller), so the same 300 pages are checked. */
function lcg(seed: number) {
	let s = seed;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const ASPECTS = [1.61, 16 / 9, 3, 0.6, 0.4, 2.35, 1.3, 2, 1];

function randomCharts(rnd: () => number, n: number): DocItem[] {
	return Array.from({ length: n }, () =>
		rnd() < 0.4 ? S() : P(ASPECTS[Math.floor(rnd() * ASPECTS.length)])
	);
}

// === Building blocks ===

describe('the arranger: building blocks', () => {
	it('sizes a chart alone on the page and centres it', () => {
		expect(aloneSize(1, 'portrait')).toEqual({ w: 186, h: 186 });
		expectFrame(aloneFrame(1.61, 'portrait'), { x: 12, y: 90.73, w: 186, h: 115.53 }, 0.01);
		expectFrame(aloneFrame(3, 'portrait'), { x: 12, y: 117.5, w: 186, h: 62 }, 1e-9);
		expectFrame(aloneFrame(0.6, 'portrait'), { x: 23.1, y: 12, w: 163.8, h: 273 }, 1e-9);
		expectFrame(aloneFrame(3, 'landscape'), { x: 12, y: 59.5, w: 273, h: 91 }, 1e-9);
	});

	it('tells discs from pinholes, and types them', () => {
		expect(chartKind(S().chart)).toBe('stereo');
		expect(chartKind(P(1).chart)).toBe('pinhole');
		expect(typeKey(item(S()))).toBe('S');
		expect(typeKey(item(P(16 / 9)))).toBe('P1.78');
	});

	it('enumerates every slicing tree of a leaf order once', () => {
		const base = Array.from({ length: 8 }, () => aloneSize(1, 'portrait'));
		const enumerate = treeEnumerator(base);
		const counts = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
			const trees = enumerate([...Array(n).keys()]);
			expect(new Set(trees.map((t) => treeString(t.tree))).size).toBe(trees.length);
			return trees.length;
		});
		expect(counts).toEqual([1, 2, 6, 22, 90, 394, 1806, 8558]);
	});

	it('finds the exact fair share from the envelopes', () => {
		const base = [aloneSize(1, 'portrait'), aloneSize(1, 'portrait')];
		const B = contentBox('portrait');
		const column = envelopeOf({ dir: 'V', kids: [0, 1] }, base);
		expect(envelopeScale(column.W, column.H, B)).toBeCloseTo((273 - 6) / 372, 12);
		const row = envelopeOf({ dir: 'H', kids: [0, 1] }, base);
		expect(envelopeScale(row.W, row.H, B)).toBeCloseTo(180 / 372, 12);
		// The enumerator's envelopes are the same.
		const enumerated = treeEnumerator(base)([0, 1]);
		const v = enumerated.find((t) => treeString(t.tree) === 'V(0 1)')!;
		expect(envelopeScale(v.W, v.H, B)).toBeCloseTo((273 - 6) / 372, 12);
	});

	it('sizes a stack blocked: one width, flush edges', () => {
		const B = contentBox('portrait');
		const base = [aloneSize(0.6, 'portrait'), aloneSize(1, 'portrait')];
		const t = blockedScales({ dir: 'V', kids: [0, 1] }, base, B, 2)!;
		const fr = layoutFrames({ dir: 'V', kids: [0, 1] }, t, base, B);
		expectNear(fr[0].w, 100.1);
		expect(fr[0].w).toBeCloseTo(fr[1].w, 9);
		expect(fr[0].h + GUTTER_MM + fr[1].h).toBeCloseTo(273, 9);
		expect(blockedScales(0, base, B, 2)).toBeNull();
	});

	it('lays a tree out centred, each chart in its cell, one gutter apart', () => {
		const B = contentBox('portrait');
		const base = [aloneSize(1, 'portrait'), aloneSize(1, 'portrait'), aloneSize(1, 'portrait')];
		const tree = { dir: 'V' as const, kids: [{ dir: 'H' as const, kids: [0, 1] }, 2] };
		const fr = layoutFrames(tree, [90 / 186, 90 / 186, 90 / 186], base, B);
		expectFrame(fr[0], { x: 12, y: 55.5, w: 90, h: 90 }, 1e-9);
		expectFrame(fr[1], { x: 108, y: 55.5, w: 90, h: 90 }, 1e-9);
		expectFrame(fr[2], { x: 60, y: 151.5, w: 90, h: 90 }, 1e-9);
		expect(raggedPairs(tree, fr)).toEqual({ near: 0, pairs: 2 });
	});

	it('counts a near miss as ragged, and a clear contrast as not', () => {
		const tree = { dir: 'V' as const, kids: [0, 1] };
		const a = { x: 12, y: 12, w: 100, h: 100 };
		expect(raggedPairs(tree, [a, { x: 12, y: 118, w: 95, h: 95 }]).near).toBe(1);
		expect(raggedPairs(tree, [a, { x: 12, y: 118, w: 100.3, h: 100.3 }]).near).toBe(0);
		expect(raggedPairs(tree, [a, { x: 12, y: 118, w: 60, h: 60 }]).near).toBe(0);
	});

	it('recovers a tree from guillotine frames, and none from a pinwheel', () => {
		const grid = [
			{ x: 12, y: 12, w: 90, h: 90 },
			{ x: 108, y: 12, w: 90, h: 90 },
			{ x: 60, y: 108, w: 90, h: 90 }
		];
		expect(treeString(treeFromFrames(grid)!)).toBe('V(H(0 1) 2)');
		const pinwheel = [
			{ x: 0, y: 0, w: 60, h: 20 },
			{ x: 60, y: 0, w: 20, h: 60 },
			{ x: 20, y: 60, w: 60, h: 20 },
			{ x: 0, y: 20, w: 20, h: 60 },
			{ x: 25, y: 25, w: 30, h: 30 }
		];
		expect(treeFromFrames(pinwheel)).toBeNull();
	});

	it('transposes a tree and inserts a leaf in every way', () => {
		const tree = { dir: 'V' as const, kids: [{ dir: 'H' as const, kids: [0, 1] }, 2] };
		expect(treeString(transposeTree(tree))).toBe('H(V(0 1) 2)');
		const all = insertions(tree, 3).map((t) => treeString(t));
		expect(new Set(all).size).toBe(all.length);
		expect(all).toContain('V(H(0 1) 2 3)');
		expect(all).toContain('V(H(0 1 3) 2)');
		expect(all).toContain('V(H(0 V(1 3)) 2)');
		expect(all).toContain('H(V(H(0 1) 2) 3)');
		for (const t of insertions(tree, 3)) expect(leavesOf(t).sort()).toEqual([0, 1, 2, 3]);
	});

	it('finds the largest free spot, a gutter clear of every chart', () => {
		const disc = { x: 12, y: 12, w: 120, h: 120 };
		const spot = freeSpot({ orientation: 'portrait', items: [{ frame: disc }] }, 3)!;
		expectFrame(spot, { x: 12, y: 180.5, w: 186, h: 62 }, 1e-9);
		// Under a full-width disc only 81 mm are left: a disc of 81 fits, centred there.
		const full = { x: 12, y: 12, w: 186, h: 186 };
		expectFrame(freeSpot({ orientation: 'portrait', items: [{ frame: full }] }, 1)!, {
			x: 64.5,
			y: 204,
			w: 81,
			h: 81
		});
		const page = { x: 12, y: 12, w: 186, h: 273 };
		expect(freeSpot({ orientation: 'portrait', items: [{ frame: page }] }, 1)).toBeNull();
	});
});

// === Pages from scratch ===

describe('the arranger: pages from scratch', () => {
	const pages = {
		S1: laid('portrait', [S()]),
		S2: laid('portrait', [S(), S()]),
		S3: laid('portrait', [S(), S(), S()]),
		S4: laid('portrait', [S(), S(), S(), S()]),
		S5: laid('landscape', [S(), S()]),
		S6: laid('portrait', [P(1.61)]),
		S7: laid('portrait', [P(1.61), P(1.61)]),
		S8: laid('portrait', [S(), P(1.61)]),
		S9: laid('portrait', [S(), P(1.61), P(1.61)]),
		S10: laid('portrait', [P(3), S()]),
		S11: laid('portrait', [P(0.6), S()]),
		S12: laid('landscape', [P(16 / 9), P(16 / 9), P(16 / 9)]),
		S13: laid('portrait', [S(), S(), P(1.61), P(16 / 9), P(0.6)]),
		X1: laid('portrait', [S(), S(), S(), S(), S()]),
		X2: laid('landscape', [S(), S(), S()]),
		X3: laid('landscape', [S(), P(0.4)])
	};
	it('keeps the invariants on every scenario page', () => {
		for (const page of Object.values(pages)) expectInvariants(page);
	});

	it('S1: a disc at 186, centred', () => {
		expectFrame(pages.S1.items[0].frame, { x: 12, y: 55.5, w: 186, h: 186 });
		expectNear(cy(pages.S1.items[0].frame), 148.5);
	});

	it('S2: two discs stacked at 133.5', () => {
		const [a, b] = frames(pages.S2);
		expectFrame(a, { x: 38.25, y: 12, w: 133.5, h: 133.5 });
		expectFrame(b, { x: 38.25, y: 151.5, w: 133.5, h: 133.5 });
	});

	it('S3: three discs, 2 + 1 at 90, the single one centred below', () => {
		const fr = frames(pages.S3);
		fr.forEach((f) => expectNear(f.w, 90));
		expect(near(fr[0].y, fr[1].y) && fr[2].y > fr[0].y).toBe(true);
		expectNear(cx(fr[2]), 105);
		expect(treeString(pages.S3.layout!.tree)).toBe('V(H(0 1) 2)');
	});

	it('S4: 2 × 2 at 90', () => {
		widths(pages.S4).forEach((w) => expectNear(w, 90));
	});

	it('S5: landscape, side by side at 133.5', () => {
		const [a, b] = frames(pages.S5);
		expectFrame(a, { x: 12, y: 38.25, w: 133.5, h: 133.5 });
		expectFrame(b, { x: 151.5, y: 38.25, w: 133.5, h: 133.5 });
	});

	it('S6, S7: pinholes at the full width', () => {
		expectFrame(pages.S6.items[0].frame, { x: 12, y: 90.73, w: 186, h: 115.53 });
		widths(pages.S7).forEach((w) => expectNear(w, 186));
	});

	it('S8: the disc over the 1.61, both 164.7 wide', () => {
		const [d, p] = frames(pages.S8);
		expectNear(d.w, 164.7);
		expectNear(p.w, 164.7);
		expect(p.y).toBeGreaterThan(d.y);
	});

	it('S9: the sandwich 1.61 / disc / 1.61 at 116.4, symmetric both ways', () => {
		const { metrics } = pages.S9.meta!;
		expect(metrics.lr).toBeGreaterThan(0.99);
		expect(metrics.tb).toBeGreaterThan(0.99);
		expect(chartKind(pages.S9.items[1].chart)).toBe('stereo');
		widths(pages.S9).forEach((w) => expectNear(w, 116.4));
	});

	it('S10: the 3:1 over the full disc, nothing shrinks', () => {
		const [p, d] = frames(pages.S10);
		expectFrame(p, { x: 12, y: 21.5, w: 186, h: 62 });
		expectFrame(d, { x: 12, y: 89.5, w: 186, h: 186 });
	});

	it('S11: the 0.6 over the disc, one width (blocked), no ragged edge', () => {
		expect(pages.S11.layout!.sizing).toBe('blocked');
		const [p, d] = frames(pages.S11);
		expectNear(p.w, d.w, 0.5);
		expectNear(p.w, 100.1);
		expectFrame(p, { x: 54.95, y: 12, w: 100.1, h: 166.9 });
	});

	it('S12: three 16:9 on landscape, 2 + 1 at 133.5 × 75.1', () => {
		const fr = frames(pages.S12);
		fr.forEach((f) => {
			expectNear(f.w, 133.5);
			expectNear(f.h, 75.1);
		});
		expect(near(fr[0].y, fr[1].y) && fr[2].y > fr[0].y).toBe(true);
	});

	it('S13: one flush block, two 90 discs over [1.61 / 16:9 | 0.6]', () => {
		expect(pages.S13.layout!.sizing).toBe('blocked');
		byKind(pages.S13, 'S').forEach((it) => expectNear(it.frame.w, 90));
		const p161 = byKind(pages.S13, 1.61)[0].frame;
		const p169 = byKind(pages.S13, 16 / 9)[0].frame;
		const p06 = byKind(pages.S13, 0.6)[0].frame;
		expectNear(p161.w, 103.1);
		expectNear(p161.w, p169.w, 0.1);
		expectNear(p161.y, p06.y, 0.1);
		expectNear(p169.y + p169.h, p06.y + p06.h, 0.1);
		expectFrame(p06, { x: 121.1, y: 132.5, w: 76.9, h: 128.1 });
	});

	it('X1: five discs 2-1-2 at 87, symmetric both ways', () => {
		widths(pages.X1).forEach((w) => expectNear(w, 87));
		const { metrics } = pages.X1.meta!;
		expect(metrics.tb).toBeGreaterThan(0.99);
		expect(metrics.lr).toBeGreaterThan(0.99);
	});

	it('X2: three discs on landscape, 2 + 1 at 90', () => {
		const fr = frames(pages.X2);
		fr.forEach((f) => expectNear(f.w, 90));
		expect(near(fr[0].y, fr[1].y) && fr[2].y > fr[0].y).toBe(true);
	});

	it('X3: landscape, a disc beside a 2:5, nothing shrinks', () => {
		expectNear(pages.X3.items[0].frame.w, 186);
		expectNear(pages.X3.items[1].frame.h, 186);
		expectNear(pages.X3.items[1].frame.w, 74.4);
	});

	it('gives identical charts one size: no hero layouts', () => {
		for (const n of [3, 5]) {
			const page = laid('portrait', Array.from({ length: n }, S));
			expect(new Set(widths(page).map((w) => w.toFixed(6))).size).toBe(1);
		}
	});
});

// === Turns ===

describe('the arranger: turning a page', () => {
	const s5 = laid('landscape', [S(), S()]);
	const s13 = laid('portrait', [S(), S(), P(1.61), P(16 / 9), P(0.6)]);
	const s3 = laid('portrait', [S(), S(), S()]);
	const d6 = laid('portrait', [S(), P(3)]);
	const turns = Object.fromEntries(
		Object.entries({ S14: s5, T2: s13, T3: s3, T4: d6 }).map(([id, page]) => {
			const other: PageOrientation = page.orientation === 'portrait' ? 'landscape' : 'portrait';
			const once = turned(page, other);
			return [id, [page, once, turned(once, page.orientation)]];
		})
	);

	it('S14: two discs in a landscape row become a portrait column, and come back exactly', () => {
		const [row, column, back] = turns.S14;
		expect(column.how).toBe('transposed');
		expectFrame(column.items[0].frame, { x: 38.25, y: 12, w: 133.5, h: 133.5 });
		expectFrame(column.items[1].frame, { x: 38.25, y: 151.5, w: 133.5, h: 133.5 });
		expect(back.how).toBe('restored');
		expectSamePage(row, back);
	});

	it('T2: S13 on landscape is re-laid as [1.61 | 16:9] over [disc | 0.6 | disc]', () => {
		const [, landscape] = turns.T2;
		expect(landscape.how).toBe('re-laid');
		const at = (kind: 'S' | number) => byKind(landscape, kind).map((it) => it.frame);
		expectFrame(at(1.61)[0], { x: 12, y: 12.4, w: 126.9, h: 78.8 });
		expectFrame(at(16 / 9)[0], { x: 144.9, y: 12.4, w: 140.1, h: 78.8 });
		const [left, right] = at('S');
		expectFrame(left, { x: 12, y: 97.2, w: 100.4, h: 100.4 });
		expectFrame(right, { x: 184.6, y: 97.2, w: 100.4, h: 100.4 });
		expectFrame(at(0.6)[0], { x: 118.4, y: 97.2, w: 60.2, h: 100.4 });
	});

	it('T3: S3 on landscape is two stacked beside one (transposed)', () => {
		const [, landscape] = turns.T3;
		expect(landscape.how).toBe('transposed');
		expectFrame(landscape.items[0].frame, { x: 55.5, y: 12, w: 90, h: 90 });
		expectFrame(landscape.items[1].frame, { x: 55.5, y: 108, w: 90, h: 90 });
		expectFrame(landscape.items[2].frame, { x: 151.5, y: 60, w: 90, h: 90 });
	});

	it('T4: a disc over a 3:1 on landscape: the disc 120.9 over the 3:1 177.4 × 59.1', () => {
		const [, landscape] = turns.T4;
		const [disc, strip] = frames(landscape);
		expectFrame(disc, { x: 88.05, y: 12, w: 120.9, h: 120.9 });
		expectFrame(strip, { x: 59.8, y: 138.9, w: 177.4, h: 59.1 });
	});

	it('restores every page exactly when turned and turned back', () => {
		for (const [first, , back] of Object.values(turns)) {
			expect(back.how).toBe('restored');
			expectSamePage(first, back);
			expect(back.items.map((it) => it.id)).toEqual(first.items.map((it) => it.id));
			expect(back.layout).toEqual(first.layout);
		}
	});

	it('keeps the invariants and the page’s own charts', () => {
		for (const [first, once] of Object.values(turns)) {
			expectInvariants(once);
			expect(once.items.map((it) => it.id).sort()).toEqual(first.items.map((it) => it.id).sort());
		}
	});

	it('re-lays a page turned back after an edit dropped the memo', () => {
		const once = turned(s3, 'landscape');
		const back = turned({ ...once, turnMemo: undefined }, 'portrait');
		expect(back.how).not.toBe('restored');
		expectInvariants(back);
	});

	it('clears manual, and turning back brings the hand layout back with it', () => {
		const hand: DocPage = {
			...empty('portrait'),
			manual: true,
			items: [
				{ ...S(), frame: { x: 12, y: 12, w: 120, h: 120 } },
				{ ...P(3), frame: { x: 12, y: 180.5, w: 186, h: 62 } }
			]
		};
		const once = turned(hand, 'landscape');
		expect(once.manual).toBeUndefined();
		expect(once.turnMemo).toMatchObject({ orientation: 'portrait', manual: true });
		const back = turned(once, 'portrait');
		expect(back.how).toBe('restored');
		expect(back.manual).toBe(true);
		expect(back.layout).toBeUndefined();
		expectSamePage(hand, back);
	});

	it('turns an empty page as it is', () => {
		const plan = turnLayout(empty('portrait'), 'landscape');
		expect(plan).toMatchObject({ items: [], how: 'empty', manual: false });
		expect(plan.turnMemo).toBeUndefined();
	});

	it('flags a crowded turn that leaves charts under 40 mm, and keeps them clear of each other', () => {
		const tall = laid(
			'portrait',
			Array.from({ length: 8 }, () => P(0.4))
		);
		expectInvariants(tall);
		const once = turned(tall, 'landscape');
		expect(once.belowMin).toBe(true);
		expect(Math.min(...widths(once))).toBeLessThan(MIN_CHART_SIDE_MM);
		expectInvariants(once);
		const back = turned(once, 'portrait');
		expect(back.how).toBe('restored');
		expect(back.belowMin).toBe(false);
		expectSamePage(tall, back);
	});

	it('turns a page of more charts than it lays out with rotateLayout', () => {
		const discs = Array.from({ length: 9 }, (_, i) => ({
			...S(),
			frame: { x: 12 + (i % 3) * 63, y: 12 + Math.floor(i / 3) * 63, w: 57, h: 57 }
		}));
		const page: DocPage = { ...empty('portrait'), manual: true, items: discs };
		const plan = turnLayout(page, 'landscape');
		expect(plan.how).toBe('fallback');
		expect(plan.manual).toBe(true);
		const expected = rotateLayout(
			discs.map((it) => ({ frame: it.frame, aspect: 1 })),
			'portrait',
			'landscape'
		);
		expect(plan.items.map((p) => p.frame)).toEqual(expected);
		expect(plan.items.map((p) => p.index)).toEqual([...Array(9).keys()]);
		const back = turned(applied(page, plan, 'landscape'), 'portrait');
		expect(back.how).toBe('restored');
		expectSamePage(page, back);
	});
});

// === Add to PDF ===

describe('the arranger: Add to PDF', () => {
	const handPage = (): DocPage => ({
		...empty('portrait'),
		manual: true,
		items: [{ ...S(), frame: { x: 12, y: 12, w: 120, h: 120 } }]
	});
	const docs: Record<string, Added> = {
		D1: add([laid('portrait', [S()]), empty()], S()),
		D2: add([laid('portrait', [S()])], S()),
		D3: add([laid('portrait', [S(), S()])], S()),
		D4: add([laid('portrait', [S(), S(), S(), S()])], S()),
		D5: add([laid('portrait', [S(), P(1.61)])], P(3)),
		D6: add([laid('portrait', [S()]), empty()], P(3)),
		D7: add([laid('portrait', [S()]), empty()], P(1.61)),
		D8: add([laid('portrait', [S()]), empty()], P(16 / 9)),
		D9: add([laid('landscape', [S()]), empty('landscape')], P(0.4)),
		D10: add([laid('portrait', [S()])], P(1.61)),
		D11: add([laid('portrait', [S(), P(1.61)]), laid('portrait', [S()])], P(3)),
		D12: add([handPage()], P(3)),
		D13: add([laid('portrait', [S(), S()])], P(3))
	};

	it('changes only the chosen page', () => {
		for (const [id, d] of Object.entries(docs)) {
			d.before.forEach((page, i) => {
				if (i !== d.index) expect(d.after[i], id).toBe(page);
			});
		}
	});

	it('keeps the invariants on every page after Add', () => {
		for (const d of Object.values(docs)) {
			for (const page of d.after) expectInvariants(page, { centred: !page.manual });
		}
	});

	it('D1: a disc takes the empty page, alone at 186', () => {
		expect(docs.D1.index).toBe(1);
		expect(docs.D1.newPage).toBe(false);
		expectFrame(docs.D1.after[1].items[0].frame, { x: 12, y: 55.5, w: 186, h: 186 });
	});

	it('D2: a second disc joins: two discs at 133.5 on page 1', () => {
		expect(docs.D2.index).toBe(0);
		expectNear(docs.D2.plan.q!, 0.718, 0.001);
		expect(docs.D2.plan.relaid).toBe(true);
		widths(docs.D2.after[0]).forEach((w) => expectNear(w, 133.5));
	});

	it('D3, D4, D13: a new page', () => {
		for (const id of ['D3', 'D4', 'D13']) expect(docs[id].newPage, id).toBe(true);
		expect(docs.D3.after[1].orientation).toBe('portrait');
		expectFrame(docs.D3.after[1].items[0].frame, { x: 12, y: 55.5, w: 186, h: 186 });
		expect(docs.D4.after[1].orientation).toBe('portrait');
	});

	it('D13: the page Add opens for a 3:1 is landscape, the strip at 273 × 91', () => {
		const page = docs.D13.after[1];
		expect(page.orientation).toBe('landscape');
		expectFrame(page.items[0].frame, { x: 12, y: 59.5, w: 273, h: 91 });
		expect(docs.D13.plan.q).toBeNull();
	});

	it('D5: one column at 133.5, the panorama last and lowest', () => {
		const { items } = docs.D5.after[0];
		expect(items).toHaveLength(3);
		items.forEach((it) => expectNear(it.frame.w, 133.5, 0.2));
		expect(items[2].chart.aspect).toBe(3);
		expect(items[2].frame.y).toBeGreaterThan(items[1].frame.y);
		expectNear(docs.D5.plan.q!, 0.718, 0.001);
	});

	it('D6: the disc keeps 186 and moves up, the panorama under it, page 2 stays empty', () => {
		const before = docs.D6.before[0].items[0].frame;
		const [d, p] = frames(docs.D6.after[0]);
		expectFrame(d, { x: 12, y: 21.5, w: 186, h: 186 });
		expect(d.y).toBeLessThan(before.y);
		expectFrame(p, { x: 12, y: 213.5, w: 186, h: 62 });
		expect(docs.D6.after[1].items).toHaveLength(0);
		expect(docs.D6.plan).toMatchObject({ q: 1, relaid: true });
	});

	it('D7: the 1.61 takes the empty page (0.885 < 0.90)', () => {
		expect(docs.D7.index).toBe(1);
		expectFrame(docs.D7.after[1].items[0].frame, { x: 12, y: 90.73, w: 186, h: 115.53 });
	});

	it('D8: a 16:9 joins the disc page at 0.919, both 170.9 wide', () => {
		expect(docs.D8.index).toBe(0);
		expectNear(docs.D8.plan.q!, 0.919, 0.001);
		widths(docs.D8.after[0]).forEach((w) => expectNear(w, 170.9));
		expect(docs.D8.after[1].items).toHaveLength(0);
	});

	it('D9: landscape, the 2:5 beside the disc, nothing shrinks', () => {
		const [d, p] = frames(docs.D9.after[0]);
		expectFrame(d, { x: 15.3, y: 12, w: 186, h: 186 });
		expectFrame(p, { x: 207.3, y: 12, w: 74.4, h: 186 });
		expect(docs.D9.after[1].items).toHaveLength(0);
	});

	it('D10: no empty page, the 1.61 joins at 0.885', () => {
		expect(docs.D10.index).toBe(0);
		expectNear(docs.D10.plan.q!, 0.885, 0.002);
		widths(docs.D10.after[0]).forEach((w) => expectNear(w, 164.7));
	});

	it('D11: the page that loses nothing wins', () => {
		expect(docs.D11.index).toBe(1);
		expect(docs.D11.plan.q).toBe(1);
	});

	it('D12: a hand-arranged page: nothing moves, the 3:1 takes the free band', () => {
		const after = docs.D12.after[0];
		expect(after.items[0].frame).toEqual(docs.D12.before[0].items[0].frame);
		expect(after.manual).toBe(true);
		expect(after.layout).toBeUndefined();
		expectFrame(after.items[1].frame, { x: 12, y: 180.5, w: 186, h: 62 });
		expect(docs.D12.plan).toMatchObject({ q: 1, relaid: false });
	});

	it('opens a landscape page for a wide pinhole, a portrait one for anything else', () => {
		const opened = (chart: DocItem) => add([], chart);
		for (const aspect of [1.01, 1.61, 16 / 9, 3]) {
			const r = opened(P(aspect));
			expect(r.newPage).toBe(true);
			expect(r.after[0].orientation, `${aspect}`).toBe('landscape');
			expectFrame(r.after[0].items[0].frame, aloneFrame(aspect, 'landscape'), 1e-9);
		}
		for (const chart of [S(), P(1), P(0.6), P(0.4)]) {
			expect(opened(chart).after[0].orientation, chart.id).toBe('portrait');
		}
	});

	it('never turns an existing page: an empty portrait page takes a wide pinhole as it is', () => {
		const r = add([laid('portrait', [S(), S()]), empty('portrait')], P(3));
		expect(r.index).toBe(1);
		expect(r.after[1].orientation).toBe('portrait');
		expectFrame(r.after[1].items[0].frame, { x: 12, y: 117.5, w: 186, h: 62 });
	});

	it('gates against a portrait page when no empty page waits, even for a wide pinhole', () => {
		// On the landscape page Add would open, the 1.61 would get 273 mm: against that, page 1's
		// 164.7 would be 0.60 and fail. Against a portrait page it is 0.885 and joins.
		const r = add([laid('portrait', [S()])], P(1.61));
		expect(r.index).toBe(0);
		expectNear(r.plan.q!, 0.885, 0.002);
	});

	it('caps a tall chart on a page of its own by the content height', () => {
		const r = add([], P(0.5));
		expect(r.after[0].orientation).toBe('portrait');
		expectFrame(r.after[0].items[0].frame, { x: 36.75, y: 12, w: 136.5, h: 273 }, 1e-9);
	});

	it('puts a second disc beside the first on a landscape page', () => {
		const r = add([laid('landscape', [S()])], S());
		expect(r.index).toBe(0);
		const [a, b] = frames(r.after[0]);
		expectFrame(a, { x: 12, y: 38.25, w: 133.5, h: 133.5 });
		expectFrame(b, { x: 151.5, y: 38.25, w: 133.5, h: 133.5 });
	});

	it('packs panoramas onto one page at the full width instead of a page each', () => {
		for (const aspect of [21 / 9, 3, 3.5]) {
			let pages: DocPage[] = [empty('portrait')];
			for (let i = 0; i < 3; i++) pages = add(pages, P(aspect)).after;
			expect(pages, `${aspect}`).toHaveLength(1);
			widths(pages[0]).forEach((w) => expectNear(w, 186, 1e-9));
			expectInvariants(pages[0]);
		}
	});

	it('takes a third disc to a new page: two discs per page', () => {
		const r = add([laid('portrait', [S(), S()])], S());
		expect(r.newPage).toBe(true);
	});

	it('gives a tie to the latest page', () => {
		const r = add([laid('portrait', [S()]), laid('portrait', [S()])], P(3));
		expect(r.index).toBe(1);
	});

	it('skips a page of eight charts', () => {
		const full = laid(
			'portrait',
			Array.from({ length: 8 }, () => P(3))
		);
		const r = add([laid('portrait', [S()]), full], P(3));
		expect(r.index).toBe(0);
	});

	it('stops scanning older pages at the time budget', () => {
		const pages = () => [laid('portrait', [S()]), laid('portrait', [S(), P(1.61)])];
		// Page 1 loses nothing (q 1) and beats page 2 (0.718)...
		expect(add(pages(), P(3)).index).toBe(0);
		// ...unless the budget runs out after page 2: the start and the first check are on time.
		let calls = 0;
		const late = () => (calls++ < 2 ? 0 : ARRANGE.budgetMs + 1);
		const r = add(pages(), P(3), late);
		expect(r.index).toBe(1);
		expectNear(r.plan.q!, 0.718, 0.001);
	});

	it('adds to seven or eight charts by insertion into the page’s own tree', () => {
		const six = laid('portrait', Array.from({ length: 6 }, S));
		const tree = treeFromFrames(frames(six))!;
		const items: ArrangeItem[] = [
			...six.items.map((it) => ({ ...item(it), frame: it.frame })),
			item(S())
		];
		const res = arrange('portrait', items, { mode: 'add' });
		expect(res.trees).toBe(insertions(tree, 6).length);
		expectInvariants(
			applied(
				six,
				{
					items: res.seq.map((index) => ({
						index: index === 6 ? -1 : index,
						frame: res.frames[index]
					}))
				},
				'portrait',
				S()
			)
		);
		// The seventh disc would get 0.40 of a page of its own: it opens one.
		expect(add([six], S()).newPage).toBe(true);
		// With no guillotine cut in the old frames, the page order alone.
		const pinwheel = [
			{ x: 12, y: 12, w: 120, h: 40 },
			{ x: 138, y: 12, w: 40, h: 120 },
			{ x: 58, y: 138, w: 120, h: 40 },
			{ x: 12, y: 58, w: 40, h: 120 },
			{ x: 58, y: 58, w: 74, h: 74 },
			{ x: 12, y: 200, w: 60, h: 60 }
		].map((frame) => ({ kind: 'pinhole' as const, aspect: frame.w / frame.h, frame }));
		const scattered = arrange('portrait', [...pinwheel, { kind: 'stereo', aspect: 1 }], {
			mode: 'add'
		});
		expect(treeFromFrames(pinwheel.map((it) => it.frame))).toBeNull();
		expect(scattered.trees).toBe(1806);
	});

	it('A1: ten Adds into an empty document fill seven pages', () => {
		const charts = [S(), S(), P(1.61), P(3), S(), P(16 / 9), S(), P(0.6), P(1.61), S()];
		let pages: DocPage[] = [];
		const log: string[] = [];
		for (const chart of charts) {
			const r = add(pages, chart, () => 0);
			pages = r.after;
			log.push(`${r.index + 1}${r.newPage ? '*' : ''}`);
		}
		expect(log).toEqual(['1*', '1', '2*', '3*', '4*', '4', '5*', '6*', '5', '7*']);
		expect(pages.map((p) => p.orientation[0]).join('')).toBe('pllpppp');
		const w = pages.map((p) =>
			widths(p)
				.map((x) => x.toFixed(1))
				.join(' ')
		);
		expect(w).toEqual([
			'133.5 133.5',
			'273.0',
			'273.0',
			'170.9 170.9',
			'164.7 164.7',
			'163.8',
			'186.0'
		]);
		for (const page of pages) expectInvariants(page);
	});

	it('keeps the invariants through a session of random Adds, and is deterministic', () => {
		const rnd = lcg(11);
		const run = (charts: DocItem[]) => {
			let pages: DocPage[] = [empty('landscape')];
			for (const chart of charts) pages = add(pages, chart, () => 0).after;
			return pages;
		};
		for (let session = 0; session < 6; session++) {
			const charts = randomCharts(rnd, 12);
			const a = run(charts);
			for (const page of a) expectInvariants(page, { centred: !page.manual });
			const shape = (pages: DocPage[]) => pages.map((p) => [p.orientation, frames(p), p.layout]);
			expect(shape(run(charts))).toEqual(shape(a));
		}
	});
});

// === Random pages, determinism, speed ===

describe('the arranger: random pages', () => {
	it('keeps the invariants on 300 random pages, and lays each out the same way twice', () => {
		const rnd = lcg(7);
		for (let k = 0; k < 300; k++) {
			const n = 1 + Math.floor(rnd() * 8);
			const charts = randomCharts(rnd, n);
			const o: PageOrientation = rnd() < 0.5 ? 'portrait' : 'landscape';
			const a = laid(o, charts);
			const b = laid(o, charts);
			const res = arrange(o, charts.map(item));
			expectInvariants({ ...a, belowMin: res.belowMin });
			expect(b.items.map((it) => it.frame)).toEqual(a.items.map((it) => it.frame));
			expect(b.layout).toEqual(a.layout);
		}
	}, 60_000);

	it('turns random pages and back, exactly', () => {
		const rnd = lcg(5);
		for (let k = 0; k < 60; k++) {
			const n = 1 + Math.floor(rnd() * 6);
			const o: PageOrientation = rnd() < 0.5 ? 'portrait' : 'landscape';
			const page = laid(o, randomCharts(rnd, n));
			const other: PageOrientation = o === 'portrait' ? 'landscape' : 'portrait';
			const once = turned(page, other);
			expectInvariants(once);
			expect(turned(page, other).items).toEqual(once.items);
			const back = turned(once, o);
			expect(back.how).toBe('restored');
			expectSamePage(page, back);
		}
	}, 60_000);

	it('lays out the worst case (five distinct charts, every order) in under 30 ms', () => {
		const charts = [S(), P(1.61), P(16 / 9), P(3), P(0.6)].map(item);
		arrange('portrait', charts);
		let best = Infinity;
		for (let i = 0; i < 5; i++) {
			const t0 = performance.now();
			arrange('portrait', charts);
			best = Math.min(best, performance.now() - t0);
		}
		expect(best).toBeLessThan(30);
	});
});
