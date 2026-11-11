import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogLoad, type CatalogPart } from './catalog-load.svelte';

/** Loaders that answer when the test says so, each with whether its part arrived. */
function loaders() {
	const answers: Partial<Record<CatalogPart, (ok: boolean) => void>> = {};
	const asked: CatalogPart[] = [];
	const loader = (part: CatalogPart) => () => {
		asked.push(part);
		return new Promise<boolean>((resolve) => (answers[part] = resolve));
	};
	return {
		asked,
		answer: (part: CatalogPart, ok: boolean) => answers[part]?.(ok),
		set: {
			stars: loader('stars'),
			constellations: loader('constellations'),
			boundaries: loader('boundaries')
		}
	};
}

describe('CatalogLoad', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fetches every part at once and draws each as it arrives', async () => {
		const parts = loaders();
		const arrived = vi.fn();
		const load = new CatalogLoad(arrived, parts.set);

		const done = load.load();
		expect(parts.asked).toEqual(['stars', 'constellations', 'boundaries']);
		expect(load.loading).toBe(true);

		parts.answer('constellations', true);
		await vi.waitFor(() => expect(arrived).toHaveBeenCalledTimes(1));
		parts.answer('stars', true);
		parts.answer('boundaries', true);
		await done;
		expect(arrived).toHaveBeenCalledTimes(3);
		expect(load.loading).toBe(false);
		expect(load.failed).toEqual([]);
	});

	it('says it is loading only once the load is slow', async () => {
		const parts = loaders();
		const load = new CatalogLoad(() => {}, parts.set);

		const done = load.load();
		vi.advanceTimersByTime(499);
		expect(load.slow).toBe(false);
		vi.advanceTimersByTime(1);
		expect(load.slow).toBe(true);

		for (const part of ['stars', 'constellations', 'boundaries'] as const) parts.answer(part, true);
		await done;
		expect(load.slow).toBe(false);
	});

	it('keeps what did not arrive, says what it was, and tries only that again', async () => {
		const parts = loaders();
		const arrived = vi.fn();
		const load = new CatalogLoad(arrived, parts.set);

		const done = load.load();
		parts.answer('stars', true);
		parts.answer('constellations', false);
		parts.answer('boundaries', false);
		await done;
		expect(load.failed).toEqual(['constellations', 'boundaries']);
		expect(load.failure).toBe('Couldn’t load the constellation lines and boundaries.');

		parts.asked.length = 0;
		const retried = load.retry();
		expect(parts.asked).toEqual(['constellations', 'boundaries']);
		// A retry says it is loading at once: the notice does not blink away and back.
		expect(load.slow).toBe(true);
		parts.answer('constellations', true);
		parts.answer('boundaries', false);
		await retried;
		expect(load.failed).toEqual(['boundaries']);
		expect(load.failure).toBe('Couldn’t load the constellation boundaries.');
		expect(arrived).toHaveBeenCalledTimes(2);
	});

	it('names the star catalogue before anything else that failed', async () => {
		const parts = loaders();
		const load = new CatalogLoad(() => {}, parts.set);

		const done = load.load();
		parts.answer('stars', false);
		parts.answer('constellations', false);
		parts.answer('boundaries', true);
		await done;
		expect(load.failure).toBe('Couldn’t load the star catalogue.');

		const again = load.load(['constellations']);
		parts.answer('constellations', false);
		await again;
		expect(load.failure).toBe('Couldn’t load the constellation lines.');
	});
});
