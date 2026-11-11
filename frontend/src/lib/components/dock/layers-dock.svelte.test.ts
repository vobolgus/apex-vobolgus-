import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown } from '$lib/ui/dropdown.svelte';
import { LayersDock } from './layers-dock.svelte';

const KEY = 'skycharts.layers.panel';

function memory(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value)
	};
}

const blocked = () => {
	throw new DOMException('The operation is insecure.', 'SecurityError');
};

describe('LayersDock', () => {
	it('opens as it was left, and remembers each change for the next visit', async () => {
		const storage = memory({ [KEY]: '1' });
		const dock = new LayersDock(new Dropdown(), () => storage);
		dock.restore();
		expect(dock.open).toBe(true);

		await dock.set(false);
		expect(dock.open).toBe(false);
		expect(storage.data.get(KEY)).toBe('0');
	});

	it('starts closed and still opens where storage is blocked', async () => {
		const dock = new LayersDock(new Dropdown(), blocked);
		dock.restore();
		expect(dock.open).toBe(false);
		await dock.set(true);
		expect(dock.open).toBe(true);
	});

	it('puts the focus on the first switch when opened from the keyboard', async () => {
		const dock = new LayersDock(new Dropdown(), () => memory());
		const panel = { focusFirst: vi.fn(), hasFocus: () => false };
		dock.panel = panel;

		await dock.set(true);
		expect(panel.focusFirst).not.toHaveBeenCalled();
		await dock.set(true, true);
		expect(panel.focusFirst).toHaveBeenCalledTimes(1);
	});

	it('gives the focus back to the Layers button when the panel closes with it inside', async () => {
		const menu = new Dropdown();
		const trigger = document.createElement('button');
		document.body.append(trigger);
		menu.trigger = trigger;
		const dock = new LayersDock(menu, () => memory());
		let focusInside = true;
		dock.panel = { focusFirst: () => {}, hasFocus: () => focusInside };

		await dock.set(true);
		dock.close();
		await tick();
		expect(dock.open).toBe(false);
		expect(document.activeElement).toBe(trigger);

		trigger.blur();
		focusInside = false;
		await dock.set(true);
		dock.close();
		expect(document.activeElement).not.toBe(trigger);
		trigger.remove();
	});
});
