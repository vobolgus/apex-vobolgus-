/**
 * The chart stage: the preview's canvas, what draws on it and what moves the sky
 * on it. It holds the render loop, the input (a drag, the keys, the wheel, a pinch)
 * and the renderer, and gives the page what the page asks of the chart: the view it
 * shows, its canvas, a way to ask for a frame, the projection's switch and a view
 * taken whole.
 *
 * The page sends it the input it hears: the pointer anywhere on the page (a drag
 * that starts on the canvas may leave it), and the keys the page's own shortcuts
 * leave alone.
 */

import type { ChartView } from '$lib/api/render-config';
import { loadFlubberInterpolator } from '$lib/flubber';
import type { ProjectionMode } from '$lib/math/projection';
import { CanvasRenderer } from '$lib/renderer/canvas-renderer';
import { InputController } from '$lib/renderer/input-handlers';
import { catalog } from '$lib/state/catalog.svelte';
import type { LayerState } from '$lib/state/layers.svelte';
import type { ProjectionTransition } from '$lib/state/projection-transition.svelte';
import { view } from '$lib/state/view.svelte';
import { RenderLoop } from './render-loop';

/** What the stage asks of the pinhole frame's handles (`PinholeFrameOverlay`). */
export interface FrameOverlay {
	/** Apply a resize drag's latest pointer position; true when it changed the view. */
	flush(): boolean;
	/** Light the handles up when the pointer comes near the frame. */
	trackPointer(event: PointerEvent): void;
	clearPointer(): void;
}

export class StageController {
	readonly layers: LayerState;
	readonly projection: ProjectionTransition;
	/** The frame's handles, once they are there (`bind:this`). */
	overlay: FrameOverlay | undefined = undefined;
	readonly #loop: RenderLoop;
	#canvas: HTMLCanvasElement | null = null;
	#input: InputController | null = null;
	#renderer: CanvasRenderer | null = null;

	constructor(layers: LayerState, projection: ProjectionTransition) {
		this.layers = layers;
		this.projection = projection;
		this.#loop = new RenderLoop({
			flush: () => this.overlay?.flush() ?? false,
			move: (dtMs) => this.#input?.tick(dtMs) ?? false,
			animating: () =>
				this.projection.animating || (this.#renderer?.hasActiveAnimations() ?? false),
			draw: (frameTimeMs) => this.#draw(frameTimeMs)
		});
	}

	/** The preview's canvas, once the stage is in the page. */
	get canvas(): HTMLCanvasElement | null {
		return this.#canvas;
	}

	/** What the preview shows now; the projection is the one it is heading to. */
	get chartView(): ChartView {
		return {
			projection: this.projection.mode,
			orientation: view.orientation,
			stereoFovDeg: view.stereoFovDeg,
			pinholeFovDeg: view.pinholeFovDeg,
			pinholeAspectRatio: view.pinholeAspectRatio,
			pinholeHeightFrac: view.pinholeHeightFrac
		};
	}

	/** Something the chart draws changed: draw it on the next frame. */
	markDirty = (): void => this.#loop.markDirty();

	/**
	 * The canvas is in the page: from here on the sky takes input and is drawn on it,
	 * its outline morphing once the shape interpolator has loaded. Returns the way out.
	 */
	attach(canvas: HTMLCanvasElement): () => void {
		this.#canvas = canvas;
		this.#input = new InputController({
			canvas: () => this.#canvas,
			onChange: this.markDirty,
			getMode: () => (this.projection.blend < 0.5 ? 'stereographic' : 'pinhole')
		});
		this.#renderer = new CanvasRenderer(canvas);
		void loadFlubberInterpolator().then((interpolate) => {
			this.#renderer?.setMorphInterpolatorFactory(interpolate);
			this.markDirty();
		});
		return () => {
			this.#loop.stop();
			this.#input = null;
		};
	}

	switchProjection = (mode: ProjectionMode): void => {
		this.projection.start(mode);
		this.markDirty();
	};

	/**
	 * Take `next` whole, as a link brings it. With `fly` the sky turns and zooms to
	 * it, which only works within one projection; otherwise it is simply there.
	 */
	show(next: ChartView, fly: boolean): void {
		const input = this.#input;
		input?.stopMotion();
		view.pinholeAspectRatio = next.pinholeAspectRatio;
		view.pinholeHeightFrac = next.pinholeHeightFrac;
		if (fly && input) {
			const pinhole = next.projection === 'pinhole';
			input.flyTo(
				next.orientation,
				pinhole ? next.pinholeFovDeg : next.stereoFovDeg,
				next.projection
			);
		} else {
			view.orientation = next.orientation;
			view.stereoFovDeg = next.stereoFovDeg;
			view.pinholeFovDeg = next.pinholeFovDeg;
			this.projection.jump(next.projection);
		}
		this.markDirty();
	}

	/** Keys held down stop turning the sky: the window lost the focus, or a dialog opened over it. */
	release = (): void => this.#input?.onBlur();

	pointerdown = (event: PointerEvent): void => this.#input?.onPointerDown(event);

	pointermove = (event: PointerEvent): void => {
		this.#input?.onPointerMove(event);
		this.overlay?.trackPointer(event);
	};

	pointerleave = (): void => this.overlay?.clearPointer();

	pointerup = (event: PointerEvent): void => this.#input?.onPointerUp(event);

	keydown = (event: KeyboardEvent): void => this.#input?.onKeyDown(event);

	keyup = (event: KeyboardEvent): void => this.#input?.onKeyUp(event);

	wheel = (event: WheelEvent): void => this.#input?.onCanvasWheel(event);

	gesturestart = (event: Event): void => this.#input?.onCanvasGestureStart(event);

	gesturechange = (event: Event): void => this.#input?.onCanvasGestureChange(event);

	#draw(frameTimeMs: number): void {
		this.projection.tick(frameTimeMs);
		this.#renderer?.render({
			orientation: view.orientation,
			stereoFovDeg: view.stereoFovDeg,
			pinholeFovDeg: view.pinholeFovDeg,
			pinholeAspectRatio: view.pinholeAspectRatio,
			pinholeHeightFrac: view.pinholeHeightFrac,
			starVectors: catalog.starVectors,
			projectionBlend: this.projection.blend,
			referenceLines: this.layers.referenceLines,
			constellations: catalog.constellations,
			constellationBoundaries: catalog.constellationBoundaries
		});
	}
}
