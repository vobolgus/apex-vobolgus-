/**
 * Saving the chart and the document. The chart goes out in the format the export
 * menu holds (a PNG straight off the canvas; an SVG or a PDF drawn by the backend
 * from the view as it is now), the document as one PDF. The export button shows
 * what is going on (its icon, a turning ring while a file is drawn, a check once
 * it is saved), and the toast says when an export is slow or did not work.
 *
 * Keyboard: ⌘K opens the format menu with the focus on the selected format, or
 * closes it; ↑/↓ (Home/End) move through it, kept from the window, where arrows
 * rotate the sky. ⌘S saves a PNG (both bound by the page, `$lib/shortcuts`).
 */

import { tick } from 'svelte';
import { exportChart, type ExportFormat } from '$lib/api/export';
import {
	buildRenderConfig,
	type ChartLayers,
	type ChartView,
	type RenderConfig
} from '$lib/api/render-config';
import type { DocumentStore } from '$lib/document/document.svelte';
import { plural } from '$lib/document/labels';
import { exportDocument } from '$lib/document/render';
import { Dropdown } from '$lib/ui/dropdown.svelte';
import { toast as pageToast, type ToastItem, type ToastStore } from '$lib/ui/toast.svelte';

/** The export menu: what each format is for, and its shortcut (⌘S always saves a PNG). */
export const EXPORT_OPTIONS = [
	{ format: 'PNG', note: 'For screens and sharing', keys: ['mod', 'S'] },
	{ format: 'SVG', note: 'Vector, editable', keys: [] },
	{ format: 'PDF', note: 'For print', keys: [] }
] as const satisfies readonly {
	format: ExportFormat;
	note: string;
	keys: readonly string[];
}[];

/** An export slower than this says it is working on it. */
const EXPORT_PROGRESS_DELAY_MS = 600;
/** How long the export button shows its check after a file is saved. */
const EXPORT_DONE_MS = 1400;
/**
 * An export still running after this long shows the turning ring. Most are done
 * well before (an SVG in tens of ms), and a ring that flashes for a frame is noise.
 */
const EXPORT_BUSY_DELAY_MS = 350;

/** What the export button shows: its icon, a spinner while a file is drawn, a check once saved. */
type ExportPhase = 'idle' | 'busy' | 'done';

/** What an export needs of the page. */
export interface ExportHost {
	/** The preview's canvas: a PNG comes straight off it. */
	readonly canvas: HTMLCanvasElement | null;
	/** The view as it is now, which an SVG or a PDF is drawn from. */
	readonly chartView: ChartView;
	readonly layers: ChartLayers;
	readonly document: DocumentStore;
	/** Read `message` out. */
	announce(message: string): void;
}

/**
 * Run an export that may be slow and may fail. Past EXPORT_PROGRESS_DELAY_MS a held
 * toast says `working` until it is done; a failure says `failure(result)`. An Undo
 * that the progress toast covered comes back afterwards, unless something newer took
 * its place.
 */
export async function withExportProgress<T extends { ok: boolean }>(
	toast: ToastStore,
	working: string,
	run: () => Promise<T>,
	failure: (result: T) => string
): Promise<T> {
	const progress: { id: number | null; covered: ToastItem | null } = { id: null, covered: null };
	const timer = setTimeout(() => {
		progress.covered = toast.current;
		progress.id = toast.hold(working);
	}, EXPORT_PROGRESS_DELAY_MS);
	const result = await run();
	clearTimeout(timer);
	const progressShowing = progress.id !== null && toast.current?.id === progress.id;
	if (progress.id !== null) toast.dismiss(progress.id);
	if (!result.ok) {
		toast.show(failure(result));
	} else if (progressShowing && progress.covered?.undo) {
		toast.show(progress.covered.message, progress.covered.undo);
	}
	return result;
}

/** What the backend draws an SVG or a PDF of the chart from: the view as it is, now. */
function renderConfigNow(view: ChartView, layers: ChartLayers): RenderConfig {
	return buildRenderConfig(view, layers, new Date());
}

