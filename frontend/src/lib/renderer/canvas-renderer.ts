import {
	EPSILON,
	PERCEPTUAL_AREA_WEIGHT,
	PERCEPTUAL_BLEND_MIX,
	PERCEPTUAL_LUT_POINTS,
	PERCEPTUAL_SAMPLE_TARGET,
	PERCEPTUAL_VISIBILITY_WEIGHT,
	PINHOLE_CORNER_RADIUS,
	VIEWPORT_STROKE_WIDTH_PINHOLE,
	VIEWPORT_STROKE_WIDTH_STEREO,
	VISIBILITY_CULL_THRESHOLD
} from '../constants';
import { clamp, easeInOutCubic, lerp } from '../math/easing';
import { getProjectionFrameParams, sampleStarMorphFrame } from '../math/projection';
import { rotateVectorByQuaternion } from '../math/quaternion';
import {
	CONSTELLATION_BOUNDARY_STYLE,
	CONSTELLATION_LINE_STYLE,
	drawConstellationLines,
	drawReferenceLine,
	REFERENCE_LINE_STYLES,
	sampleEcliptic,
	sampleEquator,
	sampleGalacticEquator,
	type ReferenceLineStyle,
	type UnitVec3
} from './reference-lines';

import type { Quaternion } from '../math/quaternion';
import type { ConstellationData } from '../stores.svelte';
import type {
	MorphInterpolator,
	MorphInterpolatorFactory,
	PerceptualBlendInput,
	PerceptualCacheKey,
	ProjectionAnimationState,
	ProjectionBlendTick,
	ReferenceLinesState,
	RenderState,
	ViewportCacheKey
} from './types';

const LINE_ANIM_DURATION_MS = 720;

interface LineAnimState {
	target: boolean;
	progress: number;
	animating: boolean;
	startedAt: number;
	fromProgress: number;
}

function makeLineAnim(): LineAnimState {
	return {
		target: false,
		progress: 0,
		animating: false,
		startedAt: 0,
		fromProgress: 0
	};
}

function updateLineAnim(anim: LineAnimState, target: boolean, nowMs: number): void {
	if (anim.target !== target) {
		anim.target = target;
		anim.fromProgress = anim.progress;
		anim.startedAt = nowMs;
		anim.animating = true;
	}
	if (!anim.animating) return;
	const elapsed = nowMs - anim.startedAt;
	const t = clamp(elapsed / LINE_ANIM_DURATION_MS, 0, 1);
	const eased = easeInOutCubic(t);
	const targetProgress = target ? 1 : 0;
	anim.progress = lerp(anim.fromProgress, targetProgress, eased);
	if (t >= 1) {
		anim.progress = targetProgress;
		anim.animating = false;
	}
}

type ReferenceLineKey = keyof ReferenceLinesState;

/**
 * A single toggleable reference-line layer. Everything the renderer needs to know about a layer
 * — its animation slot, its style, and how to draw it — is declared once here, so adding a layer
 * means adding one entry to REFERENCE_LINE_LAYERS instead of editing four call sites.
 */
type ReferenceLineLayer =
	| {
			key: ReferenceLineKey;
			kind: 'greatCircle';
			/** Pre-sampled unit vectors along the great circle (361 points, 1° steps). */
			samples: readonly UnitVec3[];
			style: ReferenceLineStyle;
	  }
	| {
			key: ReferenceLineKey;
			kind: 'constellationSet';
			pickData: (state: RenderState) => readonly ConstellationData[];
			style: ReferenceLineStyle;
	  };

/**
 * Draw order is significant and matches the pre-refactor hand-written order: equator, then
 * ecliptic, then galactic equator, then constellation boundaries, then constellation lines on
 * top. Changing the order changes rendered output (see the Playwright visual baselines).
 */
