import { VISIBILITY_CULL_THRESHOLD } from '../constants';
import { galacticToEquatorial, J2000_OBLIQUITY_RAD } from '../math/astronomy';
import { clamp } from '../math/easing';
import { sampleStarMorphFrame } from '../math/projection';
import type { UnitVec3 } from '../math/astronomy';
import type { ProjectionFrameParams } from '../math/projection';
import type { ConstellationData, ConstellationSegmentPoint } from '../stores.svelte';

// Astronomical constants and frame conversions live in ../math/astronomy.ts — this module is
// drawing only. Re-exported here for existing consumers.
export { galacticToEquatorial };
export type { UnitVec3 };

const SAMPLE_STEP_DEG = 1;
const SAMPLE_COUNT = 360 / SAMPLE_STEP_DEG + 1; // 361, closes the loop

const BOUNDARY_BISECT_ITERATIONS = 6;

export interface DashPattern {
	dashDeg: number;
	gapDeg: number;
}

export interface ReferenceLineStyle {
	strokeStyle: string;
	lineWidth: number;
	alpha: number;
	dashPattern?: DashPattern;
}

export const REFERENCE_LINE_STYLES: {
	equator: ReferenceLineStyle;
	ecliptic: ReferenceLineStyle;
	galacticEquator: ReferenceLineStyle;
} = {
	equator: {
		strokeStyle: '#000000',
		lineWidth: 1,
		alpha: 1
	},
	ecliptic: {
		strokeStyle: '#dc2626',
		lineWidth: 1,
		alpha: 0.95
	},
	galacticEquator: {
		strokeStyle: '#b58cff',
		lineWidth: 1,
		alpha: 0.9
	}
};

export function sampleEquator(): UnitVec3[] {
	const out: UnitVec3[] = new Array(SAMPLE_COUNT);
	for (let i = 0; i < SAMPLE_COUNT; i += 1) {
		const ra = (i * SAMPLE_STEP_DEG * Math.PI) / 180;
		out[i] = { x: Math.cos(ra), y: Math.sin(ra), z: 0 };
	}
	return out;
}

export function sampleEcliptic(): UnitVec3[] {
	const cosEps = Math.cos(J2000_OBLIQUITY_RAD);
	const sinEps = Math.sin(J2000_OBLIQUITY_RAD);
	const out: UnitVec3[] = new Array(SAMPLE_COUNT);
	for (let i = 0; i < SAMPLE_COUNT; i += 1) {
		const lambda = (i * SAMPLE_STEP_DEG * Math.PI) / 180;
		const cosL = Math.cos(lambda);
		const sinL = Math.sin(lambda);
		out[i] = { x: cosL, y: sinL * cosEps, z: sinL * sinEps };
	}
	return out;
}

export function sampleGalacticEquator(): UnitVec3[] {
	const out: UnitVec3[] = new Array(SAMPLE_COUNT);
	for (let i = 0; i < SAMPLE_COUNT; i += 1) {
		const l = (i * SAMPLE_STEP_DEG * Math.PI) / 180;
		out[i] = galacticToEquatorial(Math.cos(l), Math.sin(l));
	}
	return out;
}

type Rotator = (x: number, y: number, z: number) => readonly [number, number, number];

interface ProjectedSample {
	x: number;
	y: number;
	visible: boolean;
}

function projectVec(
	v: UnitVec3,
	visualBlend: number,
	params: ProjectionFrameParams,
	rotateVector: Rotator
): ProjectedSample {
	const s = sampleStarMorphFrame(
		{ x: v.x, y: v.y, z: v.z, v_mag: 0 },
		visualBlend,
		params,
		rotateVector
	);
	return { x: s.px, y: s.py, visible: s.visibility > VISIBILITY_CULL_THRESHOLD };
}

