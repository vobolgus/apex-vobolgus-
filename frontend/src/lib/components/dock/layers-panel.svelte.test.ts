// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayersPanel from './LayersPanel.svelte';
import LayersPopover from './LayersPopover.svelte';
import { LAYERS_PANEL_FOOTPRINT_PX, LAYERS_PANEL_INSET_PX, LAYERS_PANEL_WIDTH_PX } from './options';
import { LayerState } from '$lib/state/layers.svelte';
import { Dropdown } from '$lib/ui/dropdown.svelte';

let cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups) cleanup();
	cleanups = [];
});

function host(): HTMLElement {
	const target = document.createElement('div');
	document.body.append(target);
	cleanups.push(() => target.remove());
	return target;
}

function keydown(element: Element, key: string) {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	element.dispatchEvent(event);
	flushSync();
	return event;
}

function switches(root: ParentNode): HTMLButtonElement[] {
	return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
}

function switchNamed(root: ParentNode, label: string): HTMLButtonElement {
	const match = switches(root).find((element) => {
		const labelId = element.getAttribute('aria-labelledby');
		return labelId && root.querySelector(`[id="${labelId}"]`)?.textContent === label;
	});
	if (!match) throw new Error(`no switch named ${label}`);
	return match;
}

function mountPanel() {
	const target = host();
	const layers = new LayerState();
	const onclose = vi.fn();
	const component = mount(LayersPanel, {
		target,
		props: { layers, open: true, id: 'layers-panel', onclose }
	});
	cleanups.push(() => unmount(component));
	// `bind:this` is set in an effect: flush, so the panel knows its own element.
	flushSync();
	const panel = target.querySelector<HTMLElement>('#layers-panel')!;
	return { target, layers, onclose, component, panel };
}

describe('LayersPanel', () => {
	it('is a named region holding every layer as a switch', () => {
		const { panel, layers } = mountPanel();
		expect(panel.tagName).toBe('ASIDE');
		const title = panel.querySelector(`[id="${panel.getAttribute('aria-labelledby')}"]`);
		expect(title?.textContent).toBe('Layers');

		const ecliptic = switchNamed(panel, 'Ecliptic');
		expect(ecliptic.getAttribute('aria-checked')).toBe('false');
		ecliptic.click();
		flushSync();
		expect(layers.ecliptic).toBe(true);
		expect(ecliptic.getAttribute('aria-checked')).toBe('true');

		// A group's master switch turns its layers on together.
		switchNamed(panel, 'Constellations').click();
		flushSync();
		expect(layers.constellations && layers.constellationBoundaries).toBe(true);
	});

	it('takes the width and inset the page reserves for it', () => {
		const { panel } = mountPanel();
		expect(panel.style.getPropertyValue('--width')).toBe(`${LAYERS_PANEL_WIDTH_PX}px`);
		expect(panel.style.getPropertyValue('--inset')).toBe(`${LAYERS_PANEL_INSET_PX}px`);
		expect(LAYERS_PANEL_FOOTPRINT_PX).toBe(LAYERS_PANEL_WIDTH_PX + LAYERS_PANEL_INSET_PX);
	});

	it('moves between rows with ↑/↓ and Home/End, keeping the arrows from the sky', () => {
		const { panel, component } = mountPanel();
		const rows = switches(panel);
		const seen = vi.fn();
		window.addEventListener('keydown', seen);
		cleanups.push(() => window.removeEventListener('keydown', seen));

		component.focusFirst();
		expect(document.activeElement).toBe(rows[0]);
		expect(component.hasFocus()).toBe(true);

		const down = keydown(rows[0], 'ArrowDown');
		expect(document.activeElement).toBe(rows[1]);
		expect(down.defaultPrevented).toBe(true);
		keydown(rows[1], 'End');
		expect(document.activeElement).toBe(rows[rows.length - 1]);
		keydown(rows[rows.length - 1], 'ArrowDown');
		expect(document.activeElement).toBe(rows[0]);
		keydown(rows[0], 'ArrowUp');
		expect(document.activeElement).toBe(rows[rows.length - 1]);
		keydown(rows[rows.length - 1], 'Home');
		expect(document.activeElement).toBe(rows[0]);
		// None of them reached the window, where arrows turn the sky.
		expect(seen).not.toHaveBeenCalled();

		// A key the panel has no use for passes through: W A S D still turn the sky.
		keydown(rows[0], 'd');
		expect(seen).toHaveBeenCalledTimes(1);
	});

	it('is marked open or closed for the slide, and slides only once it may', () => {
		const target = host();
		const props = $state({
			layers: new LayerState(),
			open: false,
			animated: false,
			id: 'p',
			onclose() {}
		});
		const component = mount(LayersPanel, { target, props });
		cleanups.push(() => unmount(component));
		const panel = target.querySelector<HTMLElement>('#p')!;
		expect(panel.classList.contains('open')).toBe(false);
		expect(panel.classList.contains('animated')).toBe(false);

		props.open = true;
		props.animated = true;
		flushSync();
		expect(panel.classList.contains('open')).toBe(true);
		expect(panel.classList.contains('animated')).toBe(true);
	});

	it('asks to be hidden from its close button and on Escape', () => {
		const { panel, onclose } = mountPanel();
		panel.querySelector<HTMLButtonElement>('button[aria-label="Hide layers"]')!.click();
		expect(onclose).toHaveBeenCalledTimes(1);

		const escape = keydown(switches(panel)[0], 'Escape');
		expect(onclose).toHaveBeenCalledTimes(2);
		expect(escape.defaultPrevented).toBe(true);
	});
});

