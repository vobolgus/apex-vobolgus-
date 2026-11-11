import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartLayers, ChartView } from '$lib/api/render-config';
import { DocumentStore, MAX_CHARTS } from '$lib/document/document.svelte';
import { memoryStorage } from '$lib/document/test-support';
import { chartBoxOnScreen, PDF_FLIGHT_MS, type Box, type LandingTarget } from './flight';
import { PdfFlight, type FlightPanel, type PdfFlightHost } from './pdf-flight.svelte';

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: { x: 0, y: 0, z: 0, w: 1 },
	stereoFovDeg: 120,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 1.6,
	pinholeHeightFrac: 1.18
};

const LAYERS: ChartLayers = {
	constellations: true,
	constellationBoundaries: false,
	equator: false,
	ecliptic: false,
	galacticEquator: false,
	planets: false
};

const CANVAS_BOX: Box = { x: 100, y: 80, width: 600, height: 600 };
const TARGET: LandingTarget = { box: { x: 20, y: 300, width: 60, height: 60 }, corner: '50%' };

/** A preview canvas on screen that can be animated, as a browser's is. */
function previewCanvas(): HTMLCanvasElement {
	return {
		getBoundingClientRect: () => CANVAS_BOX,
		animate: () => undefined
	} as unknown as HTMLCanvasElement;
}

/** A pages panel whose `reveal` answers when the test says so. */
function panel(target: LandingTarget | null = TARGET) {
	let answer: () => void = () => {};
	const reveal = vi.fn(
		() =>
			new Promise<LandingTarget | null>((resolve) => {
				answer = () => resolve(target);
			})
	);
	const boxes = { 'chart-1': { x: 1, y: 2, width: 3, height: 4 } };
	const it: FlightPanel = { reveal, chartBoxes: () => boxes };
	return { it, reveal, boxes, answer: () => answer() };
}

function setup(canvas: HTMLCanvasElement | null = previewCanvas(), pages = panel()) {
	const store = new DocumentStore(memoryStorage());
	const said: string[] = [];
	const toasts: { message: string; undo?: () => void }[] = [];
	const host: PdfFlightHost = {
		store,
		canvas,
		chartView: VIEW,
		layers: LAYERS,
		panel: pages.it,
		announce: (message) => said.push(message),
		notify: (message, undo) => toasts.push({ message, undo })
	};
	return { flight: new PdfFlight(host), store, said, toasts, pages };
}

beforeEach(() => {
	// The thumbnail is cut from the canvas; jsdom draws nothing.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe('PdfFlight.add', () => {
	it('puts the chart on a page, shows it there and offers to take it back', async () => {
		const { flight, store, said, toasts, pages } = setup();
		flight.add();
		const [page] = store.pages;
		const [block] = page.blocks;
		expect(store.selectedPageId).toBe(page.id);
		expect(said).toEqual(['Added to page 1']);
		expect(toasts.map((toast) => toast.message)).toEqual(['Added to page 1']);
		// Its place stays empty until the copy lands there.
		expect(flight.pendingId).toBe(block.id);
		expect(pages.reveal).toHaveBeenCalledWith(page.id, {
			itemId: block.id,
			newPage: true,
			ms: PDF_FLIGHT_MS,
			before: pages.boxes
		});

		pages.answer();
		await vi.waitFor(() => expect(flight.copy).not.toBeNull());
		expect(flight.copy).toMatchObject({
			id: 1,
			from: chartBoxOnScreen(CANVAS_BOX, block.kind === 'chart' ? block.chart.view : VIEW),
			to: TARGET.box,
			corner: TARGET.corner
		});

		toasts[0].undo?.();
		expect(flight.pendingId).toBeNull();
		expect(flight.copy).toBeNull();
		expect(store.pages).toEqual([]);
		expect(said.at(-1)).toBe('Add to PDF undone');
	});

	it('lands the copy: the thumbnail draws the chart, and the copy goes an update later', async () => {
		const { flight, pages } = setup();
		flight.add();
		pages.answer();
		await vi.waitFor(() => expect(flight.copy).not.toBeNull());

		const landing = flight.land();
		expect(flight.pendingId).toBeNull();
		expect(flight.copy).not.toBeNull();
		await landing;
		expect(flight.copy).toBeNull();
	});

	it('brings a copy still in the air down at once on the next Add', async () => {
		const { flight, pages } = setup();
		flight.add();
		pages.answer();
		await vi.waitFor(() => expect(flight.copy?.id).toBe(1));

		flight.add();
		await tick();
		expect(flight.copy).toBeNull();
		pages.answer();
		await vi.waitFor(() => expect(flight.copy?.id).toBe(2));
	});

	it('only reveals the page when nothing can fly: no canvas on screen', async () => {
		const { flight, store, pages } = setup(null);
		flight.add();
		expect(flight.pendingId).toBeNull();
		expect(pages.reveal).toHaveBeenCalledWith(store.pages[0].id, undefined);
		pages.answer();
		await tick();
		expect(flight.copy).toBeNull();
	});

	it('gives the chart its place back when the panel has nowhere to land it', async () => {
		const pages = panel(null);
		const { flight } = setup(previewCanvas(), pages);
		flight.add();
		expect(flight.pendingId).not.toBeNull();
		pages.answer();
		await vi.waitFor(() => expect(flight.pendingId).toBeNull());
		expect(flight.copy).toBeNull();
	});

	it('adds nothing past what the backend takes', () => {
		const { flight, store, toasts, pages } = setup(null);
		for (let i = 0; i < MAX_CHARTS; i++) flight.add();
		const charts = store.pages.flatMap((page) => page.blocks).length;
		toasts.length = 0;
		pages.reveal.mockClear();

		flight.add();
		expect(store.pages.flatMap((page) => page.blocks)).toHaveLength(charts);
		expect(toasts.map((toast) => toast.message)).toEqual([
			`The PDF document is full: it holds ${MAX_CHARTS} charts at most`
		]);
		expect(pages.reveal).not.toHaveBeenCalled();
	});
});
