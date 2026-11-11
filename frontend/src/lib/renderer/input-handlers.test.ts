// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FOV_DEG_STEREO, MIN_FOV_DEG_STEREO } from '$lib/constants';
import { quaternionFromAxisAngle, type Quaternion } from '$lib/math/quaternion';
import { view } from '$lib/state/view.svelte';
import { InputController } from './input-handlers';

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** How far apart two orientations are, in radians. */
function angleBetween(a: Quaternion, b: Quaternion): number {
	const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
	return 2 * Math.acos(Math.min(1, d));
}

function setup() {
	const canvas = document.createElement('canvas');
	canvas.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
	canvas.setPointerCapture = () => {};
	canvas.releasePointerCapture = () => {};
	canvas.hasPointerCapture = () => false;
	const onChange = vi.fn();
	const input = new InputController({
		canvas: () => canvas,
		onChange,
		getMode: () => 'stereographic'
	});
	const pointer = (x: number, y: number, timeStamp: number) =>
		({
			target: canvas,
			pointerId: 1,
			clientX: x,
			clientY: y,
			timeStamp
		}) as unknown as PointerEvent;
	/** Drag from x = 200 to the right, `stepPx` every 16 ms, and return the time of the last move. */
	const drag = (steps: number, stepPx: number): number => {
		input.onPointerDown(pointer(200, 300, 0));
		let time = 0;
		for (let i = 1; i <= steps; i += 1) {
			time = i * 16;
			input.onPointerMove(pointer(200 + i * stepPx, 300, time));
		}
		return time;
	};
	const wheel = (deltaY: number) =>
		input.onCanvasWheel({
			ctrlKey: true,
			deltaY,
			preventDefault: () => {}
		} as unknown as WheelEvent);
	/** Run frames until the controller rests; the number of frames it took. */
	const settle = (maxFrames = 600): number => {
		let frames = 0;
		while (frames < maxFrames && input.tick(16)) frames += 1;
		return frames;
	};
	return { input, onChange, pointer, drag, wheel, settle };
}

function reduceMotion(reduce: boolean) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: reduce && query.includes('prefers-reduced-motion'),
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
}