describe('LayersPopover, docked', () => {
	function mountDocked(panelOpen: boolean) {
		const target = host();
		const layers = new LayerState();
		const menu = new Dropdown();
		const onpanel = vi.fn();
		const component = mount(LayersPopover, {
			target,
			props: { layers, menu, docked: true, panelOpen, panelId: 'layers-panel', onpanel }
		});
		cleanups.push(() => unmount(component));
		const trigger = target.querySelector<HTMLButtonElement>('button.trigger')!;
		return { target, menu, onpanel, trigger };
	}

	it('shows and hides the side panel instead of opening a popover', () => {
		const { target, menu, onpanel, trigger } = mountDocked(false);
		expect(trigger.hasAttribute('aria-haspopup')).toBe(false);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(trigger.hasAttribute('aria-controls')).toBe(false);

		// A pointer click (detail 1) leaves the focus where it is.
		trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		flushSync();
		expect(onpanel).toHaveBeenLastCalledWith(true, false);
		expect(menu.open).toBe(false);
		expect(target.querySelector('[role="dialog"]')).toBeNull();
		expect(switches(target)).toHaveLength(0);
	});

	it('names the open panel, and a click hides it', () => {
		const { onpanel, trigger } = mountDocked(true);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(trigger.getAttribute('aria-controls')).toBe('layers-panel');
		trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(onpanel).toHaveBeenLastCalledWith(false, false);
	});

	it('asks for the focus to move in when opened from the keyboard', () => {
		const { onpanel, trigger } = mountDocked(false);
		// Enter and Space arrive as a click with detail 0.
		trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
		expect(onpanel).toHaveBeenLastCalledWith(true, true);

		const down = keydown(trigger, 'ArrowDown');
		expect(onpanel).toHaveBeenLastCalledWith(true, true);
		expect(down.defaultPrevented).toBe(true);
	});

	it('closes a popover left open when the layers move to the side panel', () => {
		const target = host();
		const layers = new LayerState();
		const menu = new Dropdown();
		const props = $state({ layers, menu, docked: false });
		const component = mount(LayersPopover, { target, props });
		cleanups.push(() => unmount(component));
		menu.show();
		flushSync();
		expect(target.querySelector('[role="dialog"]')).not.toBeNull();

		props.docked = true;
		flushSync();
		expect(menu.open).toBe(false);
		expect(target.querySelector('[role="dialog"]')).toBeNull();
	});
});