const REFERENCE_LINE_LAYERS = [
	{
		key: 'equator',
		kind: 'greatCircle',
		samples: sampleEquator(),
		style: REFERENCE_LINE_STYLES.equator
	},
	{
		key: 'ecliptic',
		kind: 'greatCircle',
		samples: sampleEcliptic(),
		style: REFERENCE_LINE_STYLES.ecliptic
	},
	{
		key: 'galacticEquator',
		kind: 'greatCircle',
		samples: sampleGalacticEquator(),
		style: REFERENCE_LINE_STYLES.galacticEquator
	},
	{
		key: 'constellationBoundaries',
		kind: 'constellationSet',
		pickData: (state) => state.constellationBoundaries,
		style: CONSTELLATION_BOUNDARY_STYLE
	},
	{
		key: 'constellations',
		kind: 'constellationSet',
		pickData: (state) => state.constellations,
		style: CONSTELLATION_LINE_STYLE
	}
] satisfies readonly ReferenceLineLayer[];

// Compile-time guard: every key of ReferenceLinesState must have a layer above. Adding a key to
// the state type without adding a descriptor makes this alias fail to satisfy its constraint.
type AssertNever<T extends never> = T;
type _AllReferenceLinesCovered = AssertNever<
	Exclude<ReferenceLineKey, (typeof REFERENCE_LINE_LAYERS)[number]['key']>
>;

const FLUBBER_MAX_SEGMENT_LENGTH = 5;

export function perceptualKeyEquals(a: PerceptualCacheKey, b: PerceptualCacheKey): boolean {
	return (
		a.width === b.width &&
		a.height === b.height &&
		a.stereoFovDeg === b.stereoFovDeg &&
		a.pinholeFovDeg === b.pinholeFovDeg &&
		a.pinholeAspectRatio === b.pinholeAspectRatio &&
		a.pinholeHeightFrac === b.pinholeHeightFrac &&
		a.starVectorsLen === b.starVectorsLen &&
		a.orientation.x === b.orientation.x &&
		a.orientation.y === b.orientation.y &&
		a.orientation.z === b.orientation.z &&
		a.orientation.w === b.orientation.w
	);
}

export function viewportKeyEquals(a: ViewportCacheKey, b: ViewportCacheKey): boolean {
	return (
		a.cx === b.cx &&
		a.cy === b.cy &&
		a.radius === b.radius &&
		a.pinholeViewportWidth === b.pinholeViewportWidth &&
		a.pinholeViewportHeight === b.pinholeViewportHeight &&
		a.cornerRadius === b.cornerRadius
	);
}

export function getProjectionBlend(
	nowMs: number,
	animation: ProjectionAnimationState,
	currentBlend = animation.to
): ProjectionBlendTick {
	if (!animation.animating) {
		return { blend: currentBlend, animating: false };
	}

	const t = clamp((nowMs - animation.startMs) / animation.durationMs, 0, 1);
	const eased = easeInOutCubic(t);
	const blend = lerp(animation.from, animation.to, eased);

	if (t >= 1) {
		return { blend: animation.to, animating: false };
	}

	return { blend, animating: true };
}