// Find a point on the great-circle arc between `inside` (visible) and `outside` (not visible)
// where visibility crosses the cull threshold. Returns the projected pixel coordinates of the
// last-known-visible point near that crossing. Bisection converges to ~SAMPLE_STEP_DEG / 2^N
// degrees of arc; with N=6 that's well under 0.02° — sub-pixel for any sensible viewport.
function findVisibilityBoundary(
	inside: UnitVec3,
	outside: UnitVec3,
	insideProj: ProjectedSample,
	visualBlend: number,
	params: ProjectionFrameParams,
	rotateVector: Rotator
): { x: number; y: number; t: number } {
	let lo = 0;
	let hi = 1;
	let lastVisibleX = insideProj.x;
	let lastVisibleY = insideProj.y;
	for (let i = 0; i < BOUNDARY_BISECT_ITERATIONS; i += 1) {
		const mid = (lo + hi) * 0.5;
		let mx = inside.x + (outside.x - inside.x) * mid;
		let my = inside.y + (outside.y - inside.y) * mid;
		let mz = inside.z + (outside.z - inside.z) * mid;
		const len = Math.sqrt(mx * mx + my * my + mz * mz);
		if (len > 0) {
			mx /= len;
			my /= len;
			mz /= len;
		}
		const s = projectVec({ x: mx, y: my, z: mz }, visualBlend, params, rotateVector);
		if (s.visible) {
			lo = mid;
			lastVisibleX = s.x;
			lastVisibleY = s.y;
		} else {
			hi = mid;
		}
	}
	return { x: lastVisibleX, y: lastVisibleY, t: lo };
}

export interface DrawReferenceLineArgs {
	ctx: CanvasRenderingContext2D;
	cx: number;
	cy: number;
	samples: readonly UnitVec3[];
	style: ReferenceLineStyle;
	progress: number; // 0..1 — fraction of the great circle to draw, in source-angle order
	visualBlend: number;
	params: ProjectionFrameParams;
	rotateVector: Rotator;
}

interface PiecePoint {
	srcDeg: number;
	x: number;
	y: number;
}

function buildVisiblePieces(
	samples: readonly UnitVec3[],
	projected: readonly ProjectedSample[],
	visualBlend: number,
	params: ProjectionFrameParams,
	rotateVector: Rotator
): PiecePoint[][] {
	const pieces: PiecePoint[][] = [];
	let cur: PiecePoint[] | null = null;
	for (let i = 0; i < samples.length; i += 1) {
		const proj = projected[i];
		const srcDeg = i * SAMPLE_STEP_DEG;
		if (proj.visible) {
			if (cur === null) {
				cur = [];
				// Insert a boundary entry point if the previous sample was outside.
				if (i > 0 && !projected[i - 1].visible) {
					const boundary = findVisibilityBoundary(
						samples[i],
						samples[i - 1],
						proj,
						visualBlend,
						params,
						rotateVector
					);
					cur.push({
						srcDeg: srcDeg - boundary.t * SAMPLE_STEP_DEG,
						x: boundary.x,
						y: boundary.y
					});
				}
			}
			cur.push({ srcDeg, x: proj.x, y: proj.y });
		} else if (cur !== null) {
			// Close the run with a boundary exit point.
			if (i > 0 && projected[i - 1].visible) {
				const boundary = findVisibilityBoundary(
					samples[i - 1],
					samples[i],
					projected[i - 1],
					visualBlend,
					params,
					rotateVector
				);
				cur.push({
					srcDeg: (i - 1) * SAMPLE_STEP_DEG + boundary.t * SAMPLE_STEP_DEG,
					x: boundary.x,
					y: boundary.y
				});
			}
			if (cur.length >= 2) pieces.push(cur);
			cur = null;
		}
	}
	if (cur !== null && cur.length >= 2) pieces.push(cur);

	// If the great circle wraps around the seam (samples[0] == samples[N-1]) and both are
	// visible, the first and last pieces are halves of one continuous arc — merge them so the
	// animation walks it as a single chord.
	if (pieces.length >= 2 && projected[0].visible && projected[samples.length - 1].visible) {
		const first = pieces.shift()!;
		const last = pieces.pop()!;
		const merged: PiecePoint[] = [...last];
		for (let i = 1; i < first.length; i += 1) {
			merged.push({
				srcDeg: first[i].srcDeg + 360,
				x: first[i].x,
				y: first[i].y
			});
		}
		pieces.unshift(merged);
	}

	return pieces;
}

