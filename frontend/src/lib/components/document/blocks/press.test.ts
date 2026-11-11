// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PressGuard } from './press';

/** An event as a handler sees it: on `target`, with its `detail` (0 from the keys). */
function on<E extends Event>(event: E, target: EventTarget): E {
	Object.defineProperty(event, 'currentTarget', { value: target });
	return event;
}

function click(target: EventTarget, detail = 1): MouseEvent {
	return on(new MouseEvent('click', { detail, cancelable: true }), target);
}

function press(target: EventTarget): PointerEvent {
	const event = new Event('pointerdown', { bubbles: true, cancelable: true }) as PointerEvent;
	return on(event, target);
}

describe('PressGuard', () => {
	const remove = new EventTarget();
	const larger = new EventTarget();

	it('counts a click on the control the press began on, once', () => {
		const guard = new PressGuard();
		guard.begin(press(remove));
		expect(guard.counts(click(remove))).toBe(true);
		expect(guard.counts(click(remove))).toBe(false);
	});

	it('does not count a click that lands on another control than the one pressed', () => {
		const guard = new PressGuard();
		guard.begin(press(larger));
		expect(guard.counts(click(remove))).toBe(false);
		// Asked once, the press is spent: not even its own control counts it now.
		expect(guard.counts(click(larger))).toBe(false);
	});

	it('counts nothing after a press on the block itself', () => {
		const guard = new PressGuard();
		guard.begin(press(remove));
		guard.clear();
		expect(guard.counts(click(remove))).toBe(false);
	});

	it('always counts a click from the keys or a screen reader', () => {
		const guard = new PressGuard();
		expect(guard.counts(click(remove, 0))).toBe(true);
		guard.begin(press(larger));
		expect(guard.counts(click(remove, 0))).toBe(true);
	});

	it('holds a press on a tool: the focus stays where it is, and the block is not carried', () => {
		const guard = new PressGuard();
		const event = press(larger);
		guard.hold(event);
		expect(event.defaultPrevented).toBe(true);
		expect(event.cancelBubble).toBe(true);
		expect(guard.counts(click(larger))).toBe(true);
	});
});