export function getPerceptualBlendCumulative({
	width,
	height,
	stereoFovDeg,
	pinholeFovDeg,
	pinholeAspectRatio,
	pinholeHeightFrac,
	starVectors,
	orientation
}: PerceptualBlendInput): number[] {
	const cumulative = new Array<number>(PERCEPTUAL_LUT_POINTS).fill(0);
	if (starVectors.length < 2) {
		for (let i = 1; i < PERCEPTUAL_LUT_POINTS; i += 1) {
			cumulative[i] = i / (PERCEPTUAL_LUT_POINTS - 1);
		}
		return cumulative;
	}

	const step = Math.max(1, Math.ceil(starVectors.length / PERCEPTUAL_SAMPLE_TARGET));
	const sampledIndices: number[] = [];
	for (let i = 0; i < starVectors.length; i += step) {
		sampledIndices.push(i);
	}

	const rotateVector = (x: number, y: number, z: number) => {
		const [rx, ry, rz] = rotateVectorByQuaternion(x, y, z, orientation);
		return [-rx, ry, rz] as const;
	};

	const prevPx = new Array<number>(sampledIndices.length).fill(0);
	const prevPy = new Array<number>(sampledIndices.length).fill(0);
	const prevVisibility = new Array<number>(sampledIndices.length).fill(0);
	let prevArea = 0;

	for (let i = 0; i < PERCEPTUAL_LUT_POINTS; i += 1) {
		const blend = i / (PERCEPTUAL_LUT_POINTS - 1);
		const params = getProjectionFrameParams(
			width,
			height,
			blend,
			stereoFovDeg,
			pinholeFovDeg,
			pinholeAspectRatio,
			pinholeHeightFrac
		);
		const area = params.morphViewportWidth * params.morphViewportHeight;

		if (i === 0) {
			for (let sampleIndex = 0; sampleIndex < sampledIndices.length; sampleIndex += 1) {
				const sample = sampleStarMorphFrame(
					starVectors[sampledIndices[sampleIndex]],
					blend,
					params,
					rotateVector
				);
				prevPx[sampleIndex] = sample.px;
				prevPy[sampleIndex] = sample.py;
				prevVisibility[sampleIndex] = sample.visibility;
			}
			prevArea = area;
			continue;
		}

		let motionSum = 0;
		let motionWeight = 0;
		let visibilityChangeSum = 0;
		for (let sampleIndex = 0; sampleIndex < sampledIndices.length; sampleIndex += 1) {
			const sample = sampleStarMorphFrame(
				starVectors[sampledIndices[sampleIndex]],
				blend,
				params,
				rotateVector
			);
			const visibilityWeight = Math.min(prevVisibility[sampleIndex], sample.visibility);
			if (visibilityWeight > VISIBILITY_CULL_THRESHOLD) {
				const dx = sample.px - prevPx[sampleIndex];
				const dy = sample.py - prevPy[sampleIndex];
				motionSum += Math.hypot(dx, dy) * visibilityWeight;
				motionWeight += visibilityWeight;
			}
			visibilityChangeSum += Math.abs(sample.visibility - prevVisibility[sampleIndex]);
			prevPx[sampleIndex] = sample.px;
			prevPy[sampleIndex] = sample.py;
			prevVisibility[sampleIndex] = sample.visibility;
		}

		const avgMotion = motionWeight > EPSILON ? motionSum / motionWeight : 0;
		const avgVisibilityChange = visibilityChangeSum / sampledIndices.length;
		const areaChange = Math.abs(area - prevArea);
		const frameEnergy =
			avgMotion +
			PERCEPTUAL_VISIBILITY_WEIGHT * avgVisibilityChange +
			PERCEPTUAL_AREA_WEIGHT * areaChange;

		cumulative[i] = cumulative[i - 1] + Math.max(frameEnergy, EPSILON);
		prevArea = area;
	}

	const total = cumulative[cumulative.length - 1];
	if (total > EPSILON) {
		for (let i = 0; i < cumulative.length; i += 1) {
			cumulative[i] /= total;
		}
	} else {
		for (let i = 1; i < cumulative.length; i += 1) {
			cumulative[i] = i / (cumulative.length - 1);
		}
	}

	return cumulative;
}

export function getPerceptualProjectionBlend(
	rawBlend: number,
	cumulative: readonly number[]
): number {
	const normalizedRawBlend = clamp(rawBlend, 0, 1);
	if (normalizedRawBlend <= 0) return 0;
	if (normalizedRawBlend >= 1) return 1;

	let perceptual = 1;
	for (let i = 1; i < cumulative.length; i += 1) {
		if (cumulative[i] < normalizedRawBlend) continue;
		const prev = cumulative[i - 1];
		const next = cumulative[i];
		const localT =
			Math.abs(next - prev) <= EPSILON ? 0 : (normalizedRawBlend - prev) / (next - prev);
		const prevBlend = (i - 1) / (cumulative.length - 1);
		const nextBlend = i / (cumulative.length - 1);
		perceptual = lerp(prevBlend, nextBlend, localT);
		break;
	}

	return lerp(normalizedRawBlend, perceptual, PERCEPTUAL_BLEND_MIX);
}

function buildCirclePath(cx: number, cy: number, radius: number) {
	const r = Math.max(radius, EPSILON);
	return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
}

function buildRoundedRectPath(
	left: number,
	top: number,
	width: number,
	height: number,
	radius: number
) {
	const right = left + width;
	const bottom = top + height;
	const r = clamp(radius, 0, Math.min(width, height) * 0.5);
	return [
		`M ${left + r} ${top}`,
		`H ${right - r}`,
		`A ${r} ${r} 0 0 1 ${right} ${top + r}`,
		`V ${bottom - r}`,
		`A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
		`H ${left + r}`,
		`A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,
		`V ${top + r}`,
		`A ${r} ${r} 0 0 1 ${left + r} ${top}`,
		'Z'
	].join(' ');
}

