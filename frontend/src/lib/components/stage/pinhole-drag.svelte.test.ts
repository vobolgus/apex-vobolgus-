// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pinholeFrameRect, type FrameHandle, type PinholeShape } from '$lib/math/pinhole-frame';
import { PinholeDrag, type PinholeDragHost } from './pinhole-drag.svelte';

const SURFACE = 600;

/** A pointer event of `type`, by `pointerId`, at (`x`, `y`). */
function pointer(type: string, pointerId: number, x: number, y: number, extra = {}): PointerEvent {
	const event = new MouseEvent(type, {
		clientX: x,
		clientY: y,
		button: 0,
		bubbles: true,
		cancelable: true,
		...extra
	});
	Object.assign(event, { pointerId, isPrimary: true, pointerType: 'mouse' });
	return event as PointerEvent;
}

/** A drag over a 600 px surface, with a handle's hit area that takes the pointer. */
function setup() {
	let shape: PinholeShape = { fovDeg: 40, aspectRatio: 1.5, heightFrac: 1 };
	const root = document.createElement('div');
	root.getBoundingClientRect = () => new DOMRect(0, 0, SURFACE, SURFACE);
	const target = document.createElement('div');
	let captured: number | null = null;
	target.setPointerCapture = (id: number) => void (captured = id);
	target.hasPointerCapture = (id: number) => captured === id;
	target.releasePointerCapture = () => void (captured = null);
	root.append(target);
	document.body.append(root);
	const host = {
		root: () => root,
		shape: () => shape,
		frame: () => pinholeFrameRect(SURFACE, shape.aspectRatio, shape.heightFrac),
		surfaceSizePx: () => SURFACE,
		clipWidthPx: () => 900,
		clipHeightPx: () => 700,
		write: vi.fn((next: PinholeShape) => void (shape = next)),
		changed: vi.fn(),
		ended: vi.fn()
	} satisfies PinholeDragHost;
	const drag = new PinholeDrag(host);
	const press = (handle: FrameHandle, x: number, y: number) => {
		const event = pointer('pointerdown', 1, x, y);
		Object.defineProperty(event, 'currentTarget', { value: target });
		drag.start(event, handle);
	};
	return { drag, host, target, press, shape: () => shape, captured: () => captured };
}

afterEach(() => {
	document.body.replaceChildren();
	document.documentElement.className = '';
	document.documentElement.removeAttribute('style');
});

describe('PinholeDrag', () => {
	it('takes the pointer on a press, and pins the cursor page-wide', () => {
		const { drag, press, captured } = setup();
		const { x, width } = pinholeFrameRect(SURFACE, 1.5, 1);
		press('e', x + width, SURFACE / 2);
		expect(drag.dragging).toBe(true);
		expect(drag.active).toBe('e');
		expect(drag.limits).not.toBeNull();
		expect(captured()).toBe(1);
		expect(document.documentElement.classList.contains('pinhole-resizing')).toBe(true);
		expect(document.documentElement.style.getPropertyValue('--pinhole-resize-cursor')).not.toBe('');
	});

	it('writes nothing on a move until the render loop flushes it, and then once', () => {
		const { drag, host, target, press } = setup();
		const { x, width } = pinholeFrameRect(SURFACE, 1.5, 1);
		press('e', x + width, SURFACE / 2);
		target.dispatchEvent(pointer('pointermove', 1, x + width + 40, SURFACE / 2));
		expect(host.changed).toHaveBeenCalledTimes(1);
		expect(host.write).not.toHaveBeenCalled();
		expect(drag.flush()).toBe(true);
		expect(host.write).toHaveBeenCalledTimes(1);
		expect(drag.flush()).toBe(false);
	});

	it('keeps the frame on a release, where the pointer let go', () => {
		const { drag, host, target, press, shape, captured } = setup();
		const before = shape();
		const { x, width } = pinholeFrameRect(SURFACE, 1.5, 1);
		press('e', x + width, SURFACE / 2);
		target.dispatchEvent(pointer('pointerup', 1, x + width + 40, SURFACE / 2));
		expect(drag.dragging).toBe(false);
		expect(host.write).toHaveBeenCalledTimes(1);
		expect(shape().aspectRatio).toBeGreaterThan(before.aspectRatio);
		expect(drag.active).toBeNull();
		expect(drag.limits).toBeNull();
		expect(captured()).toBeNull();
		expect(document.documentElement.classList.contains('pinhole-resizing')).toBe(false);
		expect(host.ended).toHaveBeenCalledTimes(1);
		expect(host.changed).toHaveBeenCalledTimes(1);
	});

	it('puts the frame back on Escape', () => {
		const { drag, host, target, press, shape } = setup();
		const before = shape();
		const { x, width } = pinholeFrameRect(SURFACE, 1.5, 1);
		press('e', x + width, SURFACE / 2);
		target.dispatchEvent(pointer('pointermove', 1, x + width + 40, SURFACE / 2));
		drag.flush();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(drag.dragging).toBe(false);
		expect(shape()).toEqual(before);
		expect(host.ended).toHaveBeenCalledTimes(1);
	});

	it('keeps a second pointer from reaching the sky, and ignores its moves', () => {
		const { host, target, press } = setup();
		const { x, width } = pinholeFrameRect(SURFACE, 1.5, 1);
		press('e', x + width, SURFACE / 2);
		const other = pointer('pointerdown', 2, 10, 10);
		window.dispatchEvent(other);
		expect(other.defaultPrevented).toBe(true);
		target.dispatchEvent(pointer('pointermove', 2, 20, 20));
		expect(host.changed).not.toHaveBeenCalled();
	});

	it('re-reads Shift on its own key events, asking for a frame only when it changes', () => {
		const { host, press } = setup();
		const { x, width } = pinholeFrameRect(SURFACE, 1.5, 1);
		press('e', x + width, SURFACE / 2);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
		expect(host.changed).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
		expect(host.changed).toHaveBeenCalledTimes(2);
	});

	it('starts no second drag while one is held, nor one from another button', () => {
		const { drag, press } = setup();
		const right = pointer('pointerdown', 1, 0, 0, { button: 2 });
		drag.start(right, 'n');
		expect(drag.dragging).toBe(false);
		press('e', 0, 0);
		press('n', 0, 0);
		expect(drag.active).toBe('e');
	});

	it('ends with nothing to end as a no-op', () => {
		const { drag, host } = setup();
		drag.end(true);
		expect(host.ended).not.toHaveBeenCalled();
		expect(host.changed).not.toHaveBeenCalled();
	});
});
