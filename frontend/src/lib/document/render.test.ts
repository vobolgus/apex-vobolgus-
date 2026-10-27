import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRenderConfig, type ChartView } from '$lib/api/render-config';
import { LayerState } from '$lib/state/layers.svelte';
import { PRINT_MM_PER_PREVIEW_PX } from './geometry';
import {
	clearPreviewCache,
	documentRequest,
	exportDocument,
	itemPreviewUrl,
	itemRenderConfig,
	PAPER_STYLE,
	PREVIEW_CACHE_LIMIT,
	snapshotChart
} from './render';
import type { DocItem, DocPage } from './types';

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: { x: 0.1, y: -0.2, z: 0.3, w: 0.927 },
	stereoFovDeg: 160,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 16 / 9,
	pinholeHeightFrac: 1.18
};

const LAYERS = {
	constellations: true,
	constellationBoundaries: false,
	equator: true,
	ecliptic: false,
	galacticEquator: false,
	planets: true
};

const CREATED = '2026-10-27T12:00:00.000Z';

function stereoItem(frame = { x: 12, y: 12, w: 93, h: 93 }): DocItem {
	return {
		id: 'a',
		chart: { view: VIEW, layers: LAYERS, aspect: 1, createdAt: CREATED },
		frame
	};
}

function pinholeItem(): DocItem {
	const aspect = 16 / 9;
	return {
		id: 'b',
		chart: {
			view: { ...VIEW, projection: 'pinhole' },
			layers: LAYERS,
			aspect,
			createdAt: CREATED
		},
		frame: { x: 20, y: 120, w: 160, h: 160 / aspect },
		thumb: 'data:image/png;base64,AAAA'
	};
}

describe('snapshotChart', () => {
	it('copies the preview state, detached from the live objects', () => {
		const layers = new LayerState();
		layers.constellations = true;
		layers.planets = true;
		const view = { ...VIEW, orientation: { ...VIEW.orientation } };
		const chart = snapshotChart(view, layers, new Date(CREATED));
		expect(chart).toEqual({
			view: VIEW,
			layers: {
				constellations: true,
				constellationBoundaries: false,
				equator: false,
				ecliptic: false,
				galacticEquator: false,
				planets: true
			},
			aspect: 1,
			createdAt: CREATED
		});
		view.orientation.x = 0.9;
		layers.planets = false;
		expect(chart.view.orientation.x).toBe(0.1);
		expect(chart.layers.planets).toBe(true);
	});

	it('takes the pinhole frame aspect', () => {
		const chart = snapshotChart({ ...VIEW, projection: 'pinhole' }, LAYERS);
		expect(chart.aspect).toBe(16 / 9);
		expect(Number.isNaN(Date.parse(chart.createdAt))).toBe(false);
	});
});

describe('itemRenderConfig', () => {
	it("is the preview's config at the frame size in mm, stars fixed in mm, on paper", () => {
		const item = stereoItem();
		const preview = buildRenderConfig(VIEW, LAYERS, new Date(CREATED));
		expect(itemRenderConfig(item)).toEqual({
			...preview,
			view: { ...preview.view, width: 93, height: 93, px: PRINT_MM_PER_PREVIEW_PX },
			style: {
				...preview.style,
				background_color: 'none',
				chart_color: '#ffffff',
				chart_outline: '#c9ced6'
			}
		});
	});

	it('draws the planets at the time the chart was added', () => {
		expect(itemRenderConfig(stereoItem()).datetime).toBe(CREATED);
	});

	it('sizes a pinhole chart by its frame', () => {
		const item = pinholeItem();
		const config = itemRenderConfig(item);
		expect(config.projection).toBe('pinhole');
		expect(config.fov_deg).toBe(100);
		expect(config.view.width).toBe(160);
		expect(config.view.height).toBeCloseTo(90, 9);
	});

	it('leaves the item alone', () => {
		const item = stereoItem();
		const before = JSON.stringify(item);
		itemRenderConfig(item);
		expect(JSON.stringify(item)).toBe(before);
	});

	it('only adds px and the paper colours to what the preview sends', () => {
		const preview = buildRenderConfig(VIEW, LAYERS, new Date(CREATED));
		const config = itemRenderConfig(stereoItem());
		expect(Object.keys(config)).toEqual(Object.keys(preview));
		expect(Object.keys(config.view)).toEqual([...Object.keys(preview.view), 'px']);
		expect(Object.keys(config.style)).toEqual([...Object.keys(preview.style), 'chart_outline']);
		expect(config.layers).toEqual(preview.layers);
		expect(PAPER_STYLE).toEqual({
			background_color: 'none',
			chart_color: '#ffffff',
			chart_outline: '#c9ced6'
		});
	});
});