export class CanvasRenderer {
	private cachedPerceptualKey: PerceptualCacheKey | null = null;
	private cachedPerceptualCumulative: number[] | null = null;
	private cachedViewportInterpolator: MorphInterpolator | null = null;
	private cachedViewportInterpolatorKey: ViewportCacheKey | null = null;
	private cachedMorphBlend = Number.NaN;
	private cachedMorphPath = '';
	private cachedMorphPath2D: Path2D | null = null;
	private flubberInterpolate: MorphInterpolatorFactory | null = null;
	// Offscreen layer with all stars pre-rendered. Lets resize loops blit instead of redrawing
	// 9K arcs/frame. Must be invalidated when orientation, fov, or anything else changes star
	// positions on canvas. NOT invalidated by aspect/height changes (stars are invariant).
	private starsLayer: HTMLCanvasElement | null = null;
	private starsLayerKey: string | null = null;

	private readonly lineAnims: Record<ReferenceLineKey, LineAnimState> = Object.fromEntries(
		REFERENCE_LINE_LAYERS.map((layer) => [layer.key, makeLineAnim()])
	) as Record<ReferenceLineKey, LineAnimState>;

	constructor(private readonly canvas: HTMLCanvasElement) {}

	hasActiveLineAnimations(): boolean {
		return REFERENCE_LINE_LAYERS.some((layer) => this.lineAnims[layer.key].animating);
	}

	invalidateStarsCache() {
		this.starsLayer = null;
		this.starsLayerKey = null;
	}

	setMorphInterpolatorFactory(factory: MorphInterpolatorFactory | null) {
		this.flubberInterpolate = factory;
		this.cachedViewportInterpolatorKey = null;
		this.cachedViewportInterpolator = null;
		this.resetMorphPathCache();
	}

	private resetMorphPathCache() {
		this.cachedMorphBlend = Number.NaN;
		this.cachedMorphPath = '';
		this.cachedMorphPath2D = null;
	}

	render(state: RenderState) {
		const ctx = this.canvas.getContext('2d');
		if (!ctx) return;

		const width = this.canvas.width;
		const height = this.canvas.height;
		const cx = width / 2;
		const cy = height / 2;
		const visualBlend = this.getPerceptualProjectionBlend(
			state.projectionBlend,
			state,
			width,
			height
		);
		const params = getProjectionFrameParams(
			width,
			height,
			visualBlend,
			state.stereoFovDeg,
			state.pinholeFovDeg,
			state.pinholeAspectRatio,
			state.pinholeHeightFrac
		);
		let morphViewportPath2D: Path2D;
		if (visualBlend >= 1) {
			morphViewportPath2D = new Path2D(
				buildRoundedRectPath(
					cx - params.pinholeViewportWidth * 0.5,
					cy - params.pinholeViewportHeight * 0.5,
					params.pinholeViewportWidth,
					params.pinholeViewportHeight,
					PINHOLE_CORNER_RADIUS
				)
			);
		} else if (visualBlend <= 0) {
			morphViewportPath2D = new Path2D(buildCirclePath(cx, cy, params.radius));
		} else {
			const viewportInterpolator = this.getViewportMorphInterpolator(
				cx,
				cy,
				params.radius,
				params.pinholeViewportWidth,
				params.pinholeViewportHeight,
				PINHOLE_CORNER_RADIUS
			);
			morphViewportPath2D = this.getMorphViewportPath2D(visualBlend, viewportInterpolator).path2D;
		}

		ctx.fillStyle = '#0a0a0b';
		ctx.fillRect(0, 0, width, height);

		ctx.fillStyle = '#ffffff';
		ctx.fill(morphViewportPath2D);
		ctx.strokeStyle = visualBlend > 0.5 ? '#d7dbe3' : '#ffffff';
		ctx.lineWidth = lerp(VIEWPORT_STROKE_WIDTH_STEREO, VIEWPORT_STROKE_WIDTH_PINHOLE, visualBlend);
		ctx.stroke(morphViewportPath2D);

		const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
		let hasLinesToDraw = false;
		for (const layer of REFERENCE_LINE_LAYERS) {
			const anim = this.lineAnims[layer.key];
			updateLineAnim(anim, state.referenceLines[layer.key], nowMs);
			if (anim.progress > 0) hasLinesToDraw = true;
		}

		if (!state.starVectors.length && !hasLinesToDraw) return;

		ctx.save();
		ctx.clip(morphViewportPath2D);

		if (hasLinesToDraw) {
			this.drawReferenceLines(ctx, state, params, visualBlend, cx, cy);
		}

		if (state.starVectors.length) {
			// Cache key for the stars layer: anything that moves stars on canvas must change this.
			// pinholeAspectRatio / pinholeHeightFrac are intentionally omitted (stars are invariant).
			const starsKey = this.computeStarsKey(state, width, height, visualBlend);
			if (this.starsLayerKey !== starsKey || !this.starsLayer) {
				this.starsLayer = this.buildStarsLayer(state, params, visualBlend, width, height);
				this.starsLayerKey = starsKey;
			}
			if (this.starsLayer) {
				ctx.drawImage(this.starsLayer, 0, 0);
			}
		}

		ctx.restore();
		ctx.globalAlpha = 1;
	}

