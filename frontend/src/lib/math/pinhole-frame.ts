/**
 * Pinhole frame overlay geometry.
 *
 * Pure functions of the view state: where the frame sits on the chart surface,
 * where its handles and hit areas go, and how a drag or a key press maps back
 * to (fov, aspect, heightFrac). Lengths are CSS px of the square chart surface
 * (side S), origin at its top-left corner, y down; sizes in "frac" are the units
 * of `view.pinholeHeightFrac` (1 frac = S · CHART_RADIUS_FRAC px on both axes).
 */

import {
	CHART_CANVAS_BACKING_PX,
	CHART_RADIUS_FRAC,
	EPSILON,
	MAX_FOV_DEG_PINHOLE,
	MIN_FOV_DEG_PINHOLE,
	PINHOLE_ASPECT_RATIO_MAX,
	PINHOLE_ASPECT_RATIO_MIN,
	PINHOLE_BRACKET_ARM_MIN_SIDE_PX,
	PINHOLE_BRACKET_ARM_PX,
	PINHOLE_CLIP_MARGIN_PX,
	PINHOLE_CORNER_RADIUS,
	PINHOLE_EDGE_PILL_LENGTH_PX,
	PINHOLE_EDGE_PILL_MIN_SIDE_PX,
	PINHOLE_HANDLE_GAP_PX,
	PINHOLE_HANDLE_STROKE_PX,
	PINHOLE_HEIGHT_FRAC_MAX,
	PINHOLE_HEIGHT_FRAC_MIN,
	PINHOLE_KEY_STEP_DEG,
	PINHOLE_KEY_STEP_SHIFT_DEG,
	PINHOLE_READOUT_GAP_PX,
	PINHOLE_READOUT_HEIGHT_PX
} from '../constants';
import { clamp } from './easing';
import { resizePinholeWidthKeepStars } from './projection';

export type EdgeHandle = 'n' | 'e' | 's' | 'w';
export type CornerHandle = 'nw' | 'ne' | 'se' | 'sw';
export type FrameHandle = EdgeHandle | CornerHandle;
type Sign = -1 | 0 | 1;

export const EDGE_HANDLES: readonly EdgeHandle[] = ['n', 'e', 's', 'w'];
export const CORNER_HANDLES: readonly CornerHandle[] = ['nw', 'ne', 'se', 'sw'];

/** Outward direction of each handle on screen; 0 on an axis the handle leaves alone. */
export const HANDLE_DIRECTION: Readonly<Record<FrameHandle, { x: Sign; y: Sign }>> = {
	n: { x: 0, y: -1 },
	e: { x: 1, y: 0 },
	s: { x: 0, y: 1 },
	w: { x: -1, y: 0 },
	nw: { x: -1, y: -1 },
	ne: { x: 1, y: -1 },
	se: { x: 1, y: 1 },
	sw: { x: -1, y: 1 }
};

export const HANDLE_CURSOR: Readonly<Record<FrameHandle, string>> = {
	n: 'ns-resize',
	s: 'ns-resize',
	e: 'ew-resize',
	w: 'ew-resize',
	nw: 'nwse-resize',
	se: 'nwse-resize',
	ne: 'nesw-resize',
	sw: 'nesw-resize'
};

const MIRROR: Readonly<Record<FrameHandle, FrameHandle>> = {
	n: 's',
	s: 'n',
	e: 'w',
	w: 'e',
	nw: 'se',
	se: 'nw',
	ne: 'sw',
	sw: 'ne'
};

/** The handle on the opposite side; it moves too, because resizing is symmetric. */
export function mirrorHandle(handle: FrameHandle): FrameHandle {
	return MIRROR[handle];
}

function isEdgeHandle(handle: FrameHandle): handle is EdgeHandle {
	return handle.length === 1;
}