function drawPieceWithProgress(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	piece: PiecePoint[],
	progress: number,
	dash: DashPattern | undefined
): void {
	if (piece.length < 2) return;
	let totalLen = 0;
	const cum = [0];
	for (let i = 1; i < piece.length; i += 1) {
		totalLen += Math.hypot(piece[i].x - piece[i - 1].x, piece[i].y - piece[i - 1].y);
		cum.push(totalLen);
	}
	if (totalLen <= 0) return;
	const target = progress * totalLen;

	if (!dash) {
		// One continuous stroke for the visible piece up to the progress target. Doing this as
		// a single Path2D avoids 300+ per-segment strokes joining via overlapping round caps,
		// which can read as a faint stipple at thin line widths.
		ctx.beginPath();
		ctx.moveTo(cx + piece[0].x, cy + piece[0].y);
		for (let i = 0; i < piece.length - 1; i += 1) {
			if (cum[i] >= target) break;
			const a = piece[i];
			const b = piece[i + 1];
			const segLen = cum[i + 1] - cum[i];
			if (segLen <= 0) continue;
			if (cum[i + 1] <= target) {
				ctx.lineTo(cx + b.x, cy + b.y);
			} else {
				const segFrac = (target - cum[i]) / segLen;
				const drawX = a.x + (b.x - a.x) * segFrac;
				const drawY = a.y + (b.y - a.y) * segFrac;
				ctx.lineTo(cx + drawX, cy + drawY);
				break;
			}
		}
		ctx.stroke();
		return;
	}

	for (let i = 0; i < piece.length - 1; i += 1) {
		if (cum[i] >= target) break;
		const a = piece[i];
		const b = piece[i + 1];
		const segLen = cum[i + 1] - cum[i];
		if (segLen <= 0) continue;
		let segFrac = 1;
		if (cum[i + 1] > target) {
			segFrac = (target - cum[i]) / segLen;
		}
		const drawSrcR = a.srcDeg + (b.srcDeg - a.srcDeg) * segFrac;
		const drawX = a.x + (b.x - a.x) * segFrac;
		const drawY = a.y + (b.y - a.y) * segFrac;
		drawArcSlice(ctx, cx, cy, a.srcDeg, drawSrcR, a.x, a.y, drawX, drawY, dash);
	}
}

export function drawReferenceLine(args: DrawReferenceLineArgs): void {
	const { ctx, cx, cy, samples, style, params, rotateVector, visualBlend } = args;
	const progress = clamp(args.progress, 0, 1);
	if (progress <= 0) return;

	const projected: ProjectedSample[] = new Array(samples.length);
	for (let i = 0; i < samples.length; i += 1) {
		projected[i] = projectVec(samples[i], visualBlend, params, rotateVector);
	}

	const pieces = buildVisiblePieces(samples, projected, visualBlend, params, rotateVector);
	if (pieces.length === 0) return;

	const dash = style.dashPattern;

	ctx.save();
	ctx.strokeStyle = style.strokeStyle;
	ctx.lineWidth = style.lineWidth;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.globalAlpha = style.alpha;
	// We draw dashes as discrete sub-paths anchored to source-degree coordinates, so the dash
	// pattern stays static along the great circle while the projection morphs. Do NOT use
	// ctx.setLineDash here.
	ctx.setLineDash([]);

	for (const piece of pieces) {
		drawPieceWithProgress(ctx, cx, cy, piece, progress, dash);
	}

	ctx.restore();
}

function drawArcSlice(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	srcL: number,
	srcR: number,
	xyLX: number,
	xyLY: number,
	xyRX: number,
	xyRY: number,
	dash: DashPattern | undefined
): void {
	if (srcL >= srcR) return;
	if (!dash) {
		ctx.beginPath();
		ctx.moveTo(cx + xyLX, cy + xyLY);
		ctx.lineTo(cx + xyRX, cy + xyRY);
		ctx.stroke();
		return;
	}
	const period = dash.dashDeg + dash.gapDeg;
	// Find the first dash-on cycle whose end is after srcL.
	let cycleStart = Math.floor(srcL / period) * period;
	const span = srcR - srcL;
	while (cycleStart < srcR) {
		const onStart = cycleStart;
		const onEnd = cycleStart + dash.dashDeg;
		const overlapStart = Math.max(onStart, srcL);
		const overlapEnd = Math.min(onEnd, srcR);
		if (overlapStart < overlapEnd) {
			const tStart = (overlapStart - srcL) / span;
			const tEnd = (overlapEnd - srcL) / span;
			const sx = xyLX + (xyRX - xyLX) * tStart;
			const sy = xyLY + (xyRY - xyLY) * tStart;
			const ex = xyLX + (xyRX - xyLX) * tEnd;
			const ey = xyLY + (xyRY - xyLY) * tEnd;
			ctx.beginPath();
			ctx.moveTo(cx + sx, cy + sy);
			ctx.lineTo(cx + ex, cy + ey);
			ctx.stroke();
		}
		cycleStart += period;
	}
}

