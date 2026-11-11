import { describe, expect, it } from 'vitest';
import { RenderLoop, type FrameClock, type FrameParts } from './render-loop';

/** Animation frames that come when the test says so. */
function frames() {
	let nextId = 1;
	const pending = new Map<number, (frameTimeMs: number) => void>();
	const clock: FrameClock = {
		request: (callback) => {
			const id = nextId++;
			pending.set(id, callback);
			return id;
		},
		cancel: (id) => pending.delete(id)
	};
	return {
		clock,
		get pending() {
			return pending.size;
		},
		/** Run the frames asked for so far, at `frameTimeMs`. */
		run(frameTimeMs: number) {
			const callbacks = [...pending.values()];
			pending.clear();
			for (const callback of callbacks) callback(frameTimeMs);
		}
	};
}

/** Frame parts whose answers the test sets, and what the loop asked of them. */
function parts() {
	const state = { flushed: false, moving: false, animating: false };
	const steps: number[] = [];
	const drawn: number[] = [];
	const frame: FrameParts = {
		flush: () => state.flushed,
		move: (dtMs) => {
			steps.push(dtMs);
			return state.moving;
		},
		animating: () => state.animating,
		draw: (frameTimeMs) => drawn.push(frameTimeMs)
	};
	return { state, steps, drawn, frame };
}

describe('RenderLoop', () => {
	it('draws once for any number of marks before the frame, then rests', () => {
		const clock = frames();
		const { frame, drawn } = parts();
		const loop = new RenderLoop(frame, clock.clock);

		loop.markDirty();
		loop.markDirty();
		expect(clock.pending).toBe(1);

		clock.run(1000);
		expect(drawn).toEqual([1000]);
		expect(clock.pending).toBe(0);
	});

	it('keeps the frames coming while the sky moves, stepping by the time between them', () => {
		const clock = frames();
		const { frame, drawn, steps, state } = parts();
		const loop = new RenderLoop(frame, clock.clock);

		state.moving = true;
		loop.markDirty();
		clock.run(1000);
		clock.run(1020);
		// A tab that was away for a while: the sky does not jump.
		clock.run(1500);
		expect(steps).toEqual([16, 20, 100]);
		expect(drawn).toEqual([1000, 1020, 1500]);
		expect(clock.pending).toBe(1);

		state.moving = false;
		clock.run(1516);
		expect(drawn).toEqual([1000, 1020, 1500]);
		expect(clock.pending).toBe(0);
	});

	it('draws a frame the overlay changed though nothing else asked for it', () => {
		const clock = frames();
		const { frame, drawn, state } = parts();
		const loop = new RenderLoop(frame, clock.clock);

		state.moving = true;
		loop.markDirty();
		clock.run(1000);
		// The sky came to rest, and a frame-resize drag moved on in the same frame.
		state.moving = false;
		state.flushed = true;
		clock.run(1016);
		expect(drawn).toEqual([1000, 1016]);
		expect(clock.pending).toBe(0);
	});

	it('keeps drawing while an animation runs, and steps from scratch after a rest', () => {
		const clock = frames();
		const { frame, drawn, steps } = parts();
		// An animation that the third frame drawn brings to its end.
		let framesLeft = 3;
		frame.animating = () => framesLeft > 0;
		frame.draw = (frameTimeMs) => {
			drawn.push(frameTimeMs);
			framesLeft -= 1;
		};
		const loop = new RenderLoop(frame, clock.clock);

		loop.markDirty();
		clock.run(1000);
		clock.run(1016);
		clock.run(1032);
		expect(drawn).toEqual([1000, 1016, 1032]);
		expect(clock.pending).toBe(0);

		loop.markDirty();
		clock.run(5000);
		expect(steps).toEqual([16, 16, 16, 16]);
	});

	it('asks for no frame once stopped', () => {
		const clock = frames();
		const { frame, drawn } = parts();
		const loop = new RenderLoop(frame, clock.clock);

		loop.markDirty();
		loop.stop();
		expect(clock.pending).toBe(0);
		clock.run(1000);
		expect(drawn).toEqual([]);
	});
});
