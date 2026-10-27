// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Switch from './Switch.svelte';

describe('Switch', () => {
	it('reflects checked in aria-checked and reports the next value', () => {
		const target = document.createElement('div');
		const onchange = vi.fn((checked: boolean) => {
			props.checked = checked;
		});
		const props = $state({ label: 'Ecliptic', checked: false, onchange });
		const component = mount(Switch, { target, props });

		const button = target.querySelector<HTMLButtonElement>('button[role="switch"]')!;
		expect(button.getAttribute('aria-checked')).toBe('false');

		button.click();
		flushSync();
		expect(onchange).toHaveBeenLastCalledWith(true);
		expect(button.getAttribute('aria-checked')).toBe('true');

		button.click();
		flushSync();
		expect(onchange).toHaveBeenLastCalledWith(false);
		expect(button.getAttribute('aria-checked')).toBe('false');

		unmount(component);
	});

	it('is named by its label and described by its note', () => {
		const target = document.createElement('div');
		const component = mount(Switch, {
			target,
			props: { label: 'Planets', note: 'SVG/PDF only', checked: false, onchange: () => {} }
		});

		const button = target.querySelector<HTMLButtonElement>('button[role="switch"]')!;
		const labelledBy = button.getAttribute('aria-labelledby')!;
		const describedBy = button.getAttribute('aria-describedby')!;
		expect(target.querySelector(`[id="${labelledBy}"]`)?.textContent).toBe('Planets');
		expect(target.querySelector(`[id="${describedBy}"]`)?.textContent).toBe('SVG/PDF only');

		unmount(component);
	});

	it('does not report changes while disabled', () => {
		const target = document.createElement('div');
		const onchange = vi.fn();
		const component = mount(Switch, {
			target,
			props: { label: 'Ecliptic', checked: false, onchange, disabled: true }
		});

		target.querySelector<HTMLButtonElement>('button')!.click();
		flushSync();
		expect(onchange).not.toHaveBeenCalled();

		unmount(component);
	});
});
