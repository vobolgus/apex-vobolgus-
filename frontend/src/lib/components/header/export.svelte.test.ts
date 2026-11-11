import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportResult } from '$lib/api/export';
import type { ChartLayers, ChartView } from '$lib/api/render-config';
import type { DocumentStore } from '$lib/document/document.svelte';
import type { DocumentExportResult } from '$lib/document/render';
import { ToastStore } from '$lib/ui/toast.svelte';
import { ExportController, withExportProgress, type ExportHost } from './export.svelte';

const exportChart = vi.hoisted(() => vi.fn<() => Promise<ExportResult>>());
const exportDocument = vi.hoisted(() => vi.fn<() => Promise<DocumentExportResult>>());
vi.mock('$lib/api/export', () => ({ exportChart }));
vi.mock('$lib/document/render', () => ({ exportDocument }));

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: { x: 0, y: 0, z: 0, w: 1 },
	stereoFovDeg: 120,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 1.6,
	pinholeHeightFrac: 1.18
};

const NO_LAYERS: ChartLayers = {
	constellations: false,
	constellationBoundaries: false,
	equator: false,
	ecliptic: false,
	galacticEquator: false,
	planets: false
};

/** A promise and the hand that settles it. */
function later<T>() {
	let settle: (value: T) => void = () => {};
	const promise = new Promise<T>((resolve) => (settle = resolve));
	return { promise, settle };
}

function exporterWith(pageCount = 0) {
	const toast = new ToastStore();
	const said: string[] = [];
	const document = { pageCount, pages: [] } as unknown as DocumentStore;
	const host: ExportHost = {
		canvas: null,
		chartView: VIEW,
		layers: NO_LAYERS,
		document,
		announce: (message) => said.push(message)
	};
	return { exporter: new ExportController(host, toast), toast, said, document };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('withExportProgress', () => {
	it('says nothing of an export that is quick and works', async () => {
		const toast = new ToastStore();
		const result = await withExportProgress(
			toast,
			'Preparing…',
			async () => ({ ok: true }),
			() => 'failed'
		);
		expect(result.ok).toBe(true);
		expect(toast.current).toBeNull();
	});

	it('holds a toast while a slow export runs, then takes it down', async () => {
		const toast = new ToastStore();
		const run = later<{ ok: boolean }>();
		const done = withExportProgress(
			toast,
			'Preparing the SVG…',
			() => run.promise,
			() => 'failed'
		);
		vi.advanceTimersByTime(599);
		expect(toast.current).toBeNull();
		vi.advanceTimersByTime(1);
		expect(toast.current?.message).toBe('Preparing the SVG…');
		run.settle({ ok: true });
		await done;
		expect(toast.current).toBeNull();
	});

	it('says why it failed', async () => {
		const toast = new ToastStore();
		await withExportProgress(
			toast,
			'Preparing…',
			async () => ({ ok: false, reason: 'busy' }),
			(result) => `Couldn’t: ${result.reason}`
		);
		expect(toast.current?.message).toBe('Couldn’t: busy');
	});

	it('brings back an Undo the progress covered, unless something newer took its place', async () => {
		const toast = new ToastStore();
		const undo = vi.fn();
		toast.show('Page deleted', undo);
		const run = later<{ ok: boolean }>();
		const done = withExportProgress(
			toast,
			'Preparing…',
			() => run.promise,
			() => 'failed'
		);
		vi.advanceTimersByTime(600);
		run.settle({ ok: true });
		await done;
		expect(toast.current?.message).toBe('Page deleted');
		expect(toast.current?.undo).toBe(undo);

		const again = later<{ ok: boolean }>();
		const second = withExportProgress(
			toast,
			'Preparing…',
			() => again.promise,
			() => 'failed'
		);
		vi.advanceTimersByTime(600);
		toast.show('Something newer');
		again.settle({ ok: true });
		await second;
		expect(toast.current?.message).toBe('Something newer');
	});
});

describe('ExportController', () => {
	it('saves a PNG at once and says so on the button and aloud for a moment', async () => {
		const { exporter, said } = exporterWith();
		exportChart.mockResolvedValue({ ok: true });
		await exporter.run('PNG');
		expect(exportChart).toHaveBeenCalledWith(null, 'PNG', expect.any(Function));
		expect(exporter.phase).toBe('done');
		expect(said).toEqual(['PNG saved']);
		vi.advanceTimersByTime(1400);
		expect(exporter.phase).toBe('idle');
	});

	it('says when a PNG could not be saved', async () => {
		const { exporter, toast } = exporterWith();
		exportChart.mockResolvedValue({ ok: false });
		await exporter.run('PNG');
		expect(toast.current?.message).toBe('Couldn’t save the PNG. Try again in a moment.');
		expect(exporter.phase).toBe('idle');
	});

	it('turns its ring for a slow SVG, and starts no second one meanwhile', async () => {
		const { exporter, said } = exporterWith();
		const run = later<ExportResult>();
		exportChart.mockReturnValue(run.promise);
		const first = exporter.run('SVG');
		vi.advanceTimersByTime(349);
		expect(exporter.phase).toBe('idle');
		vi.advanceTimersByTime(1);
		expect(exporter.phase).toBe('busy');

		await exporter.run('PDF');
		expect(exportChart).toHaveBeenCalledTimes(1);

		run.settle({ ok: true });
		await first;
		expect(exporter.phase).toBe('done');
		expect(said).toEqual(['SVG saved']);
	});

	it('goes back to its icon when an SVG fails, with the failure in the toast', async () => {
		const { exporter, toast } = exporterWith();
		exportChart.mockResolvedValue({ ok: false });
		await exporter.run('SVG');
		expect(exporter.phase).toBe('idle');
		expect(toast.current?.message).toBe('Couldn’t export the SVG. Try again in a moment.');
	});

	it('keeps the format chosen in the menu for the button, closes the menu and saves', async () => {
		const { exporter } = exporterWith();
		exportChart.mockResolvedValue({ ok: true });
		exporter.menu.show();
		exporter.choose('SVG');
		expect(exporter.format).toBe('SVG');
		expect(exporter.menu.open).toBe(false);
		await vi.waitFor(() =>
			expect(exportChart).toHaveBeenCalledWith(null, 'SVG', expect.any(Function))
		);
	});

	it('exports the document only when there is one, with its row off meanwhile', async () => {
		const empty = exporterWith(0);
		expect(empty.exporter.documentEmpty).toBe(true);
		expect(empty.exporter.documentNote).toBe('Add a chart first');
		await empty.exporter.runDocument();
		expect(exportDocument).not.toHaveBeenCalled();

		const { exporter, toast } = exporterWith(2);
		expect(exporter.documentNote).toBe('2 pages · A4');
		const run = later<DocumentExportResult>();
		exportDocument.mockReturnValue(run.promise);
		const done = exporter.runDocument();
		expect(exporter.documentExporting).toBe(true);
		expect(exporter.documentNote).toBe('Preparing…');
		await exporter.runDocument();
		expect(exportDocument).toHaveBeenCalledTimes(1);

		// A refusal names its reason: trying again would not help.
		run.settle({ ok: false, message: 'Too many charts' });
		await done;
		expect(exporter.documentExporting).toBe(false);
		expect(toast.current?.message).toBe('Couldn’t export the PDF: Too many charts');
	});
});