	private drawReferenceLines(
		ctx: CanvasRenderingContext2D,
		state: RenderState,
		params: ReturnType<typeof getProjectionFrameParams>,
		visualBlend: number,
		cx: number,
		cy: number
	): void {
		const rotateVector = (x: number, y: number, z: number) =>
			this.rotateVector(x, y, z, state.orientation);

		for (const layer of REFERENCE_LINE_LAYERS) {
			const progress = this.lineAnims[layer.key].progress;
			if (progress <= 0) continue;

			if (layer.kind === 'greatCircle') {
				drawReferenceLine({
					ctx,
					cx,
					cy,
					samples: layer.samples,
					style: layer.style,
					progress,
					visualBlend,
					params,
					rotateVector
				});
				continue;
			}

			const data = layer.pickData(state);
			if (data.length === 0) continue;
			drawConstellationLines(
				ctx,
				cx,
				cy,
				data,
				progress,
				visualBlend,
				params,
				rotateVector,
				layer.style
			);
		}
	}

	private computeStarsKey(
		state: RenderState,
		width: number,
		height: number,
		visualBlend: number
	): string {
		const o = state.orientation;
		return [
			width,
			height,
			state.starVectors.length,
			state.stereoFovDeg,
			state.pinholeFovDeg,
			visualBlend,
			o.x,
			o.y,
			o.z,
			o.w
		].join('|');
	}

