/**
 * The arranger behind Add to PDF and a page turn. Pure functions, no DOM.
 *
 * A page layout is an ordered slicing (guillotine) tree: a leaf is a chart, a node puts its
 * kids side by side (H) or stacks them (V) one gutter apart, and directions alternate. Every
 * tree is sized two ways (uniform: one fair share for every chart; blocked: neighbours flush),
 * the block is centred in the content box and each chart in its cell. Size decides first (P,
 * the fair share, with a handicap for ragged edges and for a changed order); the layouts within
 * 3 % of the best are ranked on looks (symmetry, stability, order, tidiness). Add to PDF
 * (`planAdd`) and a turn (`turnLayout`) sit on top.
 *
 * Millimetres, origin at the page's top-left, y down. A chart's share is its width over its
 * width alone on the page; a disc is packed as its square box.
 */

import { blockBounds, chartsOf, isBlank, typesetOf } from './blocks';
import { contentBox, GUTTER_MM, MIN_CHART_SIDE_MM, rotateLayout, underMinSide } from './geometry';
import type {
	ChartKind,
	ChartSnapshot,
	DocPage,
	LayoutNode,
	LayoutSizing,
	LayoutTree,
	PageLayout,
	PageOrientation,
	Rect,
	TurnMemo
} from './types';

/** The arranger's tuning. */
export const ARRANGE = {
	/** Layouts within 3 % of the best P compete on looks. */
	band: 0.03,
	/** P handicap when neighbours nearly, but not quite, line up. */
	ragged: 0.94,
	/** A cross-size difference below this, mm, is aligned... */
	nearMissMm: 0.5,
	/** ...and above this share of the larger one an intended contrast. */
	nearMissRel: 0.2,
	/** P factor on Add when the new chart is not last. */
	orderAdd: 0.96,
	/** P factor from scratch or on a turn when the order changes. */
	orderScratch: 0.99,
	/** On a turn the old layout, transposed, is kept within 5 % of the best. */
	turnKeep: 0.95,
	/** Every distinct chart order up to this many charts (from scratch, a turn). */
	permN: 5,
	/** On Add, every position of the new chart up to this many charts; Atkins insertion beyond. */
	insertN: 6,
	/** Exact slot assignment for up to this many identical charts, greedy beyond. */
	identical: 6,
	/** The looks, in weight order (`LayoutMetrics`). */
	weights: {
		lr: 0.3,
		tb: 0.2,
		stab: 0.15,
		order: 0.1,
		tidy: 0.1,
		cov: 0.05,
		bal: 0.05,
		size: 0.05
	},
	/** Gate for a pinhole joining an occupied page while an empty page waits. */
	strict: 0.9,
	/** Gate for joining an occupied page when the alternative is a new page. */
	fill: 0.7,
	/** Page-choice ties: the latest page within this of the best q. */
	tie: 0.02,
	/** Add never re-lays a page that already holds this many charts. */
	maxAuto: 8,
	/** Add stops scanning older pages past this, ms. */
	budgetMs: 40
} as const;

const EPS = 1e-9;

/** What the arranger needs of a chart: its kind, its aspect and, on a laid page, its frame. */
export interface ArrangeItem {
	kind: ChartKind;
	aspect: number;
	frame?: Rect | null;
}

/** A chart Add to PDF brings. */
export interface ArrangeChart {
	kind: ChartKind;
	aspect: number;
}

interface Size {
	w: number;
	h: number;
}

export function chartKind(chart: Pick<ChartSnapshot, 'view'>): ChartKind {
	return chart.view.projection === 'stereographic' ? 'stereo' : 'pinhole';
}

/** The largest size of this aspect alone in the content box. */
export function aloneSize(aspect: number, o: PageOrientation): Size {
	const b = contentBox(o);
	const w = Math.min(b.w, b.h * aspect);
	return { w, h: w / aspect };
}

/** A lone chart, as large as possible, centred in the content box. */
export function aloneFrame(aspect: number, o: PageOrientation): Rect {
	const b = contentBox(o);
	const { w, h } = aloneSize(aspect, o);
	return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
}

/**
 * Charts of one type look alike, for chart orders, sizes and duplicate layouts: discs, or
 * pinholes of one aspect to two decimals. Only exact twins trade slots (`assignSlots`).
 */
export function typeKey(item: ArrangeChart): string {
	return item.kind === 'stereo' ? 'S' : 'P' + item.aspect.toFixed(2);
}

// === Envelopes ===

/** Affine pieces `[slope, const]`: a block dimension at uniform share s is the max of slope·s + const. */
export type Envelope = [number, number][];

/** Keeps the pieces that are the maximum somewhere in s ∈ [0, 1]. Sorts `pieces` in place. */
function prune(pieces: Envelope): Envelope {
	pieces.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
	const out: Envelope = [];
	let bestEnd = -Infinity;
	for (const p of pieces) {
		const end = p[0] + p[1];
		if (end > bestEnd + 1e-12) {
			out.push(p);
			bestEnd = end;
		}
	}
	return out;
}

function sumEnvelopes(a: Envelope, b: Envelope, gutter: number): Envelope {
	const out: Envelope = [];
	for (const p of a) for (const q of b) out.push([p[0] + q[0], p[1] + q[1] + gutter]);
	return prune(out);
}

function maxEnvelopes(a: Envelope, b: Envelope): Envelope {
	return prune([...a, ...b]);
}

/**
 * The largest uniform share (at most 1) at which a block with width `W` and height `H`
 * fits `box`: exact, the minimum over the pieces of (box − const)/slope.
 */
export function envelopeScale(W: Envelope, H: Envelope, box: Rect): number {
	let s = 1;
	for (const [a, c] of W) s = Math.min(s, (box.w - c) / a);
	for (const [a, c] of H) s = Math.min(s, (box.h - c) / a);
	return s;
}

/** The width and height envelopes of `tree`, its leaves sized from `base`. */
export function envelopeOf(tree: LayoutTree, base: readonly Size[]): { W: Envelope; H: Envelope } {
	if (typeof tree === 'number') return { W: [[base[tree].w, 0]], H: [[base[tree].h, 0]] };
	const kids = tree.kids.map((k) => envelopeOf(k, base));
	let { W, H } = kids[0];
	for (const k of kids.slice(1)) {
		if (tree.dir === 'H') [W, H] = [sumEnvelopes(W, k.W, GUTTER_MM), maxEnvelopes(H, k.H)];
		else [W, H] = [maxEnvelopes(W, k.W), sumEnvelopes(H, k.H, GUTTER_MM)];
	}
	return { W, H };
}

// === Trees ===

export interface EnumeratedTree {
	tree: LayoutTree;
	W: Envelope;
	H: Envelope;
}

/**
 * Every slicing tree over a leaf order, with its envelopes: kids alternate direction, so each
 * guillotine layout appears once (1, 2, 6, 22, 90, 394, 1806, 8558 trees for 1..8 leaves).
 * Memoised per enumerator, whose leaves are sized from `base`.
 */