export const CONSTELLATION_LINE_STYLE: ReferenceLineStyle = {
	strokeStyle: '#000000',
	lineWidth: 0.6,
	alpha: 0.35
};

export const CONSTELLATION_BOUNDARY_STYLE: ReferenceLineStyle = {
	strokeStyle: '#000000',
	lineWidth: 0.4,
	alpha: 0.15
};

const GREAT_CIRCLE_SUBDIV_DEG = 3;

function subdivideGreatCircle(
	segment: readonly ConstellationSegmentPoint[]
): ConstellationSegmentPoint[] {
	if (segment.length < 2) return segment as ConstellationSegmentPoint[];
	const result: ConstellationSegmentPoint[] = [segment[0]];
	for (let i = 0; i < segment.length - 1; i += 1) {
		const a = segment[i];
		const b = segment[i + 1];
		const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
		const angle = Math.acos(dot);
		const steps = Math.max(1, Math.ceil((angle * 180) / Math.PI / GREAT_CIRCLE_SUBDIV_DEG));
		if (steps <= 1) {
			result.push(b);
			continue;
		}
		const sinAngle = Math.sin(angle);
		for (let s = 1; s <= steps; s += 1) {
			const t = s / steps;
			const wa = Math.sin((1 - t) * angle) / sinAngle;
			const wb = Math.sin(t * angle) / sinAngle;
			result.push({
				x: wa * a.x + wb * b.x,
				y: wa * a.y + wb * b.y,
				z: wa * a.z + wb * b.z
			});
		}
	}
	return result;
}

export function drawConstellationLines(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	constellations: readonly ConstellationData[],
	progress: number,
	visualBlend: number,
	params: ProjectionFrameParams,
	rotateVector: Rotator,
	style: ReferenceLineStyle = CONSTELLATION_LINE_STYLE
): void {
	if (progress <= 0 || constellations.length === 0) return;

	ctx.save();
	ctx.strokeStyle = style.strokeStyle;
	ctx.lineWidth = style.lineWidth;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.globalAlpha = style.alpha * progress;
	ctx.setLineDash([]);

	for (const constellation of constellations) {
		for (const segment of constellation.segments) {
			if (segment.length < 2) continue;

			const pts = subdivideGreatCircle(segment);
			const projected: ProjectedSample[] = new Array(pts.length);
			for (let i = 0; i < pts.length; i += 1) {
				projected[i] = projectVec(pts[i], visualBlend, params, rotateVector);
			}

			let inRun = false;
			for (let i = 0; i < pts.length - 1; i += 1) {
				const aVis = projected[i].visible;
				const bVis = projected[i + 1].visible;

				if (!aVis && !bVis) {
					if (inRun) {
						ctx.stroke();
						inRun = false;
					}
					continue;
				}

				if (aVis && bVis) {
					if (!inRun) {
						ctx.beginPath();
						ctx.moveTo(cx + projected[i].x, cy + projected[i].y);
						inRun = true;
					}
					ctx.lineTo(cx + projected[i + 1].x, cy + projected[i + 1].y);
					continue;
				}

				if (aVis && !bVis) {
					const b = findVisibilityBoundary(
						pts[i],
						pts[i + 1],
						projected[i],
						visualBlend,
						params,
						rotateVector
					);
					if (!inRun) {
						ctx.beginPath();
						ctx.moveTo(cx + projected[i].x, cy + projected[i].y);
					}
					// This segment leaves the visible area, so the run always ends here.
					ctx.lineTo(cx + b.x, cy + b.y);
					ctx.stroke();
					inRun = false;
					continue;
				}

				// !aVis && bVis
				const b = findVisibilityBoundary(
					pts[i + 1],
					pts[i],
					projected[i + 1],
					visualBlend,
					params,
					rotateVector
				);
				if (inRun) ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(cx + b.x, cy + b.y);
				ctx.lineTo(cx + projected[i + 1].x, cy + projected[i + 1].y);
				inRun = true;
			}
			if (inRun) ctx.stroke();
		}
	}

	ctx.restore();
}
