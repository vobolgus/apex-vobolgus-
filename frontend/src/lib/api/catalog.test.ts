import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '$lib/stores.svelte';
import { loadConstellations, loadStars } from './catalog';

const BRIGHT = [{ ra: 1.7, dec: -0.29, v_mag: -1.44 }];
const FULL = [...BRIGHT, { ra: 0.5, dec: 0.3, v_mag: 6.1 }];

/** A response that arrives when `release` is called. */
function deferred(body: unknown, status = 200) {
	let release = () => {};
	const promise = new Promise<Response>((resolve) => {
		release = () => resolve(new Response(JSON.stringify(body), { status }));
	});
	return { promise, release };
}

describe('loadStars', () => {
	beforeEach(() => {
		catalog.stars = [];
		catalog.starVectors = [];
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function stubFetch(bright: Promise<Response>, full: Promise<Response>) {
		const fetchMock = vi.fn((url: string) => (url.includes('/bright') ? bright : full));
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('draws the bright stars first, then the full catalogue', async () => {
		const bright = deferred(BRIGHT);
		const full = deferred(FULL);
		const fetchMock = stubFetch(bright.promise, full.promise);
		const onStars = vi.fn();

		const loaded = loadStars(onStars);
		// Both requests are out before either answers, and the full one names no limit.
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			'/api/catalog/bright',
			'/api/catalog/full'
		]);

		bright.release();
		await vi.waitFor(() => expect(onStars).toHaveBeenCalledTimes(1));
		expect(catalog.stars).toHaveLength(1);
		expect(catalog.starVectors[0].v_mag).toBe(-1.44);

		full.release();
		await expect(loaded).resolves.toBe(true);
		expect(onStars).toHaveBeenCalledTimes(2);
		expect(catalog.stars).toHaveLength(2);
		expect(catalog.starVectors).toHaveLength(2);
	});

	it('drops the bright stars when the full catalogue is there first (the HTTP cache)', async () => {
		const bright = deferred(BRIGHT);
		const full = deferred(FULL);
		stubFetch(bright.promise, full.promise);
		const onStars = vi.fn();

		const loaded = loadStars(onStars);
		full.release();
		await expect(loaded).resolves.toBe(true);
		bright.release();
		await bright.promise;
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(onStars).toHaveBeenCalledTimes(1);
		expect(catalog.stars).toHaveLength(2);
	});

	it('reports a failed full load, keeping the bright stars it got', async () => {
		const bright = deferred(BRIGHT);
		const full = deferred('down', 502);
		stubFetch(bright.promise, full.promise);

		const loaded = loadStars();
		bright.release();
		await vi.waitFor(() => expect(catalog.stars).toHaveLength(1));
		full.release();
		await expect(loaded).resolves.toBe(false);
		expect(catalog.stars).toHaveLength(1);
	});

	it('reports a backend that cannot be reached', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
		);
		await expect(loadStars()).resolves.toBe(false);
		await expect(loadConstellations()).resolves.toBe(false);
		expect(catalog.stars).toHaveLength(0);
	});
});