export function treeEnumerator(
	base: readonly Size[]
): (seq: readonly number[]) => EnumeratedTree[] {
	const memo = new Map<string, EnumeratedTree[]>();
	const leaf = (i: number): EnumeratedTree => ({
		tree: i,
		W: [[base[i].w, 0]],
		H: [[base[i].h, 0]]
	});
	function trees(seq: readonly number[], dir: LayoutNode['dir']): EnumeratedTree[] {
		if (seq.length === 1) return [leaf(seq[0])];
		const key = seq.join(',') + dir;
		const hit = memo.get(key);
		if (hit) return hit;
		const out: EnumeratedTree[] = [];
		const other = dir === 'H' ? 'V' : 'H';
		for (let m = 1; m < seq.length; m++) {
			const first = trees(seq.slice(0, m), other);
			const restSeq = seq.slice(m);
			// The rest is a second kid (the other direction), or more kids of this node (flattened).
			const rests: [EnumeratedTree, boolean][] =
				restSeq.length === 1
					? [[leaf(restSeq[0]), false]]
					: [
							...trees(restSeq, other).map((r): [EnumeratedTree, boolean] => [r, false]),
							...trees(restSeq, dir).map((r): [EnumeratedTree, boolean] => [r, true])
						];
			for (const f of first) {
				for (const [r, flatten] of rests) {
					const kids = flatten ? [f.tree, ...(r.tree as LayoutNode).kids] : [f.tree, r.tree];
					out.push({
						tree: { dir, kids },
						W: dir === 'H' ? sumEnvelopes(f.W, r.W, GUTTER_MM) : maxEnvelopes(f.W, r.W),
						H: dir === 'H' ? maxEnvelopes(f.H, r.H) : sumEnvelopes(f.H, r.H, GUTTER_MM)
					});
				}
			}
		}
		memo.set(key, out);
		return out;
	}
	return (seq) => (seq.length === 1 ? trees(seq, 'H') : [...trees(seq, 'H'), ...trees(seq, 'V')]);
}

/** `H(0 V(1 2))`, leaves through `label`. */
export function treeString(tree: LayoutTree, label: (i: number) => string = String): string {
	if (typeof tree === 'number') return label(tree);
	return tree.dir + '(' + tree.kids.map((k) => treeString(k, label)).join(' ') + ')';
}

/** The leaves in reading order. */
export function leavesOf(tree: LayoutTree, out: number[] = []): number[] {
	if (typeof tree === 'number') out.push(tree);
	else for (const k of tree.kids) leavesOf(k, out);
	return out;
}

/** Rows become columns and columns rows. */
export function transposeTree(tree: LayoutTree): LayoutTree {
	if (typeof tree === 'number') return tree;
	return { dir: tree.dir === 'H' ? 'V' : 'H', kids: tree.kids.map(transposeTree) };
}

function mapLeaves(tree: LayoutTree, f: (i: number) => number): LayoutTree {
	if (typeof tree === 'number') return f(tree);
	return { dir: tree.dir, kids: tree.kids.map((k) => mapLeaves(k, f)) };
}

/** Kids of a node's own direction merged into it, single-kid nodes dropped. */
export function normalizeTree(tree: LayoutTree): LayoutTree {
	if (typeof tree === 'number') return tree;
	const kids: LayoutTree[] = [];
	for (const k of tree.kids.map(normalizeTree)) {
		if (typeof k !== 'number' && k.dir === tree.dir) kids.push(...k.kids);
		else kids.push(k);
	}
	return kids.length === 1 ? kids[0] : { dir: tree.dir, kids };
}

/**
 * The slicing tree behind `frames`, from guillotine cuts (a stack first, then a row; a
 * 0.5 mm overlap still cuts); null when they have none (a pinwheel). Leaves index `frames`.
 */
export function treeFromFrames(
	frames: readonly Rect[],
	idx: readonly number[] = frames.map((_, i) => i)
): LayoutTree | null {
	if (idx.length === 1) return idx[0];
	for (const dir of ['V', 'H'] as const) {
		const lo = (i: number) => (dir === 'V' ? frames[i].y : frames[i].x);
		const hi = (i: number) => (dir === 'V' ? frames[i].y + frames[i].h : frames[i].x + frames[i].w);
		const sorted = idx.slice().sort((a, b) => lo(a) - lo(b) || a - b);
		const groups: number[][] = [];
		let cur = [sorted[0]];
		let end = hi(sorted[0]);
		for (const i of sorted.slice(1)) {
			if (lo(i) >= end - 0.5) {
				groups.push(cur);
				cur = [i];
			} else cur.push(i);
			end = Math.max(end, hi(i));
		}
		groups.push(cur);
		if (groups.length < 2) continue;
		const kids: LayoutTree[] = [];
		for (const g of groups) {
			const sub = treeFromFrames(frames, g);
			if (sub === null) return null;
			if (typeof sub !== 'number' && sub.dir === dir) kids.push(...sub.kids);
			else kids.push(sub);
		}
		return { dir, kids };
	}
	return null;
}

/**
 * Atkins insertion: every way to add leaf `x` to `tree` without breaking it up (beside, above
 * or below any subtree, or as a new kid anywhere in any cut), normalised and deduplicated.
 */
export function insertions(tree: LayoutTree, x: number): LayoutTree[] {
	const out = new Map<string, LayoutTree>();
	const add = (t: LayoutTree) => {
		const n = normalizeTree(t);
		out.set(treeString(n), n);
	};
	const rec = (node: LayoutTree, rebuild: (t: LayoutTree) => void) => {
		for (const dir of ['H', 'V'] as const) {
			rebuild({ dir, kids: [node, x] });
			rebuild({ dir, kids: [x, node] });
		}
		if (typeof node === 'number') return;
		for (let k = 0; k <= node.kids.length; k++) {
			rebuild({ dir: node.dir, kids: [...node.kids.slice(0, k), x, ...node.kids.slice(k)] });
		}
		node.kids.forEach((child, k) =>
			rec(child, (sub) =>
				rebuild({ dir: node.dir, kids: node.kids.map((c, j) => (j === k ? sub : c)) })
			)
		);
	};
	rec(tree, add);
	return [...out.values()];
}

// === Sizing and placement ===
// A sizing gives each leaf a share t[i]: its frame is t[i] × the chart's size alone.

/**
 * Blocked (BRIC) sizing: the kids of a row share a height, those of a stack a width, so the
 * block has no slack. Null for a lone chart (the same as uniform) and when a share falls
 * outside (0, 1].
 */