beforeEach(() => {
	view.orientation = { ...IDENTITY };
	view.stereoFovDeg = MAX_FOV_DEG_STEREO;
	reduceMotion(false);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('glide after a drag', () => {
	it('carries the sky on at the speed of the drag, then comes to rest', () => {
		const { input, pointer, drag, settle } = setup();
		const lastMove = drag(8, 12);
		const released = { ...view.orientation };
		input.onPointerUp(pointer(296, 300, lastMove + 8));

		expect(input.tick(16)).toBe(true);
		const afterOneFrame = angleBetween(released, view.orientation);
		expect(afterOneFrame).toBeGreaterThan(0);

		const frames = settle();
		// It slows down: the whole glide is a few frames' worth of the first one, not hundreds.
		const total = angleBetween(released, view.orientation);
		expect(total).toBeGreaterThan(afterOneFrame);
		expect(total).toBeLessThan(afterOneFrame * 25);
		// Over within a couple of seconds, after which the frame loop may sleep.
		expect(frames).toBeLessThan(120);
		expect(input.tick(16)).toBe(false);
	});

	it('keeps turning the way the drag went', () => {
		const { input, pointer, drag } = setup();
		const lastMove = drag(8, 12);
		const start = { ...IDENTITY };
		const released = { ...view.orientation };
		input.onPointerUp(pointer(296, 300, lastMove + 8));
		input.tick(16);
		// Further from where the drag began than the release was: not back towards it.
		expect(angleBetween(start, view.orientation)).toBeGreaterThan(angleBetween(start, released));
	});

	it('does not glide when the pointer rested before it was lifted', () => {
		const { input, pointer, drag } = setup();
		const lastMove = drag(8, 12);
		const released = { ...view.orientation };
		input.onPointerUp(pointer(296, 300, lastMove + 200));
		expect(input.tick(16)).toBe(false);
		expect(view.orientation).toEqual(released);
	});

	it('does not glide after a slow drag', () => {
		const { input, pointer, drag } = setup();
		const lastMove = drag(8, 0.2);
		input.onPointerUp(pointer(201.6, 300, lastMove + 8));
		expect(input.tick(16)).toBe(false);
	});

	it('stops under a new press', () => {
		const { input, pointer, drag } = setup();
		const lastMove = drag(8, 12);
		input.onPointerUp(pointer(296, 300, lastMove + 8));
		expect(input.tick(16)).toBe(true);

		input.onPointerDown(pointer(300, 300, lastMove + 40));
		const held = { ...view.orientation };
		expect(input.tick(16)).toBe(false);
		expect(view.orientation).toEqual(held);
	});

	it('is left out when the system asks for less motion', () => {
		reduceMotion(true);
		const { input, pointer, drag } = setup();
		const lastMove = drag(8, 12);
		input.onPointerUp(pointer(296, 300, lastMove + 8));
		expect(input.tick(16)).toBe(false);
	});
});

describe('wheel zoom', () => {
	it('eases to what the wheel asked for and lands on it exactly', () => {
		const { input, wheel, settle } = setup();
		view.stereoFovDeg = 100;
		wheel(-100);
		const target = 100 * Math.exp(-0.25);
		// Nothing jumps on the event itself.
		expect(view.stereoFovDeg).toBe(100);

		input.tick(16);
		expect(view.stereoFovDeg).toBeLessThan(100);
		expect(view.stereoFovDeg).toBeGreaterThan(target);

		const frames = settle();
		expect(view.stereoFovDeg).toBeCloseTo(target, 9);
		expect(frames).toBeLessThan(40);
	});

	it('adds up notches that come before the ease has finished', () => {
		const { input, wheel, settle } = setup();
		view.stereoFovDeg = 100;
		wheel(-100);
		input.tick(16);
		wheel(-100);
		settle();
		expect(view.stereoFovDeg).toBeCloseTo(100 * Math.exp(-0.5), 9);
	});

	it('stays inside the limits', () => {
		const { wheel, settle } = setup();
		view.stereoFovDeg = 30;
		for (let i = 0; i < 20; i += 1) wheel(-400);
		settle();
		expect(view.stereoFovDeg).toBe(MIN_FOV_DEG_STEREO);
	});

	it('gives way to a zoom set outright', () => {
		const { input, wheel } = setup();
		view.stereoFovDeg = 100;
		wheel(-100);
		input.tick(16);
		input.setFov(60, 'stereographic');
		expect(view.stereoFovDeg).toBe(60);
		expect(input.tick(16)).toBe(false);
		expect(view.stereoFovDeg).toBe(60);
	});

	it('is immediate when the system asks for less motion', () => {
		reduceMotion(true);
		const { input, wheel } = setup();
		view.stereoFovDeg = 100;
		wheel(-100);
		expect(view.stereoFovDeg).toBeCloseTo(100 * Math.exp(-0.25), 9);
		expect(input.tick(16)).toBe(false);
	});
});

describe('flyTo', () => {
	const target = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.2);

	it('arrives at the orientation and the field of view it was given', () => {
		const { input, settle } = setup();
		input.flyTo(target, 60, 'stereographic');
		input.tick(16);
		// On its way: neither where it was nor there yet.
		expect(angleBetween(IDENTITY, view.orientation)).toBeGreaterThan(0);
		expect(angleBetween(target, view.orientation)).toBeGreaterThan(0);
		expect(view.stereoFovDeg).toBeLessThan(MAX_FOV_DEG_STEREO);
		expect(view.stereoFovDeg).toBeGreaterThan(60);

		const frames = settle();
		expect(angleBetween(target, view.orientation)).toBeCloseTo(0, 6);
		expect(view.stereoFovDeg).toBe(60);
		// 600 ms at 16 ms a frame.
		expect(frames).toBeLessThanOrEqual(40);
	});

	it('gets steadily closer', () => {
		const { input } = setup();
		input.flyTo(target, MAX_FOV_DEG_STEREO, 'stereographic');
		let last = angleBetween(target, view.orientation);
		while (input.tick(16)) {
			const next = angleBetween(target, view.orientation);
			expect(next).toBeLessThanOrEqual(last + 1e-9);
			last = next;
		}
	});

	it('is taken over by a press, and stopped by stopMotion', () => {
		const { input, pointer } = setup();
		input.flyTo(target, 60, 'stereographic');
		input.tick(16);
		input.onPointerDown(pointer(300, 300, 100));
		const held = { ...view.orientation };
		expect(input.tick(16)).toBe(false);
		expect(view.orientation).toEqual(held);

		input.onPointerUp(pointer(300, 300, 400));
		input.flyTo(target, 60, 'stereographic');
		input.stopMotion();
		expect(input.tick(16)).toBe(false);
	});
});
