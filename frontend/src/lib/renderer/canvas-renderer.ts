/**
 * The preview's renderer: each frame it draws the chart on its canvas from a
 * `RenderState`, the sky's outline (morphing between the stereographic disc and
 * the pinhole frame, along the perceptual curve of `projection-blend.ts`), the
 * reference lines that are on and the stars, fading in whatever is arriving
 * (`fades.ts`). It caches what is costly to rebuild between frames: the stars'
 * layer, the outline's morph and the perceptual curve.
 */

import {
	CHART_PAGE_COLOR,
	CHART_SKY_COLOR,
	EPSILON,
	PINHOLE_CORNER_RADIUS,
	STAR_COLOR,
	VIEWPORT_STROKE_WIDTH_PINHOLE,
	VIEWPORT_STROKE_WIDTH_STEREO,
	VISIBILITY_CULL_THRESHOLD
} from '../constants';
import { clamp, lerp } from '../math/easing';
import {
	getProjectionFrameParams,
	sampleStarMorphFrame,
	toViewSpace,
	type ProjectionFrameParams
} from '../math/projection';
import {
	advanceStarFade,
	makeLineAnim,
	makeStarFade,
	updateLineAnim,
	type LineAnimState
} from './fades';
import {
	getPerceptualBlendCumulative,
	getPerceptualProjectionBlend,
	perceptualKeyEquals
} from './projection-blend';
import {
	CONSTELLATION_BOUNDARY_STYLE,
	CONSTELLATION_LINE_STYLE,
	REFERENCE_LINE_STYLES,
	type ReferenceLineStyle
} from './line-styles';
import {
	drawConstellationLines,
	drawReferenceLine,
	sampleEcliptic,
	sampleEquator,
	sampleGalacticEquator,
	type UnitVec3
} from './reference-lines';

import type { Quaternion } from '../math/quaternion';
import type { ConstellationSegments } from '../api/wire/payload';
import { prefersReducedMotion } from '../ui/motion';
import type {
	MorphInterpolator,
	MorphInterpolatorFactory,
	PerceptualCacheKey,
	ReferenceLinesState,
	RenderState,
	ViewportCacheKey
} from './types';

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
			pickData: (state: RenderState) => readonly ConstellationSegments[];
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

function viewportKeyEquals(a: ViewportCacheKey, b: ViewportCacheKey): boolean {
	return (
		a.cx === b.cx &&
		a.cy === b.cy &&
		a.radius === b.radius &&
		a.pinholeViewportWidth === b.pinholeViewportWidth &&
		a.pinholeViewportHeight === b.pinholeViewportHeight &&
		a.cornerRadius === b.cornerRadius
	);
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
	private readonly starFade = makeStarFade();

	constructor(private readonly canvas: HTMLCanvasElement) {}

	hasActiveLineAnimations(): boolean {
		return REFERENCE_LINE_LAYERS.some((layer) => this.lineAnims[layer.key].animating);
	}

	/** Something the renderer animates by itself is still moving: the page keeps the frames coming. */
	hasActiveAnimations(): boolean {
		return this.hasActiveLineAnimations() || this.starFade.progress < 1;
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
		const morphViewportPath2D = this.viewportPath(visualBlend, params, cx, cy);

		ctx.fillStyle = CHART_PAGE_COLOR;
		ctx.fillRect(0, 0, width, height);

		ctx.fillStyle = CHART_SKY_COLOR;
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
		advanceStarFade(this.starFade, state.starVectors.length, nowMs, prefersReducedMotion());

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

	/** The viewport's outline at `visualBlend`: the disc, the frame, or the morph between them. */
	private viewportPath(
		visualBlend: number,
		params: ProjectionFrameParams,
		cx: number,
		cy: number
	): Path2D {
		if (visualBlend >= 1) {
			return new Path2D(
				buildRoundedRectPath(
					cx - params.pinholeViewportWidth * 0.5,
					cy - params.pinholeViewportHeight * 0.5,
					params.pinholeViewportWidth,
					params.pinholeViewportHeight,
					PINHOLE_CORNER_RADIUS
				)
			);
		}
		if (visualBlend <= 0) return new Path2D(buildCirclePath(cx, cy, params.radius));
		const viewportInterpolator = this.getViewportMorphInterpolator(
			cx,
			cy,
			params.radius,
			params.pinholeViewportWidth,
			params.pinholeViewportHeight,
			PINHOLE_CORNER_RADIUS
		);
		return this.getMorphViewportPath2D(visualBlend, viewportInterpolator).path2D;
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
			// A fade in progress redraws the layer each frame; at rest this is a constant.
			this.starFade.progress,
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
		ctx.fillStyle = STAR_COLOR;
		const { from: fadeFrom, progress: fadeProgress } = this.starFade;
		const stars = state.starVectors;
		for (let index = 0; index < stars.length; index += 1) {
			const sample = sampleStarMorphFrame(stars[index], visualBlend, params, (x, y, z) =>
				this.rotateVector(x, y, z, state.orientation)
			);
			if (sample.visibility <= VISIBILITY_CULL_THRESHOLD) continue;
			const pointRadius = lerp(sample.stereoRadius, sample.pinholeRadius, visualBlend);
			const pointAlpha = lerp(sample.stereoAlpha, sample.pinholeAlpha, visualBlend);
			const arriving = index >= fadeFrom ? fadeProgress : 1;
			ctx.globalAlpha = pointAlpha * sample.visibility * arriving;
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
		return toViewSpace(x, y, z, orientation);
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