export function blockedScales(
	tree: LayoutTree,
	base: readonly Size[],
	box: Rect,
	n: number
): number[] | null {
	if (typeof tree === 'number') return null;
	// Each subtree's width is affine in its height: w = a·h + b.
	const aff = new Map<LayoutTree, { a: number; b: number }>();
	const affine = (node: LayoutTree): { a: number; b: number } => {
		if (typeof node === 'number') return { a: base[node].w / base[node].h, b: 0 };
		const ks = node.kids.map(affine);
		const g = GUTTER_MM * (ks.length - 1);
		let r: { a: number; b: number };
		if (node.dir === 'H') {
			r = { a: ks.reduce((s, k) => s + k.a, 0), b: ks.reduce((s, k) => s + k.b, 0) + g };
		} else {
			const a = 1 / ks.reduce((s, k) => s + 1 / k.a, 0);
			r = { a, b: a * (ks.reduce((s, k) => s + k.b / k.a, 0) - g) };
		}
		aff.set(node, r);
		return r;
	};
	const root = affine(tree);
	const H = Math.min(box.h, (box.w - root.b) / root.a);
	const t = new Array<number>(n).fill(0);
	let ok = H > 0;
	const assign = (node: LayoutTree, h: number) => {
		if (h <= 0) ok = false;
		if (typeof node === 'number') {
			t[node] = h / base[node].h;
			return;
		}
		if (node.dir === 'H') {
			for (const k of node.kids) assign(k, h);
		} else {
			const { a, b } = aff.get(node)!;
			const w = a * h + b;
			for (const k of node.kids) {
				const ka = typeof k === 'number' ? { a: base[k].w / base[k].h, b: 0 } : aff.get(k)!;
				assign(k, (w - ka.b) / ka.a);
			}
		}
	};
	assign(tree, H);
	if (!ok || t.some((v) => !(v > 0) || v > 1 + 1e-6)) return null;
	return t.map((v) => Math.min(1, v));
}

function blockSize(
	node: LayoutTree,
	t: readonly number[],
	base: readonly Size[]
): [number, number] {
	if (typeof node === 'number') return [base[node].w * t[node], base[node].h * t[node]];
	let W = 0;
	let H = 0;
	for (const c of node.kids) {
		const [w, h] = blockSize(c, t, base);
		if (node.dir === 'H') {
			W += w;
			if (h > H) H = h;
		} else {
			H += h;
			if (w > W) W = w;
		}
	}
	if (node.dir === 'H') W += GUTTER_MM * (node.kids.length - 1);
	else H += GUTTER_MM * (node.kids.length - 1);
	return [W, H];
}

function place(
	node: LayoutTree,
	t: readonly number[],
	base: readonly Size[],
	x: number,
	y: number,
	cw: number,
	ch: number,
	out: Rect[]
) {
	if (typeof node === 'number') {
		const w = base[node].w * t[node];
		const h = base[node].h * t[node];
		out[node] = { x: x + (cw - w) / 2, y: y + (ch - h) / 2, w, h };
		return;
	}
	const sizes = node.kids.map((c) => blockSize(c, t, base));
	const main = node.dir === 'H' ? 0 : 1;
	const total = sizes.reduce((a, s) => a + s[main], 0) + GUTTER_MM * (sizes.length - 1);
	let p = main === 0 ? x + (cw - total) / 2 : y + (ch - total) / 2;
	node.kids.forEach((c, j) => {
		if (main === 0) place(c, t, base, p, y, sizes[j][0], ch, out);
		else place(c, t, base, x, p, cw, sizes[j][1], out);
		p += sizes[j][main] + GUTTER_MM;
	});
}

/** Frames by leaf (item) index: the block centred in `box`, each chart centred in its cell. */
export function layoutFrames(
	tree: LayoutTree,
	t: readonly number[],
	base: readonly Size[],
	box: Rect
): Rect[] {
	const [w, h] = blockSize(tree, t, base);
	const out: Rect[] = [];
	place(tree, t, base, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h, out);
	return out;
}

// === Metrics ===

function union(rects: readonly Rect[]): Rect {
	const x = Math.min(...rects.map((r) => r.x));
	const y = Math.min(...rects.map((r) => r.y));
	return {
		x,
		y,
		w: Math.max(...rects.map((r) => r.x + r.w)) - x,
		h: Math.max(...rects.map((r) => r.y + r.h)) - y
	};
}

/**
 * Neighbours in a cut whose cross sizes (widths in a stack, heights in a row) nearly, but not
 * quite, match: ragged edges. `pairs` counts every pair of neighbours.
 */
export function raggedPairs(
	tree: LayoutTree,
	frames: readonly Rect[]
): { near: number; pairs: number } {
	let near = 0;
	let pairs = 0;
	const rec = (node: LayoutTree): Rect => {
		if (typeof node === 'number') return frames[node];
		const bs = node.kids.map(rec);
		for (let j = 1; j < bs.length; j++) {
			const a = node.dir === 'V' ? bs[j - 1].w : bs[j - 1].h;
			const b = node.dir === 'V' ? bs[j].w : bs[j].h;
			const m = Math.abs(a - b);
			pairs++;
			if (m > ARRANGE.nearMissMm && m < ARRANGE.nearMissRel * Math.max(a, b)) near++;
		}
		return union(bs);
	};
	rec(tree);
	return { near, pairs };
}

/** The area a chart covers: a disc's, or its frame's. */
export function chartArea(frame: Rect, kind: ChartKind): number {
	return kind === 'stereo' ? (Math.PI * frame.w * frame.w) / 4 : frame.w * frame.h;
}

/** The overlap of two circles `d` apart. */
function lens(r1: number, r2: number, d: number): number {
	if (d >= r1 + r2) return 0;
	if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
	const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
	const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
	const k = Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
	return r1 * r1 * a1 + r2 * r2 * a2 - k / 2;
}