/** The three view fields that define the pinhole frame (`fovDeg` is horizontal). */
export interface PinholeShape {
	fovDeg: number;
	aspectRatio: number;
	heightFrac: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface FrameRect extends Rect {
	/** Corner radius of the frame as the renderer draws it, in CSS px. */
	cornerRadius: number;
}

function tanHalfDeg(deg: number): number {
	return Math.tan((deg * Math.PI) / 360);
}

function degFromTanHalf(tanHalf: number): number {
	return (2 * Math.atan(tanHalf) * 180) / Math.PI;
}

/** CSS px per frac on a surface of `surfacePx`, the same on both axes. */
export function pxPerFrac(surfacePx: number): number {
	return surfacePx * CHART_RADIUS_FRAC;
}

/**
 * The frame as the canvas renderer draws it, centred on the surface. The corner
 * radius follows the renderer's rounded rect: PINHOLE_CORNER_RADIUS canvas px,
 * clamped to half the shorter side, then scaled from the backing store to CSS px.
 */
export function pinholeFrameRect(
	surfacePx: number,
	aspectRatio: number,
	heightFrac: number
): FrameRect {
	const height = pxPerFrac(surfacePx) * heightFrac;
	const width = height * aspectRatio;
	const cornerRadius = Math.min(
		(PINHOLE_CORNER_RADIUS * surfacePx) / CHART_CANVAS_BACKING_PX,
		Math.min(width, height) / 2
	);
	return {
		x: (surfacePx - width) / 2,
		y: (surfacePx - height) / 2,
		width,
		height,
		cornerRadius
	};
}

/**
 * SVG path of a corner bracket concentric with the frame's rounded corner.
 *
 * (x, y) is the frame's corner, sx/sy ∈ {−1, 1} point out of the frame. The
 * stroke runs `gap` outside the outline with radius R = r + gap, so its arc
 * centre (ox − sx·R, oy − sy·R) = (x − sx·r, y − sy·r) is the frame arc centre.
 * `armX` is the straight part along the horizontal side, `armY` along the
 * vertical one.
 */
export function bracketPath(
	x: number,
	y: number,
	sx: 1 | -1,
	sy: 1 | -1,
	r: number,
	gap: number,
	armX: number,
	armY: number
): string {
	const R = r + gap;
	const ox = x + sx * gap;
	const oy = y + sy * gap;
	const sweep = sx * sy > 0 ? 1 : 0;
	return (
		`M ${ox} ${oy - sy * (R + armY)} L ${ox} ${oy - sy * R} ` +
		`A ${R} ${R} 0 0 ${sweep} ${ox - sx * R} ${oy} L ${ox - sx * (R + armX)} ${oy}`
	);
}

/**
 * Bracket arm along a side of `side` px. Short sides drop the arm entirely, and
 * otherwise the arm is shortened so the two brackets of a side never meet.
 */
function bracketArm(side: number, r: number): number {
	if (side < PINHOLE_BRACKET_ARM_MIN_SIDE_PX) return 0;
	return clamp(side / 2 - r - PINHOLE_HANDLE_STROKE_PX, 0, PINHOLE_BRACKET_ARM_PX);
}

export interface HitSizes {
	/** Edge hit thickness. */
	edge: number;
	/** Part of the edge hit thickness that lies inside the frame. */
	edgeInset: number;
	/** Corner hit square side. */
	corner: number;
}

export interface HandleLayout {
	brackets: Record<CornerHandle, string>;
	/** `null` when the side is too short to carry a pill. */
	pills: Record<EdgeHandle, Rect | null>;
	hits: Record<FrameHandle, Rect>;
}

/** Visuals (brackets, pills) and hit areas for a frame, in surface px. */
export function pinholeHandleLayout(frame: FrameRect, hit: HitSizes): HandleLayout {
	const g = PINHOLE_HANDLE_GAP_PX;
	const r = frame.cornerRadius;
	const left = frame.x;
	const top = frame.y;
	const right = frame.x + frame.width;
	const bottom = frame.y + frame.height;
	const cx = frame.x + frame.width / 2;
	const cy = frame.y + frame.height / 2;
	const armX = bracketArm(frame.width, r);
	const armY = bracketArm(frame.height, r);

	const len = PINHOLE_EDGE_PILL_LENGTH_PX;
	const t = PINHOLE_HANDLE_STROKE_PX;
	// n/s pills lie along the frame width, e/w pills along its height.
	const pillsX = frame.width >= PINHOLE_EDGE_PILL_MIN_SIDE_PX;
	const pillsY = frame.height >= PINHOLE_EDGE_PILL_MIN_SIDE_PX;

	const out = hit.edge - hit.edgeInset;
	const straightX = Math.max(0, frame.width - 2 * r);
	const straightY = Math.max(0, frame.height - 2 * r);

	return {
		brackets: {
			nw: bracketPath(left, top, -1, -1, r, g, armX, armY),
			ne: bracketPath(right, top, 1, -1, r, g, armX, armY),
			se: bracketPath(right, bottom, 1, 1, r, g, armX, armY),
			sw: bracketPath(left, bottom, -1, 1, r, g, armX, armY)
		},
		pills: {
			n: pillsX ? { x: cx - len / 2, y: top - g - t / 2, width: len, height: t } : null,
			s: pillsX ? { x: cx - len / 2, y: bottom + g - t / 2, width: len, height: t } : null,
			e: pillsY ? { x: right + g - t / 2, y: cy - len / 2, width: t, height: len } : null,
			w: pillsY ? { x: left - g - t / 2, y: cy - len / 2, width: t, height: len } : null
		},
		hits: {
			n: { x: left + r, y: top - out, width: straightX, height: hit.edge },
			s: { x: left + r, y: bottom - hit.edgeInset, width: straightX, height: hit.edge },
			e: { x: right - hit.edgeInset, y: top + r, width: hit.edge, height: straightY },
			w: { x: left - out, y: top + r, width: hit.edge, height: straightY },
			nw: { x: left - out, y: top - out, width: hit.corner, height: hit.corner },
			ne: { x: right + out - hit.corner, y: top - out, width: hit.corner, height: hit.corner },
			se: {
				x: right + out - hit.corner,
				y: bottom + out - hit.corner,
				width: hit.corner,
				height: hit.corner
			},
			sw: { x: left - out, y: bottom + out - hit.corner, width: hit.corner, height: hit.corner }
		}
	};
}

export type HandleState = 'idle' | 'near' | 'hover' | 'active' | 'mirror' | 'dim';

export interface HandleStateInput {
	/** The dragged handle, else the keyboard-focused one. */
	lead: FrameHandle | null;
	hovered: FrameHandle | null;
	/** The pointer is over or near the frame. */
	near: boolean;
}

/**
 * Whether the visual of `handle` stands for `target` on screen. Every handle
 * stands for itself; an edge whose pill is hidden (a short side) is stood for
 * by the two corner brackets at its ends, so hovering, dragging or focusing it
 * still lights up that side.
 */
function standsFor(
	handle: FrameHandle,
	target: FrameHandle,
	pills: HandleLayout['pills']
): boolean {
	if (handle === target) return true;
	return (
		isEdgeHandle(target) &&
		pills[target] === null &&
		!isEdgeHandle(handle) &&
		handle.includes(target)
	);
}

/**
 * Styling state of a handle's visual. While a handle leads (drag or keyboard
 * focus) it is active, its mirror, which moves with it, is "mirror", and the
 * rest dim; otherwise the hovered handle is "hover" and the rest "near" or "idle".
 */
export function pinholeHandleState(
	handle: FrameHandle,
	input: HandleStateInput,
	pills: HandleLayout['pills']
): HandleState {
	const { lead, hovered, near } = input;
	if (lead) {
		if (standsFor(handle, lead, pills)) return 'active';
		return standsFor(handle, mirrorHandle(lead), pills) ? 'mirror' : 'dim';
	}
	if (hovered && standsFor(handle, hovered, pills)) return 'hover';
	return near ? 'near' : 'idle';
}

/** True when (px, py) lies inside `rect` grown by `margin` on every side. */
export function isNearRect(px: number, py: number, rect: Rect, margin: number): boolean {
	return (
		px >= rect.x - margin &&
		px <= rect.x + rect.width + margin &&
		py >= rect.y - margin &&
		py <= rect.y + rect.height + margin
	);
}

export interface PinholeLimits {
	minFovDeg: number;
	maxFovDeg: number;
	minAspectRatio: number;
	maxAspectRatio: number;
	minHeightFrac: number;
	maxHeightFrac: number;
	maxWidthFrac: number;
}

/**
 * Size limits for a resize that starts from `current`.
 *
 * Besides the fixed fov / aspect / height bounds and the surface itself, the
 * frame keeps PINHOLE_CLIP_MARGIN_PX clear of the edge of the clipping chart
 * area (`clipWidthPx` × `clipHeightPx`), so its handles and hit areas are not
 * cut off. That only bites where the surface fills the clip box (phones, narrow
 * windows). A frame that is already past the margin keeps its size as the bound
 * instead of shrinking the moment it is grabbed.
 */
export function pinholeLimits(
	surfacePx: number,
	clipWidthPx: number,
	clipHeightPx: number,
	current: PinholeShape
): PinholeLimits {
	const k = Math.max(pxPerFrac(surfacePx), EPSILON);
	const surfaceFrac = 1 / CHART_RADIUS_FRAC;
	const clipWidthFrac = (clipWidthPx - 2 * PINHOLE_CLIP_MARGIN_PX) / k;
	const clipHeightFrac = (clipHeightPx - 2 * PINHOLE_CLIP_MARGIN_PX) / k;
	return {
		minFovDeg: MIN_FOV_DEG_PINHOLE,
		maxFovDeg: MAX_FOV_DEG_PINHOLE,
		minAspectRatio: PINHOLE_ASPECT_RATIO_MIN,
		maxAspectRatio: PINHOLE_ASPECT_RATIO_MAX,
		minHeightFrac: PINHOLE_HEIGHT_FRAC_MIN,
		maxHeightFrac: Math.max(
			Math.min(PINHOLE_HEIGHT_FRAC_MAX, surfaceFrac, clipHeightFrac),
			current.heightFrac
		),
		maxWidthFrac: Math.max(
			Math.min(surfaceFrac, clipWidthFrac),
			current.aspectRatio * current.heightFrac
		)
	};
}

export interface PinholeResizeRequest {
	widthFrac: number;
	heightFrac: number;
	/** Axes the gesture may change; the other one keeps its start value. */
	x: boolean;
	y: boolean;
	/** Shift: both sides take `widthFrac` (= `heightFrac`) and the frame goes 1:1. */
	square: boolean;
}

/** `value` clamped to [lo, hi], or `fallback` when the range is empty. */
function clampOr(value: number, lo: number, hi: number, fallback: number): number {
	return lo <= hi ? clamp(value, lo, hi) : fallback;
}

/**
 * Turn a requested frame size into view state, starting from `start`.
 *
 * Stars stay put while the frame resizes, so the width moves tan(fov/2) with
 * it (`resizePinholeWidthKeepStars`) and the fov limits become width limits.
 * Every bound clamps the request instead of rejecting it, so a handle stops at
 * a limit while the pointer carries on, and comes back without a jump.
 */
export function resolvePinholeResize(
	start: PinholeShape,
	request: PinholeResizeRequest,
	limits: PinholeLimits
): PinholeShape {
	const startWidth = start.aspectRatio * start.heightFrac;
	const tanHalf = Math.max(tanHalfDeg(start.fovDeg), EPSILON);
	const fovLo = (startWidth * tanHalfDeg(limits.minFovDeg)) / tanHalf;
	const fovHi = Math.min(
		(startWidth * tanHalfDeg(limits.maxFovDeg)) / tanHalf,
		limits.maxWidthFrac
	);
	const {
		minAspectRatio: aMin,
		maxAspectRatio: aMax,
		minHeightFrac: hMin,
		maxHeightFrac: hMax
	} = limits;

	let width = startWidth;
	let height = start.heightFrac;
	const squareLo = Math.max(hMin, fovLo);
	const squareHi = Math.min(hMax, fovHi);
	if (request.square && squareLo <= squareHi) {
		width = height = clamp(request.widthFrac, squareLo, squareHi);
	} else if (request.x && request.y) {
		// Height first, within what some reachable width can pair with under the
		// aspect bounds; then the width within the aspect bounds of that height.
		height = clampOr(
			request.heightFrac,
			Math.max(hMin, fovLo / aMax),
			Math.min(hMax, fovHi / aMin),
			height
		);
		width = clampOr(
			request.widthFrac,
			Math.max(fovLo, aMin * height),
			Math.min(fovHi, aMax * height),
			width
		);
	} else if (request.x) {
		width = clampOr(
			request.widthFrac,
			Math.max(fovLo, aMin * height),
			Math.min(fovHi, aMax * height),
			width
		);
	} else if (request.y) {
		height = clampOr(
			request.heightFrac,
			Math.max(hMin, width / aMax),
			Math.min(hMax, width / aMin),
			height
		);
	}

	const resized = resizePinholeWidthKeepStars(
		start.fovDeg,
		start.aspectRatio,
		start.heightFrac,
		width,
		(fov) => clamp(fov, limits.minFovDeg, limits.maxFovDeg),
		(aspect) => aspect
	);
	const appliedWidth = resized.pinholeAspectRatio * start.heightFrac;
	return {
		fovDeg: resized.pinholeFovDeg,
		aspectRatio: appliedWidth / height,
		heightFrac: height
	};
}

/** Where a drag started, captured on pointerdown. Client px. */
export interface PinholeDragOrigin {
	handle: FrameHandle;
	/** Frame centre; resizing is symmetric around it. */
	centerX: number;
	centerY: number;
	/** How far outside its edge the pointer went down, so the edge does not jump under it. */
	grabX: number;
	grabY: number;
	startWidthPx: number;
	startHeightPx: number;
	pxPerFrac: number;
}

export function beginPinholeDrag(
	handle: FrameHandle,
	pointerX: number,
	pointerY: number,
	centerX: number,
	centerY: number,
	frame: Rect,
	pxPerFracValue: number
): PinholeDragOrigin {
	const dir = HANDLE_DIRECTION[handle];
	return {
		handle,
		centerX,
		centerY,
		grabX: dir.x ? dir.x * (pointerX - centerX) - frame.width / 2 : 0,
		grabY: dir.y ? dir.y * (pointerY - centerY) - frame.height / 2 : 0,
		startWidthPx: frame.width,
		startHeightPx: frame.height,
		pxPerFrac: pxPerFracValue
	};
}

/**
 * The frame size a pointer at (pointerX, pointerY) asks for. Both opposite
 * edges follow the dragged one, so the frame grows by twice the pointer travel.
 * With Shift the axis that moved further from the start wins and the frame
 * snaps to 1:1, as the Moveable-based handles did.
 */
export function pinholeDragRequest(
	origin: PinholeDragOrigin,
	pointerX: number,
	pointerY: number,
	shift: boolean
): PinholeResizeRequest {
	const dir = HANDLE_DIRECTION[origin.handle];
	const k = Math.max(origin.pxPerFrac, EPSILON);
	const widthPx = dir.x
		? Math.max(0, 2 * (dir.x * (pointerX - origin.centerX) - origin.grabX))
		: origin.startWidthPx;
	const heightPx = dir.y
		? Math.max(0, 2 * (dir.y * (pointerY - origin.centerY) - origin.grabY))
		: origin.startHeightPx;
	if (shift) {
		const side =
			Math.abs(widthPx - origin.startWidthPx) > Math.abs(heightPx - origin.startHeightPx)
				? widthPx
				: heightPx;
		return { widthFrac: side / k, heightFrac: side / k, x: true, y: true, square: true };
	}
	return {
		widthFrac: widthPx / k,
		heightFrac: heightPx / k,
		x: dir.x !== 0,
		y: dir.y !== 0,
		square: false
	};
}

/** Vertical field of view of a frame with horizontal fov `fovDeg`: 2·atan(tan(hFOV/2)/aspect). */
export function verticalFovDeg(fovDeg: number, aspectRatio: number): number {
	return degFromTanHalf(tanHalfDeg(fovDeg) / Math.max(aspectRatio, EPSILON));
}

/**
 * Fov step of an edge slider key, in degrees, or `null` for a key the slider
 * does not take. As on any slider (WAI-ARIA APG), → and ↑ raise the value and
 * ← and ↓ lower it on all four edges, whichever way the edge faces; Shift takes
 * the larger step, and Home / End jump to the bounds.
 */
export function pinholeKeyStep(key: string, shift: boolean): number | null {
	const size = shift ? PINHOLE_KEY_STEP_SHIFT_DEG : PINHOLE_KEY_STEP_DEG;
	switch (key) {
		case 'ArrowRight':
		case 'ArrowUp':
			return size;
		case 'ArrowLeft':
		case 'ArrowDown':
			return -size;
		case 'Home':
			return -Infinity;
		case 'End':
			return Infinity;
		default:
			return null;
	}
}

/**
 * The resize a keyboard step on an edge slider asks for. `axis` 'x' steps the
 * horizontal fov (width sliders), 'y' the vertical one (height sliders). `step`
 * is in degrees from the rounded current value; ±Infinity jumps to the bound.
 */
export function pinholeKeyRequest(
	shape: PinholeShape,
	axis: 'x' | 'y',
	step: number
): PinholeResizeRequest {
	const width = shape.aspectRatio * shape.heightFrac;
	let size = step > 0 ? Infinity : 0;
	if (Number.isFinite(step)) {
		const current = axisFovDeg(shape, axis);
		const target = clamp(Math.round(current) + step, 1, 179);
		// Stars stay put, so each side is proportional to tan(fov/2) along it.
		size = (width * tanHalfDeg(target)) / Math.max(tanHalfDeg(shape.fovDeg), EPSILON);
	}
	return axis === 'x'
		? { widthFrac: size, heightFrac: shape.heightFrac, x: true, y: false, square: false }
		: { widthFrac: width, heightFrac: size, x: false, y: true, square: false };
}

/** Horizontal fov for 'x', vertical fov for 'y'. */
export function axisFovDeg(shape: PinholeShape, axis: 'x' | 'y'): number {
	return axis === 'x' ? shape.fovDeg : verticalFovDeg(shape.fovDeg, shape.aspectRatio);
}

/** Smallest and largest frame an edge slider reaches from `shape`, the other side held still. */
function axisExtremes(
	shape: PinholeShape,
	axis: 'x' | 'y',
	limits: PinholeLimits
): readonly [PinholeShape, PinholeShape] {
	return [
		resolvePinholeResize(shape, pinholeKeyRequest(shape, axis, -Infinity), limits),
		resolvePinholeResize(shape, pinholeKeyRequest(shape, axis, Infinity), limits)
	];
}

export interface FovRange {
	min: number;
	max: number;
}

/** Fov range of an edge slider (horizontal for 'x', vertical for 'y'). */
export function pinholeFovRange(
	shape: PinholeShape,
	axis: 'x' | 'y',
	limits: PinholeLimits
): FovRange {
	const [lo, hi] = axisExtremes(shape, axis, limits);
	return { min: axisFovDeg(lo, axis), max: axisFovDeg(hi, axis) };
}

/** +1 on the upper bound, −1 on the lower one, 0 off both. */
export interface PinholeLimitState {
	/** Horizontal fov at its bound, or the frame width at the widest the surface allows. */
	x: Sign;
	/** Frame height at its bound. */
	y: Sign;
	/** Aspect ratio at its bound. */
	aspect: Sign;
}

/**
 * Which bounds `shape` sits on. Each bound is reported on the quantity it
 * limits, so an aspect bound that stops one side shows on the ratio and is not
 * mistaken for a fov bound of the other side.
 */
export function pinholeLimitState(shape: PinholeShape, limits: PinholeLimits): PinholeLimitState {
	const TOLERANCE = 1e-6;
	const atUpper = (value: number, hi: number) => value >= hi * (1 - TOLERANCE);
	const atLower = (value: number, lo: number) => value <= lo * (1 + TOLERANCE);
	const bound = (value: number, lo: number, hi: number): Sign =>
		atUpper(value, hi) ? 1 : atLower(value, lo) ? -1 : 0;
	const width = shape.aspectRatio * shape.heightFrac;
	const x: Sign =
		atUpper(shape.fovDeg, limits.maxFovDeg) || atUpper(width, limits.maxWidthFrac)
			? 1
			: atLower(shape.fovDeg, limits.minFovDeg)
				? -1
				: 0;
	return {
		x,
		y: bound(shape.heightFrac, limits.minHeightFrac, limits.maxHeightFrac),
		aspect: bound(shape.aspectRatio, limits.minAspectRatio, limits.maxAspectRatio)
	};
}

/**
 * Named aspect ratios for the readout, landscape then portrait. The extremes are
 * the aspect bounds themselves, 7:2 and 2:5, so a frame on a bound names it exactly.
 */
const ASPECT_NAMES: readonly (readonly [number, number])[] = [
	[1, 1],
	[5, 4],
	[4, 3],
	[3, 2],
	[16, 10],
	[16, 9],
	[2, 1],
	[21, 9],
	[3, 1],
	[7, 2],
	[4, 5],
	[3, 4],
	[2, 3],
	[9, 16],
	[1, 2],
	[2, 5]
];

/** The named ratio closest to `aspectRatio` (compared on a log scale, so 2:1 and 1:2 weigh the same). */
export function nearestAspectName(aspectRatio: number): string {
	const target = Math.log(Math.max(aspectRatio, EPSILON));
	let best = ASPECT_NAMES[0];
	let bestDistance = Infinity;
	for (const name of ASPECT_NAMES) {
		const distance = Math.abs(Math.log(name[0] / name[1]) - target);
		if (distance < bestDistance) {
			best = name;
			bestDistance = distance;
		}
	}
	return `${best[0]}:${best[1]}`;
}

export interface PinholeReadout {
	/** "72° × 44°", with "max" / "min" after a side whose fov or size sits on its bound. */
	size: string;
	/** "16:9", "7:2 max" on an aspect bound, or "1:1" while Shift snaps the frame square. */
	ratio: string;
}

export function formatPinholeReadout(
	shape: PinholeShape,
	limit: PinholeLimitState,
	square: boolean
): PinholeReadout {
	const suffix = (sign: Sign) => (sign > 0 ? ' max' : sign < 0 ? ' min' : '');
	const h = `${Math.round(shape.fovDeg)}°${suffix(limit.x)}`;
	const v = `${Math.round(verticalFovDeg(shape.fovDeg, shape.aspectRatio))}°${suffix(limit.y)}`;
	const ratio = square ? '1:1' : `${nearestAspectName(shape.aspectRatio)}${suffix(limit.aspect)}`;
	return { size: `${h} × ${v}`, ratio };
}

export interface ReadoutPlacement {
	/** Top of the pill, surface px. */
	top: number;
	/** The pill sits inside the frame, over its bottom edge. */
	inside: boolean;
	/** Widest the pill may get inside the frame without crossing its sides; `null` outside. */
	maxWidth: number | null;
}

/**
 * Where the readout pill goes: PINHOLE_READOUT_GAP_PX under the frame, or, when
 * the clip box has no room below, the same gap inside the frame's bottom edge
 * (the visible one, should the frame run past the clip box), kept the same gap
 * clear of its sides. The frame and the surface are both centred in the clip box.
 */
export function readoutPlacement(
	frame: Rect,
	surfacePx: number,
	clipHeightPx: number
): ReadoutPlacement {
	const gap = PINHOLE_READOUT_GAP_PX;
	const bottom = frame.y + frame.height;
	const clipBottom = (surfacePx + clipHeightPx) / 2;
	if (clipBottom - bottom >= gap + PINHOLE_READOUT_HEIGHT_PX) {
		return { top: bottom + gap, inside: false, maxWidth: null };
	}
	return {
		top: Math.min(bottom, clipBottom) - gap - PINHOLE_READOUT_HEIGHT_PX,
		inside: true,
		maxWidth: Math.max(0, frame.width - 2 * gap)
	};
}