describe('documentRequest', () => {
	it('sends every page at its A4 size in mm and every chart at its frame', () => {
		const pages: DocPage[] = [
			{ id: 'p1', orientation: 'portrait', items: [stereoItem(), pinholeItem()] },
			{ id: 'p2', orientation: 'landscape', items: [] }
		];
		const body = documentRequest(pages);
		expect(body.pages).toHaveLength(2);
		expect(body.pages[0]).toMatchObject({ width_mm: 210, height_mm: 297 });
		expect(body.pages[1]).toEqual({ width_mm: 297, height_mm: 210, items: [] });
		expect(body.pages[0].items).toEqual([
			{
				x_mm: 12,
				y_mm: 12,
				width_mm: 93,
				height_mm: 93,
				config: itemRenderConfig(stereoItem())
			},
			{
				x_mm: 20,
				y_mm: 120,
				width_mm: 160,
				height_mm: 160 / (16 / 9),
				config: itemRenderConfig(pinholeItem())
			}
		]);
		// Thumbnails stay on this side.
		expect(JSON.stringify(body)).not.toContain('data:image');
	});
});

describe('backend calls', () => {
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

	describe('exportDocument', () => {
		it('posts the document and downloads one PDF', async () => {
			const fetchMock = mockFetch();
			const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', items: [stereoItem()] }];

			await expect(exportDocument(pages)).resolves.toBe(true);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('/api/export/document');
			expect(init.method).toBe('POST');
			expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
			expect(JSON.parse(init.body as string)).toEqual(documentRequest(pages));
			expect(click).toHaveBeenCalledTimes(1);
			const link = click.mock.contexts[0] as HTMLAnchorElement;
			expect(link.download).toMatch(/^skycharts-\d+\.pdf$/);
			expect(link.href).toBe(created[0]);
			expect(revoked).toEqual([created[0]]);
		});

		it('logs a failed export and downloads nothing', async () => {
			mockFetch(() => ({ ok: false, status: 400, text: async () => 'too many pages' }));
			const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});

			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', items: [] }];
			await expect(exportDocument(pages)).resolves.toBe(false);

			expect(click).not.toHaveBeenCalled();
			expect(error).toHaveBeenCalledTimes(1);
			expect(String(error.mock.calls[0][0])).toContain('400 too many pages');
		});

		it('does not call the backend for an empty document', async () => {
			const fetchMock = mockFetch();
			await expect(exportDocument([])).resolves.toBe(false);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('itemPreviewUrl', () => {
		it("fetches the chart's SVG with its config and returns an object URL", async () => {
			const fetchMock = mockFetch();
			const item = stereoItem();
			await expect(itemPreviewUrl(item)).resolves.toBe('blob:test/0');
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('/api/export?format=svg');
			expect(init.method).toBe('POST');
			expect(JSON.parse(init.body as string)).toEqual(itemRenderConfig(item));
		});

		it('caches by config: a move hits, a resize fetches again', async () => {
			const fetchMock = mockFetch();
			const first = await itemPreviewUrl(stereoItem({ x: 12, y: 12, w: 93, h: 93 }));
			const moved = await itemPreviewUrl(stereoItem({ x: 100, y: 150, w: 93, h: 93 }));
			expect(moved).toBe(first);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const resized = await itemPreviewUrl(stereoItem({ x: 12, y: 12, w: 120, h: 120 }));
			expect(resized).not.toBe(first);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('shares one request between concurrent callers', async () => {
			const fetchMock = mockFetch();
			const [a, b] = await Promise.all([
				itemPreviewUrl(stereoItem()),
				itemPreviewUrl(stereoItem())
			]);
			expect(a).toBe(b);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('revokes the least recently used preview beyond the cap', async () => {
			const fetchMock = mockFetch();
			const sized = (w: number) => stereoItem({ x: 12, y: 12, w, h: w });
			const firstUrl = await itemPreviewUrl(sized(40));
			for (let i = 1; i < PREVIEW_CACHE_LIMIT; i++) await itemPreviewUrl(sized(40 + i));
			// Touch the first so the second becomes the oldest.
			await itemPreviewUrl(sized(40));
			expect(revoked).toEqual([]);

			await itemPreviewUrl(sized(500));
			await Promise.resolve();
			expect(revoked).toEqual(['blob:test/1']);
			expect(fetchMock).toHaveBeenCalledTimes(PREVIEW_CACHE_LIMIT + 1);
			// The first is still cached, the evicted one is fetched again.
			await expect(itemPreviewUrl(sized(40))).resolves.toBe(firstUrl);
			await itemPreviewUrl(sized(41));
			expect(fetchMock).toHaveBeenCalledTimes(PREVIEW_CACHE_LIMIT + 2);
		});

		it('does not cache a failure', async () => {
			let fail = true;
			const fetchMock = mockFetch(() =>
				fail ? { ok: false, status: 502, text: async () => '' } : okResponse()
			);
			await expect(itemPreviewUrl(stereoItem())).rejects.toThrow('502');
			fail = false;
			await expect(itemPreviewUrl(stereoItem())).resolves.toBe('blob:test/0');
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('revokes every URL when the cache is cleared', async () => {
			mockFetch();
			await itemPreviewUrl(stereoItem());
			await itemPreviewUrl(pinholeItem());
			clearPreviewCache();
			await Promise.resolve();
			expect(revoked.sort()).toEqual(['blob:test/0', 'blob:test/1']);
		});
	});
});
