// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SegmentedControl from './SegmentedControl.svelte';
import { PROJECTION_SEGMENTS } from './options';
import type { ProjectionMode } from '$lib/state/projection-transition.svelte';

function setup(initial: ProjectionMode = 'stereographic') {
	const target = document.createElement('div');
	document.body.append(target);
	const onselect = vi.fn((value: ProjectionMode) => {
		props.value = value;
	});
	const props = $state({
		label: 'Projection',
		options: PROJECTION_SEGMENTS,
		value: initial,
		onselect,
		shortcut: 'Shift+P'
	});
	const component = mount(SegmentedControl<ProjectionMode>, { target, props });
	flushSync();
	const group = target.querySelector<HTMLElement>('[role="radiogroup"]')!;
	const radios = Array.from(target.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
	const cleanup = () => {
		unmount(component);
		target.remove();
	};
	return { group, radios, onselect, props, cleanup };
}

function keydown(element: HTMLElement, key: string) {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	element.dispatchEvent(event);
	flushSync();
	return event;
}

describe('SegmentedControl', () => {
	let cleanup: (() => void) | null = null;
	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it('renders a labelled radio group with one tab stop on the selection', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;

		expect(ctx.group.getAttribute('aria-label')).toBe('Projection');
		expect(ctx.group.getAttribute('aria-keyshortcuts')).toBe('Shift+P');
		expect(ctx.radios.map((radio) => radio.textContent?.trim())).toEqual(['Stereo', 'Pinhole']);
		expect(ctx.radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
			'true',
			'false'
		]);
		expect(ctx.radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
		expect(ctx.radios[1].getAttribute('aria-label')).toBe('Pinhole projection');
		expect(ctx.radios[1].title).toBe('Pinhole projection · Shift+P');
	});

	it('selects on click and moves the tab stop with the selection', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;

		ctx.radios[1].click();
		flushSync();
		expect(ctx.onselect).toHaveBeenCalledWith('pinhole');
		expect(ctx.radios[1].getAttribute('aria-checked')).toBe('true');
		expect(ctx.radios[0].getAttribute('aria-checked')).toBe('false');
		expect(ctx.radios.map((radio) => radio.tabIndex)).toEqual([-1, 0]);

		// Clicking the selected option again is not a new selection.
		ctx.radios[1].click();
		flushSync();
		expect(ctx.onselect).toHaveBeenCalledTimes(1);
	});

	it('switches with ←/→, moves focus and keeps the keys from the sky controls', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const windowKeydown = vi.fn();
		window.addEventListener('keydown', windowKeydown);

		ctx.radios[0].focus();
		const right = keydown(ctx.radios[0], 'ArrowRight');
		expect(right.defaultPrevented).toBe(true);
		expect(ctx.onselect).toHaveBeenLastCalledWith('pinhole');
		expect(document.activeElement).toBe(ctx.radios[1]);
		expect(ctx.radios[1].getAttribute('aria-checked')).toBe('true');

		// Wraps around in both directions.
		keydown(ctx.radios[1], 'ArrowRight');
		expect(ctx.props.value).toBe('stereographic');
		expect(document.activeElement).toBe(ctx.radios[0]);
		keydown(ctx.radios[0], 'ArrowLeft');
		expect(ctx.props.value).toBe('pinhole');

		// ↑/↓ switch as well (screen readers send them in a radio group).
		keydown(ctx.radios[1], 'ArrowDown');
		expect(ctx.props.value).toBe('stereographic');
		expect(document.activeElement).toBe(ctx.radios[0]);
		keydown(ctx.radios[0], 'ArrowUp');
		expect(ctx.props.value).toBe('pinhole');

		expect(windowKeydown).not.toHaveBeenCalled();

		// Keys the segment does not handle still reach the window (Shift+P).
		keydown(ctx.radios[1], 'P');
		expect(windowKeydown).toHaveBeenCalledTimes(1);
		window.removeEventListener('keydown', windowKeydown);
	});

	it('keeps focus on the selection when the value changes from outside', () => {
		const ctx = setup('pinhole');
		cleanup = ctx.cleanup;

		ctx.radios[1].focus();
		// Shift+P flips the projection while Pinhole has focus.
		ctx.props.value = 'stereographic';
		flushSync();
		expect(document.activeElement).toBe(ctx.radios[0]);
		expect(ctx.radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);

		// The next arrow steps from the selection, so it switches at once.
		keydown(ctx.radios[0], 'ArrowRight');
		expect(ctx.props.value).toBe('pinhole');
		expect(document.activeElement).toBe(ctx.radios[1]);
	});

	it('steps from the selection even when focus sits on another option', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;

		// Focus on the unselected option, e.g. after Shift+P before the focus followed.
		keydown(ctx.radios[1], 'ArrowRight');
		expect(ctx.props.value).toBe('pinhole');
		expect(document.activeElement).toBe(ctx.radios[1]);
	});
});
