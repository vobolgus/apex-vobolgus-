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
	snapshotChart,
	textRequest
} from './render';
import { DEFAULT_TEXT_STYLE, FONT_METRICS, LINE_HEIGHT, MM_PER_PT, NO_VALUE } from './text';
import type { DocItem, DocPage, DocText } from './types';

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

describe('marks', () => {
	it('sends the places ringed on a chart, and no marks at all for a chart with none', () => {
		expect(itemRenderConfig(stereoItem())).not.toHaveProperty('marks');
		const item = stereoItem();
		item.chart = { ...item.chart, marks: [{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }] };
		expect(itemRenderConfig(item).marks).toEqual([
			{ ra_deg: 56.85, dec_deg: 24.12, radius_deg: 10 }
		]);
		// The rest of the config is what it is without them: the mark is all that differs.
		const { marks: _marks, ...rest } = itemRenderConfig(item);
		expect(rest).toEqual(itemRenderConfig(stereoItem()));
		expect(itemRenderConfig({ ...item, chart: { ...item.chart, marks: [] } })).not.toHaveProperty(
			'marks'
		);
	});
});

describe('textRequest', () => {
	/** Half a font size a character. */
	const measure = (line: string) => Array.from(line).length / 2;
	const size = 12 * MM_PER_PT;
	const lineHeight = size * LINE_HEIGHT;
	const { ascent, descent } = FONT_METRICS.serif;
	const first = ((LINE_HEIGHT - ascent - descent) / 2 + ascent) * size;

	function text(overrides: Partial<DocText> = {}): DocText {
		return {
			id: 't',
			text: 'one two three',
			style: { ...DEFAULT_TEXT_STYLE },
			// Room for seven characters a line.
			frame: { x: 20, y: 100, w: 3.5 * size, h: 10 },
			...overrides
		};
	}

	const page = (items: DocItem[] = []): DocPage => ({ id: 'p', orientation: 'portrait', items });

	it("sends each line where its baseline starts, in the text's font and size", () => {
		const request = textRequest(page(), text(), measure);
		expect(request).toMatchObject({ font: 'serif', bold: false, italic: false, anchor: 'start' });
		expect(request.size_mm).toBeCloseTo(size);
		expect(request.lines.map((line) => line.text)).toEqual(['one two', 'three']);
		expect(request.lines[0].x_mm).toBe(20);
		expect(request.lines[0].y_mm).toBeCloseTo(100 + first);
		expect(request.lines[1].y_mm).toBeCloseTo(100 + first + lineHeight);
	});

	it('anchors centred and right-aligned lines at the middle and the end of the frame', () => {
		const style = { ...DEFAULT_TEXT_STYLE, font: 'sans' as const, bold: true, italic: true };
		const centred = textRequest(page(), text({ style: { ...style, align: 'center' } }), measure);
		expect(centred).toMatchObject({ font: 'sans', bold: true, italic: true, anchor: 'middle' });
		expect(centred.lines[0].x_mm).toBeCloseTo(20 + (3.5 * size) / 2);
		const right = textRequest(page(), text({ style: { ...style, align: 'right' } }), measure);
		expect(right.anchor).toBe('end');
		expect(right.lines[0].x_mm).toBeCloseTo(20 + 3.5 * size);
	});

	it("reads the fields from the page's chart, and wraps what they say", () => {
		const wide = { x: 20, y: 100, w: 150, h: 10 };
		const filled = textRequest(
			page([stereoItem()]),
			text({ text: 'FOV {fov}', frame: wide }),
			measure
		);
		expect(filled.lines.map((line) => line.text)).toEqual(['FOV 160°']);
		const empty = textRequest(page(), text({ text: 'FOV {fov}', frame: wide }), measure);
		expect(empty.lines.map((line) => line.text)).toEqual([`FOV ${NO_VALUE}`]);
	});

	it('sends the lines upright, with the turn to make about the centre of the text', () => {
		const upright = textRequest(page(), text(), measure);
		expect(upright).toMatchObject({ rotation_deg: 0 });
		expect(upright.cx_mm).toBeCloseTo(20 + (3.5 * size) / 2);
		expect(upright.cy_mm).toBeCloseTo(100 + lineHeight);

		// Stored one line high, laid out two: it grows from its own top-left, the centre with it.
		const stored = { x: 20, y: 100, w: 3.5 * size, h: lineHeight };
		const turned = textRequest(page(), text({ frame: stored, rotation: 90 }), measure);
		expect(turned.rotation_deg).toBe(90);
		expect(turned.lines.map((line) => line.text)).toEqual(['one two', 'three']);
		const corner = {
			x: 20 + (3.5 * size) / 2 + lineHeight / 2,
			y: 100 + lineHeight / 2 - (3.5 * size) / 2
		};
		// The top-left corner of the lines, turned about the centre sent, is where it was.
		const dx = turned.lines[0].x_mm - turned.cx_mm;
		const dy = turned.lines[0].y_mm - first - turned.cy_mm;
		expect(turned.cx_mm - dy).toBeCloseTo(corner.x);
		expect(turned.cy_mm + dx).toBeCloseTo(corner.y);
	});

	it('keeps the lines a turn brings onto the page, and leaves out those it takes off', () => {
		// Down the left margin: upright, its lines would start 100 mm off the page.
		const frame = { x: 15 - 120, y: 148, w: 240, h: lineHeight };
		const down = textRequest(page(), text({ text: 'margin', frame, rotation: -90 }), measure);
		expect(down.lines).toHaveLength(1);
		expect(down.lines[0].x_mm).toBeLessThan(0);
		const flat = textRequest(page(), text({ text: 'margin', frame }), measure);
		expect(flat.lines).toEqual([]);
	});

	it('leaves out blank lines and lines off the foot of the page', () => {
		const blank = textRequest(page(), text({ text: 'one\n\ntwo' }), measure);
		expect(blank.lines.map((line) => line.text)).toEqual(['one', 'two']);
		expect(blank.lines[1].y_mm).toBeCloseTo(100 + first + 2 * lineHeight);
		const low = textRequest(
			page(),
			text({
				text: 'one\ntwo\nthree',
				frame: { x: 20, y: 297 - first - lineHeight - 0.1, w: 80, h: 10 }
			}),
			measure
		);
		expect(low.lines.map((line) => line.text)).toEqual(['one', 'two']);
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
		expect(body.pages[1]).toEqual({ width_mm: 297, height_mm: 210, items: [], texts: [] });
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

			await expect(exportDocument(pages)).resolves.toEqual({ ok: true });

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

		it('logs a failed export, downloads nothing and passes on why it was refused', async () => {
			mockFetch(() => ({ ok: false, status: 400, text: async () => 'too many pages' }));
			const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});

			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', items: [] }];
			await expect(exportDocument(pages)).resolves.toEqual({
				ok: false,
				message: 'too many pages'
			});

			expect(click).not.toHaveBeenCalled();
			expect(error).toHaveBeenCalledTimes(1);
			expect(String(error.mock.calls[0][0])).toContain('400 too many pages');
		});

		it("reads the refusal out of the proxy's JSON error", async () => {
			const body = JSON.stringify({ message: 'a document needs 1 to 100 pages, got 101' });
			mockFetch(() => ({ ok: false, status: 400, text: async () => body }));
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', items: [] }];
			await expect(exportDocument(pages)).resolves.toEqual({
				ok: false,
				message: 'a document needs 1 to 100 pages, got 101'
			});
		});

		it('has no reason to give when the backend failed or is away', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', items: [] }];
			mockFetch(() => ({ ok: false, status: 500, text: async () => 'PDF conversion error' }));
			await expect(exportDocument(pages)).resolves.toEqual({ ok: false, message: null });
			mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
			await expect(exportDocument(pages)).resolves.toEqual({ ok: false, message: null });
		});

		it('does not call the backend for an empty document', async () => {
			const fetchMock = mockFetch();
			await expect(exportDocument([])).resolves.toEqual({ ok: false, message: null });
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

		it('keeps an evicted URL that an image still shows until none does', async () => {
			mockFetch();
			const shown = { images: [{ src: 'blob:test/0' }] };
			vi.stubGlobal('document', shown);
			const sized = (w: number) => stereoItem({ x: 12, y: 12, w, h: w });
			for (let i = 0; i <= PREVIEW_CACHE_LIMIT; i++) await itemPreviewUrl(sized(40 + i));
			await Promise.resolve();
			// The oldest went out of the cache, but a page still draws it.
			expect(revoked).toEqual([]);

			shown.images = [];
			await itemPreviewUrl(sized(500));
			await Promise.resolve();
			expect(revoked).toEqual(['blob:test/0', 'blob:test/1']);
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