function overlapArea(a: Rect, ka: ChartKind, b: Rect, kb: ChartKind): number {
	// A disc mirrored onto a rectangle is no symmetry.
	if (ka !== kb) return 0;
	if (ka === 'stereo') {
		const r1 = a.w / 2;
		const r2 = b.w / 2;
		return lens(r1, r2, Math.hypot(a.x + r1 - b.x - r2, a.y + r1 - b.y - r2));
	}
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Mirror symmetry about the box's vertical (`lr`) or horizontal (`tb`) centre line, 0..1: the
 * exact same-kind overlap of the mirrored charts with the charts, over their area.
 */
export function symmetry(
	frames: readonly Rect[],
	items: readonly { kind: ChartKind }[],
	box: Rect,
	axis: 'lr' | 'tb'
): number {
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	let s = 0;
	let A = 0;
	for (let i = 0; i < frames.length; i++) {
		const f = frames[i];
		A += chartArea(f, items[i].kind);
		const m = axis === 'lr' ? { ...f, x: 2 * cx - f.x - f.w } : { ...f, y: 2 * cy - f.y - f.h };
		for (let j = 0; j < frames.length; j++) {
			s += overlapArea(m, items[i].kind, frames[j], items[j].kind);
		}
	}
	return A > 0 ? Math.min(1, s / A) : 1;
}

/** 1 when the charts' area centroid is on the optical centre (2 % above the middle), less off it. */
export function balance(
	frames: readonly Rect[],
	items: readonly { kind: ChartKind }[],
	box: Rect
): number {
	let A = 0;
	let mx = 0;
	let my = 0;
	frames.forEach((f, i) => {
		const a = chartArea(f, items[i].kind);
		A += a;
		mx += a * (f.x + f.w / 2);
		my += a * (f.y + f.h / 2);
	});
	const u = (2 * (mx / A - (box.x + box.w / 2))) / box.w;
	const v = (2 * (my / A - (box.y + box.h / 2 - 0.02 * box.h))) / box.h;
	return Math.max(0, 1 - Math.sqrt((u * u + v * v) / 2));
}

/** Where one chart lies from another: left of, right of, above, below (0.5 mm of slack). */
export type Relation = 'L' | 'R' | 'A' | 'B';

function relations(a: Rect, b: Rect): Relation[] {
	const r: Relation[] = [];
	if (a.x + a.w <= b.x + 0.5) r.push('L');
	if (b.x + b.w <= a.x + 0.5) r.push('R');
	if (a.y + a.h <= b.y + 0.5) r.push('A');
	if (b.y + b.h <= a.y + 0.5) r.push('B');
	return r;
}

/** A turn transposes the page: left of becomes above. */
const TURN_RELATION: Record<Relation, Relation> = { L: 'A', R: 'B', A: 'L', B: 'R' };

/** Pairs out of order. */
export function inversions(seq: readonly number[]): number {
	let inv = 0;
	for (let i = 0; i < seq.length; i++) {
		for (let j = i + 1; j < seq.length; j++) if (seq[i] > seq[j]) inv++;
	}
	return inv;
}

/** The old layout `stability` compares against. */
export interface StabilityRef {
	/** Each old chart's centre in box fractions; null for a chart with no old frame. */
	pts: ([number, number] | null)[];
	/** Each pair of old charts and where the first lies from the second. */
	rel: [number, number, Relation[]][];
}

/** The reference for `stability` from the old frames; on a turn, centres and relations transposed. */
export function stabilityRef(
	old: readonly (Rect | null)[] | null,
	oldBox: Rect,
	turned: boolean
): StabilityRef | null {
	if (!old) return null;
	const pts = old.map((f): [number, number] | null => {
		if (!f) return null;
		const u = (f.x + f.w / 2 - oldBox.x) / oldBox.w;
		const v = (f.y + f.h / 2 - oldBox.y) / oldBox.h;
		return turned ? [v, u] : [u, v];
	});
	const rel: StabilityRef['rel'] = [];
	for (let i = 0; i < old.length; i++) {
		for (let j = i + 1; j < old.length; j++) {
			const a = old[i];
			const b = old[j];
			if (!a || !b) continue;
			const r = relations(a, b);
			rel.push([i, j, turned ? r.map((x) => TURN_RELATION[x]) : r]);
		}
	}
	return { pts, rel };
}

function centreFrac(f: Rect, box: Rect): [number, number] {
	return [(f.x + f.w / 2 - box.x) / box.w, (f.y + f.h / 2 - box.y) / box.h];
}

/**
 * 1 with no old layout. Else half the share of old pairwise relations kept, plus half of
 * 1 − the mean centre displacement over half the box (capped at 1).
 */
export function stability(frames: readonly Rect[], ref: StabilityRef | null, box: Rect): number {
	if (!ref) return 1;
	let kept = 0;
	for (const [i, j, was] of ref.rel) {
		const now = relations(frames[i], frames[j]);
		if ((was.length === 0 && now.length === 0) || was.some((x) => now.includes(x))) kept++;
	}
	const relKept = ref.rel.length ? kept / ref.rel.length : 1;
	let d = 0;
	let m = 0;
	ref.pts.forEach((p, i) => {
		if (!p) return;
		const c = centreFrac(frames[i], box);
		d += Math.hypot(c[0] - p[0], c[1] - p[1]);
		m++;
	});
	const disp = m ? Math.min(1, d / m / 0.5) : 0;
	return 0.5 * relKept + 0.5 * (1 - disp);
}

function permutations(a: readonly number[]): number[][] {
	if (a.length <= 1) return [a.slice()];
	const out: number[][] = [];
	a.forEach((x, i) => {
		for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...p]);
	});
	return out;
}

/**
 * Identical charts may trade slots: the hand-out that moves the old charts least (ties keep
 * the reading order), exact up to `ARRANGE.identical` twins, greedy beyond. Twins are one
 * kind at the very same aspect, not a whole type: each frame was made for its chart's aspect.
 * `frames` are by item, `seq` the item in each slot; returns the new `seq`.
 */
export function assignSlots(
	seq: readonly number[],
	frames: readonly Rect[],
	items: readonly ArrangeChart[],
	ref: StabilityRef | null,
	box: Rect
): number[] {
	if (!ref) return seq.slice();
	const out = seq.slice();
	const slotFrame = seq.map((i) => frames[i]);
	const groups = new Map<string, number[]>();
	seq.forEach((item, k) => {
		const key = items[item].kind + ':' + items[item].aspect;
		let slots = groups.get(key);
		if (!slots) groups.set(key, (slots = []));
		slots.push(k);
	});
	const cost = (item: number, k: number) => {
		const p = ref.pts[item];
		if (!p) return 0;
		const c = centreFrac(slotFrame[k], box);
		return Math.hypot(c[0] - p[0], c[1] - p[1]);
	};
	for (const slots of groups.values()) {
		if (slots.length < 2) continue;
		const members = slots.map((k) => seq[k]).sort((a, b) => a - b);
		let perm: number[];
		if (members.length <= ARRANGE.identical) {
			let best: { c: number; inv: number; perm: number[] } | null = null;
			for (const candidate of permutations(members)) {
				let c = 0;
				candidate.forEach((item, j) => (c += cost(item, slots[j])));
				const inv = inversions(candidate);
				if (!best || c < best.c - 1e-6 || (Math.abs(c - best.c) <= 1e-6 && inv < best.inv)) {
					best = { c, inv, perm: candidate };
				}
			}
			perm = best!.perm;
		} else {
			const free = new Set(slots);
			perm = [];
			for (const item of members) {
				let bk: number | null = null;
				for (const k of free) if (bk === null || cost(item, k) < cost(item, bk) - EPS) bk = k;
				free.delete(bk!);
				perm[slots.indexOf(bk!)] = item;
			}
		}
		perm.forEach((item, j) => (out[slots[j]] = item));
	}
	return out;
}

// === Chart orders ===

function identityOrder(n: number): number[] {
	return [...Array(n).keys()];
}