export class ExportController {
	/** The format the export button saves, as the menu last chose. */
	format = $state<ExportFormat>('PNG');
	phase = $state<ExportPhase>('idle');
	/** A document export is on its way: its row waits for it, a second click starts nothing. */
	documentExporting = $state(false);
	/** The format menu; the page puts it in its `DropdownGroup`. */
	readonly menu = new Dropdown();
	/** The open menu (`bind:this`), where the keys move the focus. */
	menuElement = $state<HTMLElement | null>(null);
	readonly #host: ExportHost;
	readonly #toast: ToastStore;
	/** An SVG or PDF of the chart is on its way; a second one waits for it. */
	#chartExporting = false;
	#doneTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(host: ExportHost, toast: ToastStore = pageToast) {
		this.#host = host;
		this.#toast = toast;
	}

	/** Nothing in the document yet: its row is off. */
	get documentEmpty(): boolean {
		return this.#host.document.pageCount === 0;
	}

	/** The document row's note: what is on its way, or how long the document is. */
	get documentNote(): string {
		const { pageCount } = this.#host.document;
		return this.documentExporting
			? 'Preparing…'
			: pageCount === 0
				? 'Add a chart first'
				: `${plural(pageCount, 'page')} · A4`;
	}

	/**
	 * Save the chart. A PNG comes straight off the canvas; an SVG or a PDF is drawn by
	 * the backend from the view as it is now, and a second one waits for the first.
	 */
	run = async (format: ExportFormat): Promise<void> => {
		const host = this.#host;
		const config = () => renderConfigNow(host.chartView, host.layers);
		if (format === 'PNG') {
			const result = await exportChart(host.canvas, format, config);
			if (result.ok) this.#showExported(format);
			else this.#toast.show('Couldn’t save the PNG. Try again in a moment.');
			return;
		}
		if (this.#chartExporting) return;
		this.#chartExporting = true;
		if (this.#doneTimer !== null) clearTimeout(this.#doneTimer);
		this.phase = 'idle';
		const busyTimer = setTimeout(() => (this.phase = 'busy'), EXPORT_BUSY_DELAY_MS);
		const result = await withExportProgress(
			this.#toast,
			`Preparing the ${format}…`,
			() => exportChart(host.canvas, format, config),
			() => `Couldn’t export the ${format}. Try again in a moment.`
		);
		clearTimeout(busyTimer);
		this.#chartExporting = false;
		if (result.ok) this.#showExported(format);
		else this.phase = 'idle';
	};

	/** A format picked in the menu: the button saves it from now on, and saves it now. */
	choose = (format: ExportFormat): void => {
		this.format = format;
		// From the keyboard, the focus goes back to the menu's button, not to <body>.
		this.menu.dismiss();
		void this.run(format);
	};

	/**
	 * The whole document as one PDF, with the progress and failure toasts of
	 * `withExportProgress`. The row is off meanwhile, so a second click starts nothing.
	 */
	runDocument = async (): Promise<void> => {
		const store = this.#host.document;
		this.menu.dismiss();
		if (store.pageCount === 0 || this.documentExporting) return;
		this.documentExporting = true;
		await withExportProgress(
			this.#toast,
			'Preparing the PDF…',
			() => exportDocument(store.pages),
			// A refusal (a 400) names its reason: trying again would not help.
			(result) =>
				!result.ok && result.message
					? `Couldn’t export the PDF: ${result.message}`
					: 'Couldn’t export the PDF. Try again in a moment.'
		);
		this.documentExporting = false;
	};

	/** ⌘K: open the format menu with the focus on the selected format, or close it again. */
	toggleMenu = async (): Promise<void> => {
		if (this.menu.open) {
			this.menu.dismiss();
			return;
		}
		this.menu.show();
		await tick();
		this.menuElement?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
	};

	/** ↑/↓ (Home/End) move through the formats, kept from the window, where arrows rotate the sky. */
	menuKeydown = (event: KeyboardEvent): void => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		// Disabled rows (the empty document) are skipped.
		const items = Array.from(
			this.menuElement?.querySelectorAll<HTMLElement>(
				'[role="menuitemradio"], [role="menuitem"]:not(:disabled)'
			) ?? []
		);
		const current = items.indexOf(document.activeElement as HTMLElement);
		let next: number;
		switch (event.key) {
			case 'ArrowDown':
				next = (current + 1) % items.length;
				break;
			case 'ArrowUp':
				next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = items.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
		items[next]?.focus();
	};

	/** No more timers: the page is going away. */
	dispose(): void {
		if (this.#doneTimer !== null) clearTimeout(this.#doneTimer);
	}

	/** The file is on its way to the downloads: the button says so for a moment. */
	#showExported(format: ExportFormat): void {
		this.phase = 'done';
		this.#host.announce(`${format} saved`);
		if (this.#doneTimer !== null) clearTimeout(this.#doneTimer);
		this.#doneTimer = setTimeout(() => {
			this.phase = 'idle';
			this.#doneTimer = null;
		}, EXPORT_DONE_MS);
	}
}