	private buildStarsLayer(
		state: RenderState,
		params: ReturnType<typeof getProjectionFrameParams>,
		visualBlend: number,
		width: number,
		height: number
	): HTMLCanvasElement {
		const layer = document.createElement('canvas');
		layer.width = width;
		layer.height = height;
		const ctx = layer.getContext('2d');
		if (!ctx) return layer;
		const cx = width / 2;
		const cy = height / 2;
		ctx.fillStyle = '#000000';
		for (const star of state.starVectors) {
			const sample = sampleStarMorphFrame(star, visualBlend, params, (x, y, z) =>
				this.rotateVector(x, y, z, state.orientation)
			);
			if (sample.visibility <= VISIBILITY_CULL_THRESHOLD) continue;
			const pointRadius = lerp(sample.stereoRadius, sample.pinholeRadius, visualBlend);
			const pointAlpha = lerp(sample.stereoAlpha, sample.pinholeAlpha, visualBlend);
			ctx.globalAlpha = pointAlpha * sample.visibility;
			ctx.beginPath();
			ctx.arc(cx + sample.px, cy + sample.py, pointRadius, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		return layer;
	}

	private rotateVector(
		x: number,
		y: number,
		z: number,
		orientation: Quaternion
	): [number, number, number] {
		const [rx, ry, rz] = rotateVectorByQuaternion(x, y, z, orientation);
		return [-rx, ry, rz];
	}

	private getPerceptualProjectionBlend(
		rawBlend: number,
		state: RenderState,
		width: number,
		height: number
	) {
		// Skip the expensive 72×~1600 sample LUT build when blend is pinned to either
		// endpoint - getPerceptualProjectionBlend(0|1, ...) returns 0|1 regardless of LUT.
		// This is the hot path during pinhole resize where blend stays at 1.
		if (rawBlend <= 0) return 0;
		if (rawBlend >= 1) return 1;
		const cumulative = this.getPerceptualBlendCumulative(state, width, height);
		return getPerceptualProjectionBlend(rawBlend, cumulative);
	}

	private getPerceptualBlendCumulative(state: RenderState, width: number, height: number) {
		const key: PerceptualCacheKey = {
			width,
			height,
			stereoFovDeg: state.stereoFovDeg,
			pinholeFovDeg: state.pinholeFovDeg,
			pinholeAspectRatio: state.pinholeAspectRatio,
			pinholeHeightFrac: state.pinholeHeightFrac,
			starVectorsLen: state.starVectors.length,
			orientation: {
				x: state.orientation.x,
				y: state.orientation.y,
				z: state.orientation.z,
				w: state.orientation.w
			}
		};

		if (
			this.cachedPerceptualKey &&
			this.cachedPerceptualCumulative &&
			perceptualKeyEquals(this.cachedPerceptualKey, key)
		) {
			return this.cachedPerceptualCumulative;
		}

		const cumulative = getPerceptualBlendCumulative({
			width,
			height,
			stereoFovDeg: state.stereoFovDeg,
			pinholeFovDeg: state.pinholeFovDeg,
			pinholeAspectRatio: state.pinholeAspectRatio,
			pinholeHeightFrac: state.pinholeHeightFrac,
			starVectors: state.starVectors,
			orientation: state.orientation
		});

		this.cachedPerceptualKey = key;
		this.cachedPerceptualCumulative = cumulative;
		return cumulative;
	}

	private getViewportMorphInterpolator(
		cx: number,
		cy: number,
		stereoRadius: number,
		pinholeWidth: number,
		pinholeHeight: number,
		pinholeRadius: number
	): MorphInterpolator {
		const key: ViewportCacheKey = {
			cx,
			cy,
			radius: stereoRadius,
			pinholeViewportWidth: pinholeWidth,
			pinholeViewportHeight: pinholeHeight,
			cornerRadius: pinholeRadius
		};

		if (
			this.cachedViewportInterpolatorKey &&
			this.cachedViewportInterpolator &&
			viewportKeyEquals(this.cachedViewportInterpolatorKey, key)
		) {
			return this.cachedViewportInterpolator;
		}

		const pinholeLeft = cx - pinholeWidth * 0.5;
		const pinholeTop = cy - pinholeHeight * 0.5;
		const circlePath = buildCirclePath(cx, cy, stereoRadius);
		const roundedRectPath = buildRoundedRectPath(
			pinholeLeft,
			pinholeTop,
			pinholeWidth,
			pinholeHeight,
			pinholeRadius
		);

		if (!this.flubberInterpolate) {
			this.cachedViewportInterpolatorKey = key;
			this.cachedViewportInterpolator = (t: number) => (t < 0.5 ? circlePath : roundedRectPath);
			this.resetMorphPathCache();
			return this.cachedViewportInterpolator;
		}

		this.cachedViewportInterpolator = this.flubberInterpolate(circlePath, roundedRectPath, {
			maxSegmentLength: FLUBBER_MAX_SEGMENT_LENGTH
		});
		this.cachedViewportInterpolatorKey = key;
		this.resetMorphPathCache();

		if (!this.cachedViewportInterpolator) {
			throw new Error('Viewport morph interpolator was not initialized');
		}

		return this.cachedViewportInterpolator;
	}

	private getMorphViewportPath2D(
		blend: number,
		interpolator: MorphInterpolator
	): { path: string; path2D: Path2D } {
		const normalizedBlend = clamp(blend, 0, 1);
		if (this.cachedMorphPath2D && Math.abs(normalizedBlend - this.cachedMorphBlend) <= EPSILON) {
			return { path: this.cachedMorphPath, path2D: this.cachedMorphPath2D };
		}

		const path = interpolator(normalizedBlend);
		const path2D = new Path2D(path);
		this.cachedMorphBlend = normalizedBlend;
		this.cachedMorphPath = path;
		this.cachedMorphPath2D = path2D;
		return { path, path2D };
	}
}