/** Every distinct order; identical charts keep their relative order (no duplicate layouts). */
function distinctOrders(items: readonly ArrangeChart[]): number[][] {
	const n = items.length;
	const key = items.map(typeKey);
	const out: number[][] = [];
	const used = new Array<boolean>(n).fill(false);
	const cur: number[] = [];
	const rec = () => {
		if (cur.length === n) {
			out.push(cur.slice());
			return;
		}
		for (let i = 0; i < n; i++) {
			if (used[i]) continue;
			let ok = true;
			for (let j = 0; j < i; j++) if (!used[j] && key[j] === key[i]) ok = false;
			if (!ok) continue;
			used[i] = true;
			cur.push(i);
			rec();
			cur.pop();
			used[i] = false;
		}
	};
	rec();
	return out;
}

/** The old charts keep their order; the new (last) one tries every position. */
function insertOrders(n: number): number[][] {
	const rest = identityOrder(n - 1);
	return Array.from({ length: n }, (_, k) => [...rest.slice(0, k), n - 1, ...rest.slice(k)]);
}

/** Discs first, then pinholes from wide to tall; stable within a type. */
function groupedOrder(items: readonly ArrangeChart[]): number[] {
	const rank = (it: ArrangeChart) => (it.kind === 'stereo' ? -Infinity : -it.aspect);
	return identityOrder(items.length).sort((a, b) => rank(items[a]) - rank(items[b]) || a - b);
}

// === Arrange ===

export type ArrangeMode = 'scratch' | 'add' | 'turn';

export interface ArrangeOptions {
	/**
	 * `scratch` (the default) lays the charts out afresh. `add`: the last item is new and the
	 * others' frames are the old layout. `turn`: the frames are the old layout on a page of
	 * orientation `from`.
	 */
	mode?: ArrangeMode;
	from?: PageOrientation;
	/** A layout to keep when it is within `ARRANGE.turnKeep` of the best (a turn). */
	prefer?: { tree: LayoutTree | null; sizing?: LayoutSizing | null } | null;
	/** Ignore the smallest side. */
	ignoreMin?: boolean;
}

/** The looks of a layout, each 0..1 (`ARRANGE.weights`). */
export interface LayoutMetrics {
	lr: number;
	tb: number;
	stab: number;
	order: number;
	tidy: number;
	cov: number;
	bal: number;
	size: number;
}

/** One sized tree. `frames` and `t` are by item index; `seq` is the item in each slot. */
export interface LayoutCandidate {
	frames: Rect[];
	seq: number[];
	tree: LayoutTree;
	sizing: LayoutSizing;
	t: number[];
	/** The smallest share. */
	s: number;
	/** s × the ragged handicap × the order factor. */
	P: number;
	rag: { near: number; pairs: number };
	inv: number;
	cov?: number;
	metrics?: LayoutMetrics;
	/** The looks score. */
	T?: number;
	/** The preferred layout, kept. */
	kept?: boolean;
}

export interface ArrangeResult {
	/** By item index. */
	frames: Rect[];
	/** The items in reading order. */
	seq: number[];
	/** Leaves are item indices; null with no items. */
	tree: LayoutTree | null;
	sizing: LayoutSizing;
	P: number;
	s: number;
	/** The preferred layout was kept. */
	kept: boolean;
	/** Nothing kept every side at 40 mm: the best layouts without the rule. */
	belowMin: boolean;
	metrics: Pick<LayoutMetrics, 'lr' | 'tb' | 'stab'>;
	/** The band, best first (just the kept layout when one was kept). */
	ranked: LayoutCandidate[];
	/** How many trees were enumerated. */
	trees: number;
}

interface TreeCandidate {
	seq: number[];
	tree: LayoutTree;
	s: number;
	inv: number;
	ub: number;
}

/**
 * Lay `items` (in the page's order; on Add the new chart last) out on a page of
 * orientation `o`: the best layout by size, then looks, and the band it was picked from.
 */
