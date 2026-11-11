/**
 * The chart's frames: one is drawn only when something asked for it, at most one
 * per animation frame, and they keep coming only while something moves by itself.
 *
 * `markDirty` asks for a frame. A frame first lets the frame overlay apply its drag
 * and the input move the sky; it then draws if either changed the view, if a mark
 * asked for it or if an animation is running, and it asks for the next frame only
 * while the sky or an animation is still moving. At rest the loop sleeps.
 */

/** What a frame is made of, in the order it runs them. */
export interface FrameParts {
	/** Apply a frame-resize drag's latest pointer position; true when it changed the view. */
	flush(): boolean;
	/** Move the sky on by `dtMs` (a glide, a held key, a flight); true while it moves. */
	move(dtMs: number): boolean;
	/** Whether something animates by itself: the projection's morph, a line's or the stars' fade. */
	animating(): boolean;
	/** Draw the chart as it is at `frameTimeMs`. */
	draw(frameTimeMs: number): void;
}

/** Where the frames come from: the browser's animation frames, or a test's. */
export interface FrameClock {
	request(callback: (frameTimeMs: number) => void): number;
	cancel(id: number): void;
}

const animationFrames: FrameClock = {
	request: (callback) => requestAnimationFrame(callback),
	cancel: (id) => cancelAnimationFrame(id)
};

/** The longest step the sky takes in one frame, ms: a tab that was away does not jump. */
const MAX_FRAME_STEP_MS = 100;
/** The step of the first frame after a rest, which has no last frame to count from. */
const FIRST_FRAME_STEP_MS = 16;

export class RenderLoop {
	readonly #parts: FrameParts;
	readonly #clock: FrameClock;
	#dirty = false;
	#frameId = 0;
	/** When the last frame ran; 0 while the loop is at rest. */
	#lastFrameMs = 0;

	constructor(parts: FrameParts, clock: FrameClock = animationFrames) {
		this.#parts = parts;
		this.#clock = clock;
	}

	/** Something the chart draws changed: draw it on the next frame. */
	markDirty = (): void => {
		this.#dirty = true;
		this.#schedule();
	};

	/** No more frames: the stage is going away. */
	stop(): void {
		if (this.#frameId) this.#clock.cancel(this.#frameId);
		this.#frameId = 0;
	}

	#schedule(): void {
		if (this.#frameId) return;
		this.#frameId = this.#clock.request(this.#frame);
	}

	#frame = (frameTimeMs: number): void => {
		this.#frameId = 0;
		const dtMs =
			this.#lastFrameMs > 0
				? Math.min(frameTimeMs - this.#lastFrameMs, MAX_FRAME_STEP_MS)
				: FIRST_FRAME_STEP_MS;
		this.#lastFrameMs = frameTimeMs;

		// A frame-resize drag applies its latest pointer position here, so the overlay
		// and the canvas move together, at most once per frame.
		if (this.#parts.flush()) this.#dirty = true;

		const moving = this.#parts.move(dtMs);
		if (moving) this.#dirty = true;

		if (!this.#dirty && !this.#parts.animating()) {
			this.#lastFrameMs = 0;
			return;
		}
		this.#dirty = false;

		this.#parts.draw(frameTimeMs);

		if (moving || this.#parts.animating()) {
			this.#schedule();
		} else {
			this.#lastFrameMs = 0;
		}
	};
}
