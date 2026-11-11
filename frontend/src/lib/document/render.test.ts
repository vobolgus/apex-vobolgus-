import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRenderConfig, type ChartView } from '$lib/api/render-config';
import { LayerState } from '$lib/state/layers.svelte';
import { PRINT_MM_PER_PREVIEW_PX } from './geometry';
import {
	clearPreviewCache,
	documentRequest,
	exportDocument,
	chartPreviewUrl,
	chartRenderConfig,
	PAPER_STYLE,
	PREVIEW_CACHE_LIMIT,
	snapshotChart,
	textRequest
} from './render';
import { DEFAULT_TEXT_STYLE, FONT_METRICS, LINE_HEIGHT, MM_PER_PT, NO_VALUE } from './text';
import type { ChartBlock, DocPage, TableBlock, TextBlock } from './types';

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

function stereoItem(frame = { x: 12, y: 12, w: 93, h: 93 }): ChartBlock {
	return {
		kind: 'chart',
		id: 'a',
		chart: { view: VIEW, layers: LAYERS, aspect: 1, createdAt: CREATED },
		frame
	};
}

function pinholeItem(): ChartBlock {
	const aspect = 16 / 9;
	return {
		kind: 'chart',
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

describe('chartRenderConfig', () => {
	it("is the preview's config at the frame size in mm, stars fixed in mm, on paper", () => {
		const item = stereoItem();
		const preview = buildRenderConfig(VIEW, LAYERS, new Date(CREATED));
		expect(chartRenderConfig(item)).toEqual({
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
		expect(chartRenderConfig(stereoItem()).datetime).toBe(CREATED);
	});

	it('sizes a pinhole chart by its frame', () => {
		const item = pinholeItem();
		const config = chartRenderConfig(item);
		expect(config.projection).toBe('pinhole');
		expect(config.fov_deg).toBe(100);
		expect(config.view.width).toBe(160);
		expect(config.view.height).toBeCloseTo(90, 9);
	});

	it('leaves the item alone', () => {
		const item = stereoItem();
		const before = JSON.stringify(item);
		chartRenderConfig(item);
		expect(JSON.stringify(item)).toBe(before);
	});

	it('only adds px and the paper colours to what the preview sends', () => {
		const preview = buildRenderConfig(VIEW, LAYERS, new Date(CREATED));
		const config = chartRenderConfig(stereoItem());
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
		expect(chartRenderConfig(stereoItem())).not.toHaveProperty('marks');
		const item = stereoItem();
		item.chart = { ...item.chart, marks: [{ raDeg: 56.85, decDeg: 24.12, radiusDeg: 10 }] };
		expect(chartRenderConfig(item).marks).toEqual([
			{ ra_deg: 56.85, dec_deg: 24.12, radius_deg: 10 }
		]);
		// The rest of the config is what it is without them: the mark is all that differs.
		const { marks: _marks, ...rest } = chartRenderConfig(item);
		expect(rest).toEqual(chartRenderConfig(stereoItem()));
		expect(chartRenderConfig({ ...item, chart: { ...item.chart, marks: [] } })).not.toHaveProperty(
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

	function text(overrides: Partial<TextBlock> = {}): TextBlock {
		return {
			kind: 'text',
			id: 't',
			text: 'one two three',
			style: { ...DEFAULT_TEXT_STYLE },
			// Room for seven characters a line.
			frame: { x: 20, y: 100, w: 3.5 * size, h: 10 },
			...overrides
		};
	}

	const page = (blocks: ChartBlock[] = []): DocPage => ({
		id: 'p',
		orientation: 'portrait',
		blocks
	});

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

describe('a table in the request', () => {
	const measure = (line: string) => Array.from(line).length / 2;
	const sky = {
		messier: [
			{
				m: 45,
				name: 'Pleiades',
				kind: 'Open Cluster',
				constellation: 'Tau',
				mag: 1.6,
				ra_deg: 0,
				dec_deg: 0
			}
		],
		stars: []
	};
	// A chart that takes in the whole sky but its far point: the object is on it wherever it looks.
	const everywhere = (): ChartBlock => {
		const item = stereoItem();
		return { ...item, chart: { ...item.chart, view: { ...VIEW, stereoFovDeg: 350 } } };
	};
	const table: TableBlock = {
		kind: 'table',
		id: 't',
		style: { font: 'sans', size: 10, bold: false, italic: false, align: 'left' },
		frame: { x: 20, y: 120, w: 150, h: 10 },
		table: { source: 'messier', look: 'details', rows: 5 }
	};
	const page = (): DocPage => ({ id: 'p', orientation: 'portrait', blocks: [everywhere()] });

	it('is sent a line a cell, each with its anchor and weight, and its rules', () => {
		const sent = textRequest(page(), table, measure, sky);
		expect(sent).toMatchObject({ font: 'sans', bold: false, anchor: 'start' });
		expect(sent.lines.map((line) => line.text)).toEqual([
			'Messier objects',
			'Object',
			'Name',
			'Type',
			'Constellation',
			'Mag',
			'M 45',
			'Pleiades',
			'Open Cluster',
			'Taurus',
			'1.6'
		]);
		// The title is bold in the middle of the table, the header bold under it.
		expect(sent.lines[0]).toMatchObject({ bold: true, anchor: 'middle' });
		expect(sent.lines[0].x_mm).toBeCloseTo(95);
		expect(sent.lines.slice(1, 6).every((line) => line.bold === true)).toBe(true);
		expect(sent.lines.slice(6).every((line) => line.bold === undefined)).toBe(true);
		expect(sent.lines[1]).toMatchObject({ x_mm: 20 });
		expect(sent.lines[1]).not.toHaveProperty('anchor');
		// The column of numbers is set from its right edge, the table's.
		expect(sent.lines[5]).toMatchObject({ anchor: 'end' });
		expect(sent.lines[5].x_mm).toBeCloseTo(170);
		expect(sent.lines[10]).toMatchObject({ anchor: 'end' });
		expect(sent.lines[10].y_mm).toBeGreaterThan(sent.lines[5].y_mm);
		// Three rules across the table, on the page where the table is.
		expect(sent.rules).toHaveLength(3);
		for (const rule of sent.rules!) {
			expect(rule).toMatchObject({ x1_mm: 20, x2_mm: 170 });
			expect(rule.y1_mm).toBe(rule.y2_mm);
			expect(rule.y1_mm).toBeGreaterThan(120);
			expect(rule.width_mm).toBeGreaterThan(0);
		}
		// Turned, it is sent upright with its turn, the rules with it.
		const turned = textRequest(page(), { ...table, rotation: 90 }, measure, sky);
		expect(turned.rotation_deg).toBe(90);
		expect(turned.rules).toHaveLength(3);
	});

	it('lists nothing without the catalogue, and a text has no rules at all', () => {
		const bare = textRequest(page(), table, measure);
		expect(bare.lines.at(-1)!.text).toBe('The catalogue is not loaded');

		// A table of names is its title and its names, each in the middle of its column, unruled.
		const names = textRequest(
			page(),
			{ ...table, table: { source: 'messier', rows: 5 } },
			measure,
			sky
		);
		expect(names.lines.map((line) => [line.text, line.anchor])).toEqual([
			['Messier objects', 'middle'],
			['M 45', 'middle']
		]);
		expect(names).not.toHaveProperty('rules');

		// A text on a page with no chart reads the one it is told on another page.
		const elsewhere: DocPage = { id: 'q', orientation: 'portrait', blocks: [] };
		const { id, style, frame } = table;
		const told: TextBlock = { kind: 'text', id, style, frame, text: 'FOV {fov}', chartId: 'a' };
		expect(textRequest(elsewhere, told, measure, sky).lines[0].text).toBe(`FOV ${NO_VALUE}`);
		expect(textRequest(elsewhere, told, measure, sky, [elsewhere, page()]).lines[0].text).toBe(
			'FOV 350°'
		);
		const whole = documentRequest([{ ...elsewhere, blocks: [told] }, page()], measure, sky);
		expect(whole.pages[0].texts[0].lines[0].text).toBe('FOV 350°');
		const hello: TextBlock = { kind: 'text', id, style, frame, text: 'Hello' };
		const words = textRequest(page(), hello, measure, sky);
		expect(words).not.toHaveProperty('rules');
		expect(words.lines).toEqual([expect.objectContaining({ text: 'Hello' })]);
		expect(words.lines[0]).not.toHaveProperty('bold');
		// The whole document is given the sky its tables read.
		const [sent] = documentRequest(
			[{ id: 'p', orientation: 'portrait', blocks: [everywhere(), table] }],
			measure,
			sky
		).pages;
		expect(sent.texts[0].lines).toHaveLength(11);
	});
});

describe('documentRequest', () => {
	it('sends every page at its A4 size in mm and every chart at its frame', () => {
		const pages: DocPage[] = [
			{ id: 'p1', orientation: 'portrait', blocks: [stereoItem(), pinholeItem()] },
			{ id: 'p2', orientation: 'landscape', blocks: [] }
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
				config: chartRenderConfig(stereoItem())
			},
			{
				x_mm: 20,
				y_mm: 120,
				width_mm: 160,
				height_mm: 160 / (16 / 9),
				config: chartRenderConfig(pinholeItem())
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
			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', blocks: [stereoItem()] }];

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

			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', blocks: [] }];
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
			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', blocks: [] }];
			await expect(exportDocument(pages)).resolves.toEqual({
				ok: false,
				message: 'a document needs 1 to 100 pages, got 101'
			});
		});

		it('has no reason to give when the backend failed or is away', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const pages: DocPage[] = [{ id: 'p', orientation: 'portrait', blocks: [] }];
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

	describe('chartPreviewUrl', () => {
		it("fetches the chart's SVG with its config and returns an object URL", async () => {
			const fetchMock = mockFetch();
			const item = stereoItem();
			await expect(chartPreviewUrl(item)).resolves.toBe('blob:test/0');
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('/api/export?format=svg');
			expect(init.method).toBe('POST');
			expect(JSON.parse(init.body as string)).toEqual(chartRenderConfig(item));
		});

		it('caches by config: a move hits, a resize fetches again', async () => {
			const fetchMock = mockFetch();
			const first = await chartPreviewUrl(stereoItem({ x: 12, y: 12, w: 93, h: 93 }));
			const moved = await chartPreviewUrl(stereoItem({ x: 100, y: 150, w: 93, h: 93 }));
			expect(moved).toBe(first);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const resized = await chartPreviewUrl(stereoItem({ x: 12, y: 12, w: 120, h: 120 }));
			expect(resized).not.toBe(first);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('shares one request between concurrent callers', async () => {
			const fetchMock = mockFetch();
			const [a, b] = await Promise.all([
				chartPreviewUrl(stereoItem()),
				chartPreviewUrl(stereoItem())
			]);
			expect(a).toBe(b);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('revokes the least recently used preview beyond the cap', async () => {
			const fetchMock = mockFetch();
			const sized = (w: number) => stereoItem({ x: 12, y: 12, w, h: w });
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
			const sized = (w: number) => stereoItem({ x: 12, y: 12, w, h: w });
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
			await expect(chartPreviewUrl(stereoItem())).rejects.toThrow('502');
			fail = false;
			await expect(chartPreviewUrl(stereoItem())).resolves.toBe('blob:test/0');
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('revokes every URL when the cache is cleared', async () => {
			mockFetch();
			await chartPreviewUrl(stereoItem());
			await chartPreviewUrl(pinholeItem());
			clearPreviewCache();
			await Promise.resolve();
			expect(revoked.sort()).toEqual(['blob:test/0', 'blob:test/1']);
		});
	});
});