export function arrange(
	o: PageOrientation,
	items: readonly ArrangeItem[],
	opts: ArrangeOptions = {}
): ArrangeResult {
	const mode = opts.mode ?? 'scratch';
	const n = items.length;
	if (n === 0) {
		return {
			frames: [],
			seq: [],
			tree: null,
			sizing: 'uniform',
			P: 1,
			s: 1,
			kept: false,
			belowMin: false,
			metrics: { lr: 1, tb: 1, stab: 1 },
			ranked: [],
			trees: 0
		};
	}
	const B = contentBox(o);
	const base = items.map((it) => aloneSize(it.aspect, o));
	const ignoreMin = !!opts.ignoreMin;

	// The old layout, for stability (Add: every chart but the new one; a turn: all, transposed).
	let old: (Rect | null)[] | null = null;
	let oldBox = B;
	if (mode === 'add') old = items.map((it, i) => (i < n - 1 ? (it.frame ?? null) : null));
	if (mode === 'turn') {
		old = items.map((it) => it.frame ?? null);
		oldBox = contentBox(opts.from ?? (o === 'portrait' ? 'landscape' : 'portrait'));
	}
	if (old && old.every((f) => !f)) old = null;
	const ref = stabilityRef(old, oldBox, mode === 'turn');

	// Orders and trees.
	let seqs: number[][];
	let extra: LayoutTree[] = [];
	if (mode === 'add') {
		if (n <= ARRANGE.insertN) seqs = insertOrders(n);
		else {
			// 7–8 charts: Atkins insertion into the page's own tree; the page order alone when
			// the old frames have no guillotine structure.
			const prior = old?.slice(0, n - 1);
			const oldTree =
				prior && prior.every((f): f is Rect => f !== null) ? treeFromFrames(prior) : null;
			if (oldTree !== null) {
				seqs = [];
				extra = insertions(oldTree, n - 1);
			} else seqs = [identityOrder(n)];
		}
	} else if (n <= ARRANGE.permN) seqs = distinctOrders(items);
	else if (n === ARRANGE.permN + 1) {
		const g = groupedOrder(items);
		seqs = inversions(g) === 0 ? [identityOrder(n)] : [identityOrder(n), g];
	} else seqs = [identityOrder(n)];
	const orderFactor = (inv: number) =>
		inv === 0 ? 1 : mode === 'add' ? ARRANGE.orderAdd : ARRANGE.orderScratch;

	const trees: TreeCandidate[] = [];
	const enumerate = treeEnumerator(base);
	for (const seq of seqs) {
		const inv = inversions(seq);
		for (const c of enumerate(seq)) {
			trees.push({ seq, tree: c.tree, s: envelopeScale(c.W, c.H, B), inv, ub: 0 });
		}
	}
	for (const tree of extra) {
		const e = envelopeOf(tree, base);
		const seq = leavesOf(tree);
		trees.push({ seq, tree, s: envelopeScale(e.W, e.H, B), inv: inversions(seq), ub: 0 });
	}
	for (const c of trees) c.ub = c.s * orderFactor(c.inv);
	trees.sort((a, b) => b.ub - a.ub || a.inv - b.inv);

	const minSideOK = (t: readonly number[]) =>
		ignoreMin || t.every((v, i) => Math.min(base[i].w, base[i].h) * v >= MIN_CHART_SIDE_MM - 1e-6);
	const evaluate = (
		c: Omit<TreeCandidate, 'ub'>,
		sizing: LayoutSizing,
		t: number[]
	): LayoutCandidate => {
		const frames = layoutFrames(c.tree, t, base, B);
		const rag = raggedPairs(c.tree, frames);
		const s = Math.min(...t);
		const P = s * (rag.near ? ARRANGE.ragged : 1) * orderFactor(c.inv);
		return { frames, seq: c.seq, tree: c.tree, sizing, t, s, P, rag, inv: c.inv };
	};
	const sizingsOf = (c: Omit<TreeCandidate, 'ub'>): [LayoutSizing, number[]][] => {
		const out: [LayoutSizing, number[]][] = [['uniform', new Array<number>(n).fill(c.s)]];
		const bl = blockedScales(c.tree, base, B, n);
		if (bl && !out[0][1].every((v, i) => Math.abs(v - bl[i]) < 1e-9)) {
			// Identical charts always share one size: a blocked sizing that breaks that is dropped.
			const sizes = new Map<string, number>();
			let same = true;
			items.forEach((it, i) => {
				const k = typeKey(it);
				const prev = sizes.get(k);
				if (prev !== undefined && Math.abs(prev - bl[i]) * base[i].w > 0.05) same = false;
				sizes.set(k, bl[i]);
			});
			if (same) out.push(['blocked', bl]);
		}
		return out;
	};

	// Walk the trees by their upper bound; stop once nothing can reach the band. A tree whose
	// uniform sizing breaks the 40 mm rule can still pass blocked (a panorama across the page
	// over two discs); otherwise it is only a fallback.
	const sMin = Math.max(...base.map((b) => MIN_CHART_SIDE_MM / Math.min(b.w, b.h)));
	let Pbest = 0;
	const cands: LayoutCandidate[] = [];
	const fallback: TreeCandidate[] = [];
	for (const c of trees) {
		if (c.ub < (1 - ARRANGE.band) * Pbest - 1e-12) break;
		const uniformOK = ignoreMin || c.s >= sMin - 1e-9;
		if (!uniformOK && fallback.length < 64) fallback.push(c);
		for (const [sizing, t] of sizingsOf(c)) {
			if (sizing === 'uniform' && !uniformOK) continue;
			if (!minSideOK(t)) continue;
			const cand = evaluate(c, sizing, t);
			cands.push(cand);
			if (cand.P > Pbest) Pbest = cand.P;
		}
	}
	let belowMin = false;
	if (!cands.length) {
		// Nothing keeps every side at 40 mm (a crowded turn): the best layouts without the rule.
		belowMin = true;
		for (const c of fallback) {
			const cand = evaluate(c, 'uniform', new Array<number>(n).fill(c.s));
			cands.push(cand);
			if (cand.P > Pbest) Pbest = cand.P;
		}
	}
	const finish = (ranked: LayoutCandidate[], best: LayoutCandidate): ArrangeResult => ({
		frames: best.frames,
		seq: best.seq,
		tree: best.tree,
		sizing: best.sizing,
		P: best.P,
		s: best.s,
		kept: !!best.kept,
		belowMin,
		metrics: best.metrics ?? {
			lr: symmetry(best.frames, items, B, 'lr'),
			tb: symmetry(best.frames, items, B, 'tb'),
			stab: stability(best.frames, ref, B)
		},
		ranked,
		trees: trees.length
	});

	// The preferred layout (a turn) is kept outright when it is close enough to the best.
	if (opts.prefer && opts.prefer.tree !== null && opts.prefer.tree !== undefined) {
		const tree = opts.prefer.tree;
		const sizing = opts.prefer.sizing;
		const e = envelopeOf(tree, base);
		const seq = leavesOf(tree);
		const c = { seq, tree, s: envelopeScale(e.W, e.H, B), inv: inversions(seq) };
		const options = sizingsOf(c)
			.filter(([, t]) => minSideOK(t))
			.map(([sz, t]) => evaluate(c, sz, t));
		const same =
			options.find((x) => sizing && x.sizing === sizing) ?? options.sort((a, b) => b.P - a.P)[0];
		if (same && same.P >= ARRANGE.turnKeep * Pbest) {
			const kept = { ...same, kept: true };
			return finish([kept], kept);
		}
	}

	// The band: identical-looking layouts deduplicated, identical charts handed out, ranked on looks.
	const band: LayoutCandidate[] = [];
	const seen = new Map<string, number>();
	for (const c of cands) {
		if (c.P < (1 - ARRANGE.band) * Pbest - 1e-12) continue;
		const key = c.frames
			.map((f, i) => `${typeKey(items[i])}:${f.x.toFixed(1)},${f.y.toFixed(1)},${f.w.toFixed(1)}`)
			.sort()
			.join('|');
		const prev = seen.get(key);
		if (prev !== undefined) {
			const b = band[prev];
			if (c.P > b.P + EPS || (Math.abs(c.P - b.P) <= EPS && c.inv < b.inv)) band[prev] = c;
			continue;
		}
		seen.set(key, band.length);
		band.push(c);
	}
	const W = ARRANGE.weights;
	let covMax = 0;
	for (const c of band) {
		const slotFrames = c.seq.map((i) => c.frames[i]);
		const seq = assignSlots(c.seq, c.frames, items, ref, B);
		const frames: Rect[] = [];
		seq.forEach((item, k) => (frames[item] = slotFrames[k]));
		const tree = mapLeaves(c.tree, (i) => seq[c.seq.indexOf(i)]);
		Object.assign(c, { frames, seq, tree });
		c.cov = frames.reduce((a, f, i) => a + chartArea(f, items[i].kind), 0) / (B.w * B.h);
		covMax = Math.max(covMax, c.cov);
	}
	const pairs = (n * (n - 1)) / 2 || 1;
	for (const c of band) {
		const m: LayoutMetrics = {
			lr: symmetry(c.frames, items, B, 'lr'),
			tb: symmetry(c.frames, items, B, 'tb'),
			stab: stability(c.frames, ref, B),
			order: 1 - inversions(c.seq) / pairs,
			tidy: c.rag.pairs ? 1 - c.rag.near / c.rag.pairs : 1,
			cov: (c.cov ?? 0) / covMax,
			bal: balance(c.frames, items, B),
			size: c.P / Pbest
		};
		c.metrics = m;
		c.T = (Object.keys(W) as (keyof LayoutMetrics)[]).reduce((a, k) => a + W[k] * m[k], 0);
	}
	band.sort(
		(a, b) =>
			(b.T ?? 0) - (a.T ?? 0) ||
			b.P - a.P ||
			inversions(a.seq) - inversions(b.seq) ||
			(treeString(a.tree) < treeString(b.tree) ? -1 : 1)
	);
	return finish(band, band[0]);
}

// === Plans ===

/** A chart in a page's new layout: its index among the page's charts (`-1`: the chart Add brings). */
export interface PlacedChart {
	index: number;
	frame: Rect;
}

