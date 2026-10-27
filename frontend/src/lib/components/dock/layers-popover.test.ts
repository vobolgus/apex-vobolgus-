// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import LayersPopover from './LayersPopover.svelte';
import { LayerState } from '$lib/state/layers.svelte';
import { Dropdown, DropdownGroup } from '$lib/ui/dropdown.svelte';

function setup() {
	const target = document.createElement('div');
	document.body.append(target);
	const layers = new LayerState();
	const menu = new Dropdown();
	const component = mount(LayersPopover, { target, props: { layers, menu } });
	const trigger = target.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
	const cleanup = () => {
		unmount(component);
		target.remove();
	};
	return { target, layers, menu, trigger, cleanup };
}

function keydown(element: Element, key: string) {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	element.dispatchEvent(event);
	flushSync();
	return event;
}

function switchNamed(root: ParentNode, label: string): HTMLButtonElement {
	const match = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find(
		(element) => {
			const labelId = element.getAttribute('aria-labelledby');
			return labelId && root.querySelector(`[id="${labelId}"]`)?.textContent === label;
		}
	);
	if (!match) throw new Error(`no switch named ${label}`);
	return match;
}

/** Let the popover's `await tick()` before focusing run. */
async function settle() {
	await tick();
	await tick();
}

describe('LayersPopover', () => {
	let cleanup: (() => void) | null = null;
	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it('counts enabled layers in the badge', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const badge = ctx.target.querySelector('.badge')!;

		expect(badge.textContent).toBe('0');
		expect(ctx.trigger.getAttribute('aria-label')).toBe('Layers, 0 on');

		ctx.layers.ecliptic = true;
		ctx.layers.planets = true;
		flushSync();
		expect(badge.textContent).toBe('2');
		expect(ctx.trigger.getAttribute('aria-label')).toBe('Layers, 2 on');
	});

	it('opens upward with grouped switches and toggles layers', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		expect(ctx.target.querySelector('[role="dialog"]')).toBeNull();

		ctx.trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		flushSync();
		const panel = ctx.target.querySelector<HTMLElement>('[role="dialog"]')!;
		expect(panel).not.toBeNull();
		expect(ctx.trigger.getAttribute('aria-expanded')).toBe('true');
		expect(ctx.trigger.getAttribute('aria-controls')).toBe(panel.id);

		const groups = Array.from(panel.querySelectorAll('[role="group"]'));
		expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
			'Constellations',
			'Circles',
			'Bodies'
		]);
		expect(panel.querySelectorAll('[role="switch"]')).toHaveLength(3 + 6);

		const ecliptic = switchNamed(panel, 'Ecliptic');
		ecliptic.click();
		flushSync();
		expect(ctx.layers.ecliptic).toBe(true);
		expect(ecliptic.getAttribute('aria-checked')).toBe('true');

		const planets = switchNamed(panel, 'Planets');
		const noteId = planets.getAttribute('aria-describedby')!;
		expect(panel.querySelector(`[id="${noteId}"]`)?.textContent).toBe('SVG/PDF only');

		// A mouse click on the trigger closes it again.
		ctx.trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		flushSync();
		expect(ctx.target.querySelector('[role="dialog"]')).toBeNull();
	});

	it('drives a whole group from its master switch', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		ctx.menu.show();
		flushSync();
		const panel = ctx.target.querySelector<HTMLElement>('[role="dialog"]')!;
		const circles = panel.querySelectorAll('[role="group"]')[1];
		const master = circles.querySelector<HTMLButtonElement>('[role="switch"]')!;

		expect(master.getAttribute('aria-checked')).toBe('false');
		master.click();
		flushSync();
		expect([ctx.layers.equator, ctx.layers.ecliptic, ctx.layers.galacticEquator]).toEqual([
			true,
			true,
			true
		]);
		expect(ctx.layers.constellations).toBe(false);
		expect(master.getAttribute('aria-checked')).toBe('true');

		master.click();
		flushSync();
		expect([ctx.layers.equator, ctx.layers.ecliptic, ctx.layers.galacticEquator]).toEqual([
			false,
			false,
			false
		]);
		expect(master.getAttribute('aria-checked')).toBe('false');

		// Part of the group on: the master is mixed, not on, and a click turns the rest on.
		ctx.layers.ecliptic = true;
		flushSync();
		expect(master.getAttribute('aria-checked')).toBe('false');
		expect(master.classList.contains('is-mixed')).toBe(true);
		master.click();
		flushSync();
		expect([ctx.layers.equator, ctx.layers.ecliptic, ctx.layers.galacticEquator]).toEqual([
			true,
			true,
			true
		]);
		expect(master.getAttribute('aria-checked')).toBe('true');
		expect(master.classList.contains('is-mixed')).toBe(false);
	});

	it('handles the keyboard: ↑ opens, ↑/↓ move, Escape returns focus to the trigger', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const windowKeydown = vi.fn();
		window.addEventListener('keydown', windowKeydown);

		ctx.trigger.focus();
		keydown(ctx.trigger, 'ArrowUp');
		await settle();
		const panel = ctx.target.querySelector<HTMLElement>('[role="dialog"]')!;
		const rows = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
		expect(ctx.menu.open).toBe(true);
		expect(document.activeElement).toBe(rows[0]);

		keydown(rows[0], 'ArrowDown');
		expect(document.activeElement).toBe(rows[1]);
		keydown(rows[1], 'ArrowUp');
		keydown(rows[0], 'ArrowUp');
		expect(document.activeElement).toBe(rows.at(-1));
		keydown(rows.at(-1)!, 'Home');
		expect(document.activeElement).toBe(rows[0]);

		// None of these reached the window, where arrows rotate the sky.
		expect(windowKeydown).not.toHaveBeenCalled();

		keydown(rows[0], 'Escape');
		expect(ctx.menu.open).toBe(false);
		expect(ctx.target.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(ctx.trigger);
		window.removeEventListener('keydown', windowKeydown);
	});

	it('opens with ↓ on the trigger as well, and keeps it from the sky controls', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const windowKeydown = vi.fn();
		window.addEventListener('keydown', windowKeydown);

		ctx.trigger.focus();
		const down = keydown(ctx.trigger, 'ArrowDown');
		await settle();
		expect(down.defaultPrevented).toBe(true);
		expect(ctx.menu.open).toBe(true);
		expect(document.activeElement).toBe(
			ctx.target.querySelector('[role="dialog"] [role="switch"]')
		);
		expect(windowKeydown).not.toHaveBeenCalled();
		window.removeEventListener('keydown', windowKeydown);
	});

	it('closes when Tab moves focus out, also out of the page', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const outside = document.createElement('button');
		document.body.append(outside);

		ctx.trigger.focus();
		keydown(ctx.trigger, 'ArrowUp');
		await settle();
		const rows = () =>
			Array.from(ctx.target.querySelectorAll<HTMLButtonElement>('[role="dialog"] [role="switch"]'));

		// Within the popover and back to the trigger it stays open.
		keydown(rows()[0], 'Tab');
		rows()[1].focus();
		ctx.trigger.focus();
		flushSync();
		expect(ctx.menu.open).toBe(true);

		// A blur that is not a Tab (a click on nothing) is left to the dropdown group.
		rows()[0].focus();
		rows()[0].blur();
		flushSync();
		expect(ctx.menu.open).toBe(true);

		// Tab past the last row: focus leaves the document without a relatedTarget.
		const last = rows().at(-1)!;
		last.focus();
		keydown(last, 'Tab');
		last.blur();
		flushSync();
		expect(ctx.menu.open).toBe(false);

		// Tab onto an element outside closes it too.
		keydown(ctx.trigger, 'ArrowUp');
		await settle();
		keydown(rows()[0], 'Tab');
		outside.focus();
		flushSync();
		expect(ctx.menu.open).toBe(false);
		outside.remove();
	});

	it('focuses the first row when opened with Enter or Space', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;

		ctx.trigger.focus();
		// Keyboard activation of a button is a click with detail 0.
		ctx.trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
		await settle();
		const first = ctx.target.querySelector<HTMLElement>('[role="dialog"] [role="switch"]');
		expect(first).not.toBeNull();
		expect(document.activeElement).toBe(first);
	});

	it('closes the other menus of its group when it opens', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const other = new Dropdown();
		new DropdownGroup(other, ctx.menu);

		other.show();
		ctx.trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		flushSync();
		expect(ctx.menu.open).toBe(true);
		expect(other.open).toBe(false);
	});
});
