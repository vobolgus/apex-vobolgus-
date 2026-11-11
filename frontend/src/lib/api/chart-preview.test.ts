import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartPreviewUrl, clearPreviewCache, PREVIEW_CACHE_LIMIT } from './chart-preview';
import { buildRenderConfig, type ViewRenderConfig } from './render-config';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const LAYERS = {
	constellations: true,
	constellationBoundaries: false,
	equator: true,
	ecliptic: false,
	galacticEquator: false,
	planets: true
};

/** What a chart `side` across is drawn from: all of it that matters here is that sizes differ. */
function sized(side: number): ViewRenderConfig {
	const view = {
		projection: 'stereographic' as const,
		orientation: { x: 0.1, y: -0.2, z: 0.3, w: 0.927 },
		stereoFovDeg: 160,
		pinholeFovDeg: 100,
		pinholeAspectRatio: 16 / 9,
		pinholeHeightFrac: 1.18
	};
	const config = buildRenderConfig(view, LAYERS, NOW);
	return { ...config, view: { ...config.view, width: side, height: side } };
}

describe('chartPreviewUrl', () => {
	let created: string[];
	let revoked: string[];
	const originalCreate = URL.createObjectURL;
	const originalRevoke = URL.revokeObjectURL;

	beforeEach(() => {
		created = [];
		revoked = [];
		URL.createObjectURL = () => {
			const url = `blob:test/${created.length}`;
			created.push(url);
			return url;
		};
		URL.revokeObjectURL = (url: string) => {
			revoked.push(url);
		};
	});

	afterEach(async () => {
		// Revocation waits for the request: let it land before the stubs go.
		clearPreviewCache();
		await new Promise((resolve) => setTimeout(resolve, 0));
		URL.createObjectURL = originalCreate;
		URL.revokeObjectURL = originalRevoke;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function okResponse(text = '<svg/>') {
		return { ok: true, status: 200, blob: async () => new Blob([text]), text: async () => text };
	}

	function mockFetch(
		respond: (url: string, init: RequestInit) => unknown = () => okResponse()
	): ReturnType<typeof vi.fn> {
		const fetchMock = vi.fn(async (url: string, init: RequestInit) => respond(url, init));
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it("fetches the chart's SVG with its config and returns an object URL", async () => {
		const fetchMock = mockFetch();
		const config = sized(93);
		await expect(chartPreviewUrl(config)).resolves.toBe('blob:test/0');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/export?format=svg');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual(config);
	});

	it('caches by config: the same again hits, another size fetches again', async () => {
		const fetchMock = mockFetch();
		const first = await chartPreviewUrl(sized(93));
		const again = await chartPreviewUrl(sized(93));
		expect(again).toBe(first);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const resized = await chartPreviewUrl(sized(120));
		expect(resized).not.toBe(first);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('shares one request between concurrent callers', async () => {
		const fetchMock = mockFetch();
		const [a, b] = await Promise.all([chartPreviewUrl(sized(93)), chartPreviewUrl(sized(93))]);
		expect(a).toBe(b);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('revokes the least recently used preview beyond the cap', async () => {
		const fetchMock = mockFetch();
		const firstUrl = await chartPreviewUrl(sized(40));
		for (let i = 1; i < PREVIEW_CACHE_LIMIT; i++) await chartPreviewUrl(sized(40 + i));
		// Touch the first so the second becomes the oldest.
		await chartPreviewUrl(sized(40));
		expect(revoked).toEqual([]);

		await chartPreviewUrl(sized(500));
		await Promise.resolve();
		expect(revoked).toEqual(['blob:test/1']);
		expect(fetchMock).toHaveBeenCalledTimes(PREVIEW_CACHE_LIMIT + 1);
		// The first is still cached, the evicted one is fetched again.
		await expect(chartPreviewUrl(sized(40))).resolves.toBe(firstUrl);
		await chartPreviewUrl(sized(41));
		expect(fetchMock).toHaveBeenCalledTimes(PREVIEW_CACHE_LIMIT + 2);
	});

	it('keeps an evicted URL that an image still shows until none does', async () => {
		mockFetch();
		const shown = { images: [{ src: 'blob:test/0' }] };
		vi.stubGlobal('document', shown);
		for (let i = 0; i <= PREVIEW_CACHE_LIMIT; i++) await chartPreviewUrl(sized(40 + i));
		await Promise.resolve();
		// The oldest went out of the cache, but a page still draws it.
		expect(revoked).toEqual([]);

		shown.images = [];
		await chartPreviewUrl(sized(500));
		await Promise.resolve();
		expect(revoked).toEqual(['blob:test/0', 'blob:test/1']);
	});

	it('does not cache a failure', async () => {
		let fail = true;
		const fetchMock = mockFetch(() =>
			fail ? { ok: false, status: 502, text: async () => '' } : okResponse()
		);
		await expect(chartPreviewUrl(sized(93))).rejects.toThrow('502');
		fail = false;
		await expect(chartPreviewUrl(sized(93))).resolves.toBe('blob:test/0');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('revokes every URL when the cache is cleared', async () => {
		mockFetch();
		await chartPreviewUrl(sized(93));
		await chartPreviewUrl({ ...sized(160), projection: 'pinhole' });
		clearPreviewCache();
		await Promise.resolve();
		expect(revoked.sort()).toEqual(['blob:test/0', 'blob:test/1']);
	});
});