function arrangeItems(page: DocPage): ArrangeItem[] {
	return chartsOf(page).map((it) => ({
		kind: chartKind(it.chart),
		aspect: it.chart.aspect,
		frame: it.frame
	}));
}

/** A result in reading order, with the layout's leaves renumbered to match. */
function placed(res: Pick<ArrangeResult, 'frames' | 'seq' | 'tree' | 'sizing'>): {
	items: PlacedChart[];
	layout?: PageLayout;
} {
	const items = res.seq.map((index) => ({ index, frame: res.frames[index] }));
	if (res.tree === null) return { items };
	return {
		items,
		layout: { tree: mapLeaves(res.tree, (i) => res.seq.indexOf(i)), sizing: res.sizing }
	};
}

function copyLayout(layout: PageLayout): PageLayout {
	return { tree: mapLeaves(layout.tree, (i) => i), sizing: layout.sizing };
}

function sameRect(a: Rect, b: Rect): boolean {
	return (
		Math.abs(a.x - b.x) <= 1e-6 &&
		Math.abs(a.y - b.y) <= 1e-6 &&
		Math.abs(a.w - b.w) <= 1e-6 &&
		Math.abs(a.h - b.h) <= 1e-6
	);
}

/** A page laid out from scratch (a future "Re-arrange page"). */
export function arrangePage(page: DocPage): {
	items: PlacedChart[];
	layout?: PageLayout;
	belowMin: boolean;
} {
	if (!chartsOf(page).length) return { items: [], belowMin: false };
	const res = arrange(page.orientation, arrangeItems(page), { mode: 'scratch' });
	return { ...placed(res), belowMin: res.belowMin };
}

// === Hand-arranged pages ===

function intersects(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
	);
}

function contains(outer: Rect, r: Rect): boolean {
	return (
		r.x >= outer.x - EPS &&
		r.y >= outer.y - EPS &&
		r.x + r.w <= outer.x + outer.w + EPS &&
		r.y + r.h <= outer.y + outer.h + EPS
	);
}

/** The maximal free rectangles of `box` around the obstacles grown by the gutter (MaxRects). */
export function freeRects(box: Rect, obstacles: readonly Rect[]): Rect[] {
	let free: Rect[] = [{ ...box }];
	for (const ob of obstacles) {
		const o = {
			x: ob.x - GUTTER_MM,
			y: ob.y - GUTTER_MM,
			w: ob.w + 2 * GUTTER_MM,
			h: ob.h + 2 * GUTTER_MM
		};
		const next: Rect[] = [];
		for (const f of free) {
			if (!intersects(f, o)) {
				next.push(f);
				continue;
			}
			if (o.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: o.x - f.x, h: f.h });
			if (o.x + o.w < f.x + f.w - EPS) {
				next.push({ x: o.x + o.w, y: f.y, w: f.x + f.w - o.x - o.w, h: f.h });
			}
			if (o.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: o.y - f.y });
			if (o.y + o.h < f.y + f.h - EPS) {
				next.push({ x: f.x, y: o.y + o.h, w: f.w, h: f.y + f.h - o.y - o.h });
			}
		}
		free = next.filter(
			(r, i) => !next.some((q, j) => j !== i && contains(q, r) && (!contains(r, q) || j < i))
		);
	}
	return free;
}

/**
 * The largest frame of `aspect` in a page's free space, centred in its free rectangle, one
 * gutter clear of every chart and text; null when it would be under the smallest side.
 */
export function freeSpot(
	page: Pick<DocPage, 'orientation' | 'blocks'>,
	aspect: number
): Rect | null {
	const box = contentBox(page.orientation);
	const obstacles = page.blocks.map(blockBounds);
	let best: Rect | null = null;
	for (const f of freeRects(box, obstacles)) {
		const w = Math.min(f.w, f.h * aspect);
		if (!best || w > best.w + EPS) {
			best = { x: f.x + (f.w - w) / 2, y: f.y + (f.h - w / aspect) / 2, w, h: w / aspect };
		}
	}
	return best && !underMinSide(best) ? best : null;
}

// === Add to PDF ===

/** Where Add to PDF puts a chart (`planAdd`). */
export interface AddPlan {
	/** The page it goes on; null for a page of its own after the last. */
	pageIndex: number | null;
	/** That page's orientation: a new page is landscape for a wide pinhole, else portrait. */
	orientation: PageOrientation;
	/** The page's charts in their new reading order, the new one among them. */
	items: PlacedChart[];
	/** The arranger's layout of the page; none on a hand-arranged page. */
	layout?: PageLayout;
	manual: boolean;
	/** Whether charts already on the page moved or changed size. */
	relaid: boolean;
	/**
	 * min(the new chart's share of what the alternative page gives it, the worst share an old
	 * chart keeps); null for a chart alone on its page.
	 */
	q: number | null;
}

interface Trial extends Omit<AddPlan, 'pageIndex' | 'orientation' | 'q'> {
	q: number;
	pass: boolean;
}

/** A necessary condition for the gate: the floor sizes must fit in the content area. */
function areaFeasible(page: DocPage, chart: ArrangeChart, tau: number, altSide: number): boolean {
	const B = contentBox(page.orientation);
	const newW = tau * altSide;
	if (newW > aloneSize(chart.aspect, page.orientation).w + 1e-6) return false;
	let A = newW * (newW / chart.aspect);
	for (const it of chartsOf(page)) A += tau * it.frame.w * tau * it.frame.h;
	return A <= B.w * B.h + 1e-6;
}

/** The chart on one occupied page: the first layout in the band that passes the gate, else the best. */
function tryPage(page: DocPage, chart: ArrangeChart, tau: number, altSide: number): Trial | null {
	const charts = chartsOf(page);
	const old: PlacedChart[] = charts.map((it, index) => ({ index, frame: it.frame }));
	if (page.manual || typesetOf(page).length) {
		// Nothing moves on a hand-arranged page, as one with text is: the chart takes the
		// free spot, if any.
		const frame = freeSpot(page, chart.aspect);
		if (!frame) return null;
		const q = Math.min(1, frame.w / altSide);
		return {
			q,
			pass: q >= tau - 1e-9,
			items: [...old, { index: -1, frame }],
			manual: true,
			relaid: false
		};
	}
	const items: ArrangeItem[] = [...arrangeItems(page), { kind: chart.kind, aspect: chart.aspect }];
	const res = arrange(page.orientation, items, { mode: 'add' });
	const n = items.length;
	let best: { q: number; pass: boolean; c: LayoutCandidate } | null = null;
	for (const c of res.ranked) {
		if (c.frames.some(underMinSide)) continue;
		const qNew = Math.min(1, c.frames[n - 1].w / altSide);
		const keep = Math.min(1, ...charts.map((it, i) => c.frames[i].w / it.frame.w));
		const q = Math.min(qNew, keep);
		const cand = { q, pass: q >= tau - 1e-9, c };
		if (cand.pass) {
			best = cand;
			break;
		}
		if (!best || q > best.q) best = cand;
	}
	if (!best) return null;
	const { c } = best;
	const laid = placed(c);
	return {
		q: best.q,
		pass: best.pass,
		items: laid.items.map((p) => (p.index === n - 1 ? { index: -1, frame: p.frame } : p)),
		layout: laid.layout,
		manual: false,
		relaid: charts.some((it, i) => !sameRect(it.frame, c.frames[i]))
	};
}

