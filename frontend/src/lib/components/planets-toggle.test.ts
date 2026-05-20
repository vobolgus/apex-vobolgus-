// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PlanetsToggle from './PlanetsToggle.svelte';

describe('PlanetsToggle', () => {
	it('mounts and toggles state correctly', () => {
		const target = document.createElement('div');
		const component = mount(PlanetsToggle, { target, props: { showPlanets: false } });

		const button = target.querySelector('button');
		expect(button).not.toBeNull();
		expect(button?.getAttribute('aria-checked')).toBe('false');

		button?.click();
		flushSync();
		expect(button?.getAttribute('aria-checked')).toBe('true');

		button?.click();
		flushSync();
		expect(button?.getAttribute('aria-checked')).toBe('false');

		unmount(component);
	});
});