/**
 * Where Add to PDF puts `chart`, and how that page is laid out again. Only that page changes.
 *
 * A disc takes the first empty page (one with text on it is not empty). Otherwise each occupied page (the latest first) is tried
 * against the alternative, the first empty page or else a new one: the chart joins when
 * q ≥ 0.90 while an empty page waits, q ≥ 0.70 when the alternative is a new page. The page
 * with the highest q wins, ties (within 0.02) to the latest. A hand-arranged page is never
 * laid out again: the chart takes its free spot. A page Add opens is landscape for a pinhole
 * wider than tall, portrait otherwise. `now` is the clock for the scan's time budget.
 */
export function planAdd(
	pages: readonly DocPage[],
	chart: ArrangeChart,
	now: () => number = () => performance.now()
): AddPlan {
	const t0 = now();
	const alone = (pageIndex: number | null, orientation: PageOrientation): AddPlan => ({
		pageIndex,
		orientation,
		items: [{ index: -1, frame: aloneFrame(chart.aspect, orientation) }],
		manual: false,
		relaid: false,
		q: null
	});
	const empty = pages.findIndex(isBlank);
	if (chart.kind === 'stereo' && empty >= 0) return alone(empty, pages[empty].orientation);

	// What the chart gets elsewhere: alone on the first empty page, else on a portrait page,
	// even though a page Add opens for a wide pinhole is landscape. Measured against that
	// larger frame, a pinhole wider than 1.43:1 could join no portrait page at all (186/273 is
	// under the 0.70 gate), and the page choices would no longer be the approved ones.
	const altSide = aloneSize(chart.aspect, empty >= 0 ? pages[empty].orientation : 'portrait').w;
	const tau = empty >= 0 ? ARRANGE.strict : ARRANGE.fill;
	const pass: (Trial & { k: number })[] = [];
	for (let k = pages.length - 1; k >= 0; k--) {
		const p = pages[k];
		if (isBlank(p)) continue;
		if (now() - t0 > ARRANGE.budgetMs) break;
		if (chartsOf(p).length >= ARRANGE.maxAuto) continue;
		if (!areaFeasible(p, chart, tau, altSide)) continue;
		const r = tryPage(p, chart, tau, altSide);
		if (!r) continue;
		if (r.pass) pass.push({ ...r, k });
		// The latest page that loses (almost) nothing: no earlier page can win the tie.
		if (r.pass && r.q >= 1 - ARRANGE.tie) break;
	}
	if (pass.length) {
		const qMax = Math.max(...pass.map((r) => r.q));
		const win = pass.filter((r) => r.q >= qMax - ARRANGE.tie).sort((a, b) => b.k - a.k)[0];
		return {
			pageIndex: win.k,
			orientation: pages[win.k].orientation,
			items: win.items,
			layout: win.layout,
			manual: win.manual,
			relaid: win.relaid,
			q: win.q
		};
	}
	if (empty >= 0) return alone(empty, pages[empty].orientation);
	return alone(null, chart.aspect > 1 + 1e-9 ? 'landscape' : 'portrait');
}

// === Turning a page ===

export type TurnHow = 'unchanged' | 'empty' | 'restored' | 'transposed' | 're-laid' | 'fallback';

/** A page after a turn (`turnLayout`). */
export interface TurnPlan {
	/** The page's charts in their new reading order. */
	items: PlacedChart[];
	layout?: PageLayout;
	manual: boolean;
	turnMemo?: TurnMemo;
	/**
	 * `restored`: turned back to the layout from before the turn; `transposed`: the old layout
	 * with rows made columns; `re-laid`: the best layout for the new orientation; `fallback`:
	 * more charts than the arranger lays out, turned by `rotateLayout`.
	 */
	how: TurnHow;
	/** A chart is under the smallest side: nothing fitted the page with all of them at 40 mm. */
	belowMin: boolean;
}

/**
 * `page` turned to `o`. Only its own charts are laid out again; nothing leaves the page.
 * Turning back with the same charts restores the layout from before the turn exactly (the
 * memo); otherwise the old layout, transposed, is kept when within 5 % of the best. A turn
 * clears `manual`.
 */
export function turnLayout(page: DocPage, o: PageOrientation): TurnPlan {
	const charts = chartsOf(page);
	const n = charts.length;
	const manual = !!page.manual;
	const below = (items: PlacedChart[]) => items.some(({ frame }) => underMinSide(frame));
	if (page.orientation === o) {
		const items = charts.map((it, index) => ({ index, frame: it.frame }));
		const { layout, turnMemo } = page;
		return { items, layout, manual, turnMemo, how: 'unchanged', belowMin: below(items) };
	}
	if (n === 0) return { items: [], manual, how: 'empty', belowMin: false };

	const ids = charts.map((it) => it.id);
	const memo: TurnMemo = {
		orientation: page.orientation,
		ids,
		frames: charts.map((it) => ({ ...it.frame })),
		manual
	};
	if (page.layout) memo.layout = copyLayout(page.layout);
	const m = page.turnMemo;
	if (m && m.orientation === o && m.ids.length === n && m.ids.every((id) => ids.includes(id))) {
		const items = m.ids.map((id, i) => ({ index: ids.indexOf(id), frame: { ...m.frames[i] } }));
		return {
			items,
			layout: m.layout,
			manual: m.manual,
			turnMemo: memo,
			how: 'restored',
			belowMin: below(items)
		};
	}
	if (n > ARRANGE.maxAuto) {
		const frames = rotateLayout(
			charts.map((it) => ({ frame: it.frame, aspect: it.chart.aspect })),
			page.orientation,
			o
		);
		const items = frames.map((frame, index) => ({ index, frame }));
		return { items, manual, turnMemo: memo, how: 'fallback', belowMin: below(items) };
	}
	const tree = page.layout?.tree ?? treeFromFrames(charts.map((it) => it.frame));
	const prefer =
		tree === null ? null : { tree: transposeTree(tree), sizing: page.layout?.sizing ?? null };
	const res = arrange(o, arrangeItems(page), { mode: 'turn', from: page.orientation, prefer });
	const laid = placed(res);
	// From the frames, as on the other paths: a kept layout keeps 40 mm, whatever the search found.
	return {
		...laid,
		manual: false,
		turnMemo: memo,
		how: res.kept ? 'transposed' : 're-laid',
		belowMin: below(laid.items)
	};
}
