<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { exportChart, type ExportFormat } from '$lib/api/export';
	import { buildRenderConfig } from '$lib/api/render-config';
	import AboutDialog from '$lib/components/AboutDialog.svelte';
	import { chartThumbnail, drawChartThumbnail } from '$lib/components/document/chart-thumbnail';
	import PageEditor from '$lib/components/document/PageEditor.svelte';
	import PagesPanel from '$lib/components/document/panel/PagesPanel.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import LayersPanel from '$lib/components/dock/LayersPanel.svelte';
	import LayersPopover from '$lib/components/dock/LayersPopover.svelte';
	import { LAYERS_PANEL_FOOTPRINT_PX, PROJECTION_SEGMENTS } from '$lib/components/dock/options';
	import SegmentedControl from '$lib/components/dock/SegmentedControl.svelte';
	import ChartStage from '$lib/components/stage/ChartStage.svelte';
	import { StageController } from '$lib/components/stage/stage.svelte';
	import { DocumentStore, MAX_CHARTS, MAX_PAGES } from '$lib/document/document.svelte';
	import { plural } from '$lib/document/labels';
	import {
		chartBoxOnScreen,
		FLIGHT_FADE,
		flightEdgeKeyframes,
		flightKeyframes,
		flightPixelRatio,
		flightScale,
		flightStarScale,
		PDF_FLIGHT_EASING,
		PDF_FLIGHT_MS,
		type Box
	} from '$lib/document/flight';
	import type { ChartSnapshot } from '$lib/document/types';
	import { exportDocument, snapshotChart } from '$lib/document/render';
	import {
		ariaKeys,
		isApplePlatform,
		isHelpShortcut,
		isModShortcut,
		keyLabel
	} from '$lib/shortcuts';
	import { LayerState } from '$lib/state/layers.svelte';
	import { ProjectionTransition } from '$lib/state/projection-transition.svelte';
	import { applySharedView, decodeViewHash, encodeViewHash } from '$lib/state/view-url';
	import { catalog } from '$lib/state/catalog.svelte';
	import { Dropdown, DropdownGroup } from '$lib/ui/dropdown.svelte';
	import { prefersReducedMotion } from '$lib/ui/motion';
	import { toast, type ToastItem } from '$lib/ui/toast.svelte';

	/** The export menu: what each format is for, and its shortcut (⌘S always saves a PNG). */
	const EXPORT_OPTIONS = [
		{ format: 'PNG', note: 'For screens and sharing', keys: ['mod', 'S'] },
		{ format: 'SVG', note: 'Vector, editable', keys: [] },
		{ format: 'PDF', note: 'For print', keys: [] }
	] as const satisfies readonly {
		format: ExportFormat;
		note: string;
		keys: readonly string[];
	}[];

	/** The compact header and the collapsed pages panel start here (as in the CSS). */
	const NARROW_QUERY = '(max-width: 743px)';
	/** An export slower than this says it is working on it. */
	const EXPORT_PROGRESS_DELAY_MS = 600;
	const LAYERS_PANEL_ID = 'layers-panel';
	/** Whether the layers panel was left open, kept for the next visit. */
	const LAYERS_PANEL_STORAGE_KEY = 'skycharts.layers.panel';
	/** How long the export button shows its check after a file is saved. */
	const EXPORT_DONE_MS = 1400;
	/**
	 * An export still running after this long shows the turning ring. Most are done
	 * well before (an SVG in tens of ms), and a ring that flashes for a frame is noise.
	 */
	const EXPORT_BUSY_DELAY_MS = 350;
	/** The address bar follows the view once it has been still for this long. */
	const URL_SYNC_DELAY_MS = 300;

	const layers = new LayerState();
	const projection = new ProjectionTransition();
	const stage = new StageController(layers, projection);
	const exportMenu = new Dropdown();
	const layersMenu = new Dropdown();
	const menus = new DropdownGroup(exportMenu, layersMenu);

	let selectedExportFormat = $state<ExportFormat>('PNG');
	let exportMenuEl = $state<HTMLDivElement | null>(null);
	let aboutOpen = $state(false);
	// ⌘ or Ctrl for the shortcuts; read on mount, so the server render assumes a Mac.
	let apple = $state(true);

	// The PDF document. Read from storage on mount, so the server render and hydration agree.
	const documentStore = new DocumentStore();
	/** The page the editor is open on; null while it is closed. */
	let editorPageId = $state<string | null>(null);
	let pagesPanel = $state<ReturnType<typeof PagesPanel>>();
	let addButtonEl = $state<HTMLButtonElement | null>(null);
	/** How far the pages panel reaches into the chart area, px; the chart keeps clear of it. */
	let panelFootprintPx = $state(0);
	let narrow = $state(false);
	/**
	 * The layers panel on the right of the chart, where a screen has the room for one
	 * (a phone keeps the dock's popover). The dock's Layers button shows and hides it.
	 */
	let layersPanelOpen = $state(false);
	let layersPanel = $state<ReturnType<typeof LayersPanel>>();
	/**
	 * The page has settled after its load: from here on a panel that opens slides
	 * and the chart moves with it. Before, what storage remembers is simply there.
	 */
	let motionReady = $state(false);
	/** A copy of the chart on its way to its page after Add to PDF; null when nothing is in the air. */
	let pdfFlight = $state<{
		id: number;
		chart: ChartSnapshot;
		from: Box;
		to: Box;
		corner: string;
	} | null>(null);
	let pdfFlightCount = 0;
	/** The chart that copy stands for: its place on the page's thumbnail stays empty until it lands. */
	let pendingItemId = $state<string | null>(null);
	/** What the export button shows: its icon, a spinner while a file is drawn, a check once saved. */
	let exportPhase = $state<'idle' | 'busy' | 'done'>('idle');
	let exportDoneTimer: ReturnType<typeof setTimeout> | null = null;
	/** Read out after Add to PDF (the thumbnail's flash is the visual cue). */
	let addAnnouncement = $state('');
	/** A document export is on its way: its row waits for it, a second click starts nothing. */
	let documentExporting = $state(false);
	/** An SVG or PDF of the chart is on its way; a second one waits for it. */
	let chartExporting = false;
	/**
	 * The view the address bar holds, as a fragment; null until the page has read it.
	 * The bar is written only once the view differs from this, so a plain visit keeps
	 * a plain address.
	 */
	let syncedHash: string | null = null;
	let urlSyncTimer: ReturnType<typeof setTimeout> | null = null;
	const modalOpen = $derived(aboutOpen || editorPageId !== null);
	// On a phone the panel floats over the chart, which it may cover; on a wide screen the chart moves aside.
	const panelReservePx = $derived(narrow ? 0 : panelFootprintPx);
	const layersDocked = $derived(!narrow);
	const layersReservePx = $derived(layersDocked && layersPanelOpen ? LAYERS_PANEL_FOOTPRINT_PX : 0);
	const documentNote = $derived(
		documentExporting
			? 'Preparing…'
			: documentStore.pageCount === 0
				? 'Add a chart first'
				: `${plural(documentStore.pageCount, 'page')} · A4`
	);

	const notify = (message: string, undo?: () => void) => {
		toast.show(message, undo);
	};

	onMount(() => {
		apple = isApplePlatform(navigator);
		const narrowQuery = window.matchMedia(NARROW_QUERY);
		narrow = narrowQuery.matches;
		const handleNarrowChange = (event: MediaQueryListEvent) => (narrow = event.matches);
		narrowQuery.addEventListener('change', handleNarrowChange);
		documentStore.load();
		// Collapsed by default on a phone, where the open panel would cover the chart.
		if (narrow) documentStore.panelOpen = false;
		layersPanelOpen = readLayersPanelOpen();
		// Two frames on, the restored layout has been painted: changes after that may animate.
		const motionFrame = requestAnimationFrame(() => {
			requestAnimationFrame(() => (motionReady = true));
		});
		// A link (or a reload) brings its view; pasting another into this tab only changes the hash.
		readViewFromUrl();
		window.addEventListener('hashchange', flyToViewFromUrl);
		// Saves are debounced: write the last one before the tab goes away.
		const flushDocument = () => {
			documentStore.flush();
			if (urlSyncTimer !== null) writeViewToUrl();
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') flushDocument();
		};
		window.addEventListener('pagehide', flushDocument);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		const handleKeyDown = (event: KeyboardEvent) => {
			// ⌘Z/Ctrl+Z takes back what the toast offers to undo, from anywhere; the editor,
			// which keeps its keys from the page, does the same through its `undo`.
			if (isModShortcut(event, 'KeyZ', apple) && toast.current?.undo) {
				event.preventDefault();
				if (!event.repeat) toast.undo();
				return;
			}
			// The editor is modal and handles its own keys; nothing here acts behind it.
			if (editorPageId !== null) return;
			if (isHelpShortcut(event)) {
				event.preventDefault();
				if (!event.repeat) setAboutOpen(!aboutOpen);
				return;
			}
			// The dialog is modal: the chart and the menus behind it stay put.
			if (aboutOpen) return;
			if (isModShortcut(event, 'KeyK', apple)) {
				event.preventDefault();
				if (!event.repeat) void toggleExportMenuFromKeyboard();
				return;
			}
			if (isModShortcut(event, 'KeyS', apple)) {
				event.preventDefault();
				if (!event.repeat) void runExport('PNG');
				return;
			}
			if (
				event.code === 'KeyP' &&
				event.shiftKey &&
				!event.repeat &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				event.preventDefault();
				stage.switchProjection(projection.otherMode);
			}
			stage.keydown(event);
		};
		const stopMenuDismiss = menus.listen();
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', stage.keyup);
		window.addEventListener('blur', stage.release);
		return () => {
			stopMenuDismiss();
			window.removeEventListener('hashchange', flyToViewFromUrl);
			cancelAnimationFrame(motionFrame);
			if (exportDoneTimer !== null) clearTimeout(exportDoneTimer);
			narrowQuery.removeEventListener('change', handleNarrowChange);
			window.removeEventListener('pagehide', flushDocument);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			flushDocument();
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', stage.keyup);
			window.removeEventListener('blur', stage.release);
		};
	});

	/** The view as the address bar would hold it. */
	function viewHash(): string {
		return encodeViewHash(stage.chartView, layers);
	}

	/**
	 * Take the view the address names, if it names one. On a load it is simply
	 * there; with `fly` (a link pasted into the open tab) the sky turns and zooms
	 * to it, when the projection stays the same: across projections the morph and
	 * its carried field of view would fight the flight, so that is a cut.
	 */
	function readViewFromUrl(fly = false) {
		const shared = decodeViewHash(window.location.hash);
		if (shared) {
			const current = stage.chartView;
			const next = applySharedView(current, shared);
			layers.assign(shared.layers);
			stage.show(next, fly && next.projection === current.projection && !prefersReducedMotion());
		}
		syncedHash = viewHash();
	}

	const flyToViewFromUrl = () => readViewFromUrl(true);

	function writeViewToUrl() {
		if (urlSyncTimer !== null) clearTimeout(urlSyncTimer);
		urlSyncTimer = null;
		const hash = viewHash();
		if (hash === syncedHash) return;
		try {
			// Replaced, not pushed: turning the sky must not fill the Back history.
			replaceState(`#${hash}`, {});
			syncedHash = hash;
		} catch (error) {
			// Browsers cap how often the address may change; the next change tries again.
			console.error(error);
		}
	}

	$effect(() => {
		// Reading the fragment subscribes to the view, the projection and the layers.
		const hash = viewHash();
		if (syncedHash === null || hash === syncedHash) return;
		if (urlSyncTimer !== null) clearTimeout(urlSyncTimer);
		urlSyncTimer = setTimeout(writeViewToUrl, URL_SYNC_DELAY_MS);
	});

	/**
	 * Run an export that may be slow and may fail. Past EXPORT_PROGRESS_DELAY_MS a held
	 * toast says `working` until it is done; a failure says `failure(result)`. An Undo
	 * that the progress toast covered comes back afterwards, unless something newer took
	 * its place.
	 */
	async function withExportProgress<T extends { ok: boolean }>(
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

	/**
	 * Save the chart. A PNG comes straight off the canvas; an SVG or a PDF is drawn by
	 * the backend from the view as it is now, and a second one waits for the first.
	 */
	async function runExport(format: ExportFormat) {
		const config = () => buildRenderConfig(stage.chartView, layers, new Date());
		if (format === 'PNG') {
			const result = await exportChart(stage.canvas, format, config);
			if (result.ok) showExported(format);
			else toast.show('Couldn’t save the PNG. Try again in a moment.');
			return;
		}
		if (chartExporting) return;
		chartExporting = true;
		if (exportDoneTimer !== null) clearTimeout(exportDoneTimer);
		exportPhase = 'idle';
		const busyTimer = setTimeout(() => (exportPhase = 'busy'), EXPORT_BUSY_DELAY_MS);
		const result = await withExportProgress(
			`Preparing the ${format}…`,
			() => exportChart(stage.canvas, format, config),
			() => `Couldn’t export the ${format}. Try again in a moment.`
		);
		clearTimeout(busyTimer);
		chartExporting = false;
		if (result.ok) showExported(format);
		else exportPhase = 'idle';
	}

	/** The file is on its way to the downloads: the button says so for a moment. */
	function showExported(format: ExportFormat) {
		exportPhase = 'done';
		announce(`${format} saved`);
		if (exportDoneTimer !== null) clearTimeout(exportDoneTimer);
		exportDoneTimer = setTimeout(() => {
			exportPhase = 'idle';
			exportDoneTimer = null;
		}, EXPORT_DONE_MS);
	}

	/**
	 * Add to PDF: a frozen copy of the chart goes where it fits in the document (a
	 * new page if nowhere; the charts on its page may move to make room), with a
	 * thumbnail of the preview to show until its vector preview loads. The panel
	 * opens on that page and flashes it; the toast offers to take the Add back.
	 */
	function addToPdf() {
		const chartView = stage.chartView;
		const chart = snapshotChart(chartView, layers);
		// The backend's limits: a document past them would not export.
		const blocker = documentStore.addChartBlocker(chart);
		if (blocker) {
			toast.show(
				blocker === 'charts'
					? `The PDF document is full: it holds ${MAX_CHARTS} charts at most`
					: `No room left: a PDF document has ${MAX_PAGES} pages at most`
			);
			return;
		}
		const canvas = stage.canvas;
		const thumb = canvas ? chartThumbnail(canvas, chartView) : undefined;
		// Where the chart is on screen now: adding it may bring the pages panel in and move it.
		const canvasBox = canvas?.getBoundingClientRect() ?? null;
		// A copy still in the air from the last Add comes down at once.
		void landPdfFlight();
		// And where the charts already on the pages are: this one may move them to make room.
		const before = pagesPanel?.chartBoxes();
		const { pageId, blockId: itemId, newPage, relaid, undo } = documentStore.addChart(chart, thumb);
		documentStore.selectedPageId = pageId;
		const flying =
			canvasBox !== null &&
			canvasBox.width > 0 &&
			typeof canvas?.animate === 'function' &&
			!prefersReducedMotion();
		// Before the thumbnail is drawn: the chart's place on it stays empty until the copy lands.
		if (flying) pendingItemId = itemId;
		const added = `Added to page ${documentStore.pageIndex(pageId) + 1}`;
		announce(added);
		notify(relaid ? `${added}, layout updated` : added, () => {
			// Taken back mid-flight: the copy has nowhere to land.
			if (pendingItemId === itemId) {
				pendingItemId = null;
				pdfFlight = null;
			}
			if (undo()) announce('Add to PDF undone');
		});
		void showAddedChart(pageId, itemId, newPage, chart, canvasBox, flying, before);
	}

	/**
	 * Lead the eye from the chart to its place on the page. The panel brings the
	 * page into view (a new page makes its entrance; the first one arrives with the
	 * panel) and says where the chart sits on its thumbnail; a copy of the chart,
	 * drawn as the thumbnail draws it, flies there from the preview and is replaced
	 * by the thumbnail's own drawing as it lands; charts already on the page move
	 * aside over the same time. Without a copy (less motion asked for) the panel
	 * simply reveals the page.
	 */
	async function showAddedChart(
		pageId: string,
		itemId: string,
		newPage: boolean,
		chart: ChartSnapshot,
		canvasBox: Box | null,
		flying: boolean,
		before: Readonly<Record<string, Box>> | undefined
	) {
		const target = await pagesPanel?.reveal(
			pageId,
			flying ? { itemId, newPage, ms: PDF_FLIGHT_MS, before } : undefined
		);
		if (!flying || pendingItemId !== itemId) return;
		if (!target || !canvasBox) {
			pendingItemId = null;
			return;
		}
		pdfFlightCount += 1;
		pdfFlight = {
			id: pdfFlightCount,
			chart,
			from: chartBoxOnScreen(canvasBox, chart.view),
			to: target.box,
			corner: target.corner
		};
	}

	/** The copy has arrived (or must make way): the thumbnail draws the chart, then the copy goes. */
	async function landPdfFlight() {
		if (pendingItemId === null && pdfFlight === null) return;
		const landed = pdfFlight?.id;
		pendingItemId = null;
		// One update for the thumbnail to draw before the copy over it is removed: no empty frame.
		await tick();
		if (pdfFlight?.id === landed) pdfFlight = null;
	}

	/**
	 * Lay the copy out on its place on the thumbnail, draw it as the thumbnail will,
	 * and play it there from over the chart. It lands by itself when it arrives.
	 */
	function flyToPage(node: HTMLElement, flight: NonNullable<typeof pdfFlight>) {
		const { from, to } = flight;
		node.style.left = `${to.x}px`;
		node.style.top = `${to.y}px`;
		node.style.width = `${to.width}px`;
		node.style.height = `${to.height}px`;
		const canvas = node.querySelector('canvas');
		const startScale = flightScale(from, to);
		const density = flightPixelRatio(from, to, window.devicePixelRatio || 1);
		const timing = { duration: PDF_FLIGHT_MS, easing: PDF_FLIGHT_EASING, fill: 'both' } as const;
		const move = node.animate(flightKeyframes(from, to), timing);
		const fade = node.animate(FLIGHT_FADE, { duration: PDF_FLIGHT_MS, fill: 'both' });
		const edge = node
			.querySelector<HTMLElement>('.pdf-flight-edge')
			?.animate(flightEdgeKeyframes(from, to, 'var(--paper-chart-edge)'), timing);
		// Redrawn every frame with the stars sized for how large the copy is shown just
		// then: a few hundred dots, and on landing exactly the thumbnail's own drawing.
		let frame = 0;
		const draw = () => {
			if (!canvas) return;
			const progress = move.effect?.getComputedTiming().progress ?? 1;
			const scale = startScale + (1 - startScale) * progress;
			drawChartThumbnail(
				canvas,
				flight.chart,
				to.width,
				to.height,
				catalog.starVectors,
				density,
				flightStarScale(scale, startScale)
			);
			if (move.playState === 'running') frame = requestAnimationFrame(draw);
		};
		draw();
		move.onfinish = () => {
			// The last frame drawn may be a hair short of the end: land on the thumbnail's exact drawing.
			draw();
			void landPdfFlight();
		};
		return {
			destroy: () => {
				cancelAnimationFrame(frame);
				move.cancel();
				fade.cancel();
				edge?.cancel();
			}
		};
	}

	/** Polite live region; cleared first, so the same words twice are read twice. */
	function announce(message: string) {
		addAnnouncement = '';
		setTimeout(() => (addAnnouncement = message), 50);
	}

	/**
	 * The whole document as one PDF, with the progress and failure toasts of
	 * `withExportProgress`. The row is off meanwhile, so a second click starts nothing.
	 */
	async function runDocumentExport() {
		exportMenu.dismiss();
		if (documentStore.pageCount === 0 || documentExporting) return;
		documentExporting = true;
		await withExportProgress(
			'Preparing the PDF…',
			() => exportDocument(documentStore.pages),
			// A refusal (a 400) names its reason: trying again would not help.
			(result) =>
				!result.ok && result.message
					? `Couldn’t export the PDF: ${result.message}`
					: 'Couldn’t export the PDF. Try again in a moment.'
		);
		documentExporting = false;
	}

	function openEditor(pageId: string) {
		menus.closeAll();
		// Keys held down as the editor opens must not keep turning the sky behind it.
		stage.release();
		documentStore.selectedPageId = pageId;
		editorPageId = pageId;
	}

	function handleExportFormatSelect(format: ExportFormat) {
		selectedExportFormat = format;
		// From the keyboard, the focus goes back to the menu's button, not to <body>.
		exportMenu.dismiss();
		void runExport(format);
	}

	/** ⌘K: open the format menu with the focus on the selected format, or close it again. */
	async function toggleExportMenuFromKeyboard() {
		if (exportMenu.open) {
			exportMenu.dismiss();
			return;
		}
		exportMenu.show();
		await tick();
		exportMenuEl?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
	}

	/** ↑/↓ (Home/End) move through the formats, kept from the window, where arrows rotate the sky. */
	function handleExportMenuKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		// Disabled rows (the empty document) are skipped.
		const items = Array.from(
			exportMenuEl?.querySelectorAll<HTMLElement>(
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
	}

	function readLayersPanelOpen(): boolean {
		try {
			return window.localStorage.getItem(LAYERS_PANEL_STORAGE_KEY) === '1';
		} catch {
			// Storage blocked: the panel starts closed, as on a first visit.
			return false;
		}
	}

	/**
	 * Show or hide the layers panel, and remember which for the next visit. Opened
	 * from the keyboard (`focus`), the focus goes to its first switch.
	 */
	async function setLayersPanelOpen(open: boolean, focus = false) {
		layersPanelOpen = open;
		try {
			window.localStorage.setItem(LAYERS_PANEL_STORAGE_KEY, open ? '1' : '0');
		} catch {
			// Not remembered, then; the panel works all the same.
		}
		if (open && focus) {
			await tick();
			layersPanel?.focusFirst();
		}
	}

	/** From the panel itself (its close button, Escape): the focus goes back to the Layers button. */
	function closeLayersPanel() {
		const focusInside = layersPanel?.hasFocus() ?? false;
		void setLayersPanelOpen(false);
		if (focusInside) layersMenu.trigger?.focus();
	}

	function setAboutOpen(next: boolean) {
		if (next) {
			menus.closeAll();
			// Keys held down as the dialog opens must not keep turning the sky behind it.
			stage.release();
		}
		aboutOpen = next;
	}
</script>

<main
	class="page"
	onpointerdown={stage.pointerdown}
	onpointermove={stage.pointermove}
	onpointerleave={stage.pointerleave}
	onpointerup={stage.pointerup}
	onpointercancel={stage.pointerup}
>
	<header class="ray-header">
		<div class="ray-bottom">
			<div class="ray-left">
				<img src="/icon-constellation.png" alt="Apex icon" class="ray-logo" />
				<span class="ray-textline">
					<span class="ray-brand">Skycharts</span>
					<span class="ray-meta-word">by Vobolgus</span>
				</span>
			</div>
			<div class="ray-right">
				<button
					class="tool-btn"
					type="button"
					aria-haspopup="dialog"
					aria-keyshortcuts="Shift+?"
					title="About · ?"
					onclick={() => setAboutOpen(true)}
				>
					<svg class="tool-icon tool-icon-info" viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="6.25" />
						<path d="M8 7.5v3.5M8 5.1v.01" />
					</svg>
					<svg class="tool-icon tool-icon-help" viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="6.25" />
						<path d="M6.4 6.3a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1.1v.3M8 11.3v.01" />
					</svg>
					<span class="tool-label">About</span>
				</button>
				<button
					bind:this={addButtonEl}
					class="add-btn"
					type="button"
					title="Add the chart to the PDF document"
					onclick={addToPdf}
				>
					<svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
						<path d="M8 3.25v9.5M3.25 8h9.5" />
					</svg>
					<span class="tool-label">Add to PDF</span>
				</button>
				<div class="export-wrap" bind:this={exportMenu.element}>
					<button
						class="export-main"
						type="button"
						aria-busy={exportPhase === 'busy'}
						onclick={() => runExport(selectedExportFormat)}
					>
						{#if exportPhase === 'busy'}
							<svg class="export-icon export-spinner" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />
							</svg>
						{:else if exportPhase === 'done'}
							<svg class="export-icon export-done" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M3.5 8.5l3 3 6-7" pathLength="1" />
							</svg>
						{:else}
							<svg class="export-icon" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M8 2.5v7M5 6.5l3 3 3-3M3 12.5h10" />
							</svg>
						{/if}
						<span><span class="export-verb">Export</span> {selectedExportFormat}</span>
					</button>
					<button
						bind:this={exportMenu.trigger}
						class="export-toggle"
						type="button"
						aria-label="Choose export format"
						aria-haspopup="menu"
						aria-expanded={exportMenu.open}
						aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
						onclick={() => exportMenu.toggle()}
					>
						<svg class="export-icon" viewBox="0 0 16 16" aria-hidden="true">
							<path d="M5 6.5l3 3 3-3" />
						</svg>
					</button>
					{#if exportMenu.open}
						<div
							bind:this={exportMenuEl}
							class="export-menu"
							role="menu"
							aria-label="Export format"
							tabindex="-1"
							onkeydown={handleExportMenuKeydown}
						>
							<div class="export-group" role="group" aria-label="Chart">
								{#each EXPORT_OPTIONS as option (option.format)}
									{@const checked = option.format === selectedExportFormat}
									<button
										class="export-option"
										type="button"
										role="menuitemradio"
										aria-checked={checked}
										aria-labelledby="export-{option.format}-name"
										aria-describedby="export-{option.format}-note"
										aria-keyshortcuts={option.keys.length
											? ariaKeys(option.keys, apple)
											: undefined}
										onclick={() => handleExportFormatSelect(option.format)}
									>
										<svg class="export-option-icon" viewBox="0 0 16 16" aria-hidden="true">
											{#if option.format === 'PNG'}
												<rect x="2.5" y="3" width="11" height="10" rx="1.5" />
												<path d="M2.5 10.5l3-3 3 3 2-2 3 3" />
											{:else if option.format === 'SVG'}
												<path d="M3 13l4-10 2 6 4-2" />
												<circle cx="3" cy="13" r="1" />
												<circle cx="13" cy="7" r="1" />
											{:else}
												<path d="M4 2.5h5.5l3 3v8h-8.5z" />
												<path d="M9.5 2.5v3h3" />
											{/if}
										</svg>
										<span class="export-option-text">
											<span class="export-option-name" id="export-{option.format}-name">
												{option.format}
											</span>
											<span class="export-option-note" id="export-{option.format}-note">
												{option.note}
											</span>
										</span>
										<span class="export-option-keys" aria-hidden="true">
											{#each option.keys as key (key)}
												<kbd>{keyLabel(key, apple)}</kbd>
											{/each}
										</span>
										<svg class="export-option-check" viewBox="0 0 16 16" aria-hidden="true">
											{#if checked}<path d="M3.5 8.5l3 3 6-7" />{/if}
										</svg>
									</button>
								{/each}
							</div>
							<div class="export-separator" role="separator"></div>
							<button
								class="export-option"
								type="button"
								role="menuitem"
								disabled={documentStore.pageCount === 0 || documentExporting}
								aria-labelledby="export-document-name"
								aria-describedby="export-document-note"
								onclick={runDocumentExport}
							>
								<svg class="export-option-icon" viewBox="0 0 16 16" aria-hidden="true">
									<path d="M5.5 2.5h5l3 3v7.5h-8z" />
									<path d="M10.5 2.5v3h3M2.5 5v8.5a1 1 0 0 0 1 1H10" />
								</svg>
								<span class="export-option-text">
									<span class="export-option-name" id="export-document-name">PDF document</span>
									<span class="export-option-note" id="export-document-note">{documentNote}</span>
								</span>
								<span class="export-option-keys" aria-hidden="true"></span>
								<span class="export-option-check" aria-hidden="true"></span>
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</header>
	<ChartStage
		{stage}
		reserveLeftPx={panelReservePx}
		reserveRightPx={layersReservePx}
		animated={motionReady}
	>
		<PagesPanel
			bind:this={pagesPanel}
			bind:footprint={panelFootprintPx}
			store={documentStore}
			{pendingItemId}
			animated={motionReady}
			onopen={openEditor}
			{notify}
			onemptied={() => addButtonEl?.focus()}
		/>
		{#if layersDocked}
			<LayersPanel
				bind:this={layersPanel}
				{layers}
				open={layersPanelOpen}
				animated={motionReady}
				id={LAYERS_PANEL_ID}
				onclose={closeLayersPanel}
			/>
		{/if}
	</ChartStage>
	<div class="control-bar-shell">
		<div class="control-bar" role="group" aria-label="Generator display controls">
			<div class="control-group">
				<SegmentedControl
					label="Projection"
					options={PROJECTION_SEGMENTS}
					value={projection.mode}
					onselect={stage.switchProjection}
					shortcut="Shift+P"
				/>
			</div>
			<span class="control-divider" aria-hidden="true"></span>
			<div class="control-group">
				<LayersPopover
					{layers}
					menu={layersMenu}
					docked={layersDocked}
					panelOpen={layersPanelOpen}
					panelId={LAYERS_PANEL_ID}
					onpanel={setLayersPanelOpen}
				/>
			</div>
		</div>
	</div>
	<!-- Inside the page, which clips it: after it, even a 1 px box would make the document scroll. -->
	<p class="sr-only" role="status">{addAnnouncement}</p>
</main>
<AboutDialog bind:open={aboutOpen} {apple} />
<PageEditor
	store={documentStore}
	pageId={editorPageId}
	onclose={() => (editorPageId = null)}
	{notify}
	undo={() => toast.undo()}
	{apple}
/>
{#if pdfFlight}
	{#key pdfFlight.id}
		<div
			class="pdf-flight"
			aria-hidden="true"
			style:--corner={pdfFlight.corner}
			use:flyToPage={pdfFlight}
		>
			<canvas></canvas>
			<span class="pdf-flight-edge"></span>
		</div>
	{/key}
{/if}
<Toast store={toast} modal={modalOpen} {apple} />

<style>
	.page {
		position: relative;
		width: 100%;
		min-height: 100dvh;
		height: 100dvh;
		background: #0a0a0b;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		overflow: hidden;
	}

	.ray-header {
		height: 56px;
		padding: 0 10px;
		display: flex;
		align-items: center;
		background: #101114;
		border-bottom: none;
		z-index: 5;
	}

	/*
	 * The chart's copy in the air after Add to PDF. It is the chart as a page thumbnail
	 * shows it (paper, the brighter stars, a hairline edge), laid out by the script on
	 * its place on that thumbnail and played there from over the preview; above the page
	 * and its panels, under the toast. It takes no pointer.
	 */
	.pdf-flight {
		position: fixed;
		z-index: 900;
		overflow: hidden;
		border-radius: var(--corner);
		background: var(--paper);
		transform-origin: center;
		pointer-events: none;
		will-change: transform, opacity;
	}

	/* Drawn to fit, as the preview's canvas is. */
	.pdf-flight canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.pdf-flight-edge {
		position: absolute;
		inset: 0;
		border-radius: var(--corner);
	}

	.ray-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-width: 0;
		width: 100%;
	}

	.ray-left {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.ray-logo {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		object-fit: cover;
	}

	.ray-textline {
		display: inline-flex;
		align-items: baseline;
		gap: 14px;
		line-height: 1;
		white-space: nowrap;
	}

	.ray-brand {
		font-size: 0.98rem;
		font-weight: 400;
		color: #eceef1;
		letter-spacing: 0;
		line-height: 1;
		font-family:
			Inter,
			system-ui,
			-apple-system,
			Segoe UI,
			Roboto,
			Arial,
			sans-serif;
	}

	.ray-meta-word {
		font-size: 0.74rem;
		font-weight: 400;
		color: #8f939a;
		line-height: 1;
	}

	.ray-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* ray.so's transparent button: no border, a fill on hover. */
	.tool-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-2);
		font: var(--font-ui);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.tool-btn:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	/* The ring is a box-shadow, which forced colors drop; the transparent outline then shows. */
	.tool-btn:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background: var(--fill-hover);
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	/* After :focus-visible: a key or click press shows on a focused button too. */
	.tool-btn:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	/* ray.so's secondary button: a faint fill and a hairline edge, brighter under the pointer. */
	.add-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px 0 10px;
		border: 0;
		border-radius: var(--r-ctl);
		background: var(--fill-hover);
		box-shadow: inset 0 0 0 1px var(--hairline-strong);
		color: var(--fg-2);
		font: var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.add-btn:hover {
			background: var(--fill-press);
			color: var(--fg-1);
		}
	}

	.add-btn:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background: var(--fill-press);
		color: var(--fg-1);
		box-shadow:
			inset 0 0 0 1px var(--hairline-strong),
			var(--ring);
	}

	.add-btn:active {
		background: var(--fill-on);
		color: var(--fg-1);
	}

	.tool-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* "ⓘ About" with a label; the bare "?" stands in for it on a phone. */
	.tool-icon-help {
		display: none;
	}

	/*
	 * Export: ray.so's tinted primary, split into the main action and the format
	 * menu. The wash and edge sit on the wrap; each half lays its own hover or
	 * press overlay over them, rounding its outer corners so the fill stays
	 * inside. No overflow clipping: the format menu hangs below.
	 */
	.export-wrap {
		position: relative;
		display: inline-flex;
		align-items: stretch;
		height: 30px;
		border-radius: var(--r-ctl);
		background: var(--accent-wash);
		box-shadow: inset 0 0 0 1px var(--accent-edge);
		color: var(--accent-fg);
	}

	.export-main,
	.export-toggle {
		display: inline-flex;
		align-items: center;
		border: 0;
		background-color: transparent;
		color: inherit;
		font: var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.export-main {
		gap: 7px;
		padding: 0 12px 0 10px;
		border-radius: var(--r-ctl) 0 0 var(--r-ctl);
	}

	/* The divider stops 1 px short of each end, so it meets the wrap's edge instead of doubling it. */
	.export-toggle {
		width: 28px;
		justify-content: center;
		border-radius: 0 var(--r-ctl) var(--r-ctl) 0;
		background-image: linear-gradient(var(--accent-edge), var(--accent-edge));
		background-position: left center;
		background-repeat: no-repeat;
		background-size: 1px calc(100% - 2px);
	}

	@media (hover: hover) {
		.export-main:hover,
		.export-toggle:hover {
			background-color: var(--accent-wash-hover);
		}
	}

	.export-main:focus-visible,
	.export-toggle:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background-color: var(--accent-wash-hover);
		box-shadow: var(--ring);
	}

	.export-main:active,
	.export-toggle:active,
	.export-toggle[aria-expanded='true'] {
		background-color: var(--accent-wash-press);
	}

	/* Forced colors drop the wash and the inset edge: keep the button's outline. */
	@media (forced-colors: active) {
		.export-wrap {
			outline: 1px solid ButtonText;
		}
	}

	.export-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* A file is being drawn: three quarters of a ring, turning. */
	.export-spinner {
		animation: export-spin 700ms linear infinite;
	}

	@keyframes export-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Saved: the check draws itself, start to end. */
	.export-done path {
		stroke-dasharray: 1;
		animation: export-check 240ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes export-check {
		from {
			stroke-dashoffset: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		/* The ring still says "working" standing still; the check is simply there. */
		.export-spinner,
		.export-done path {
			animation: none;
		}
	}

	.export-toggle .export-icon {
		width: 14px;
		height: 14px;
		transition: transform 160ms ease;
	}

	.export-toggle[aria-expanded='true'] .export-icon {
		transform: rotate(180deg);
	}

	/* The dock's popover look: one family of menus across the page. */
	.export-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 20;
		display: grid;
		gap: 2px;
		width: min(280px, calc(100vw - 20px));
		padding: 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-pop);
		background: var(--pop);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
	}

	.export-menu:focus {
		outline: none;
	}

	.export-group {
		display: grid;
		gap: 2px;
	}

	.export-separator {
		height: 1px;
		margin: 3px 2px;
		background: var(--hairline);
	}

	.export-option {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) auto 16px;
		align-items: center;
		column-gap: 10px;
		min-height: 44px;
		padding: 6px 8px;
		border: 0;
		border-radius: var(--r-row);
		background: transparent;
		color: var(--fg-2);
		text-align: left;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.export-option:not(:disabled):hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	/*
	 * Any focus fills the row: ⌘K moves focus here from a shortcut, which Chrome
	 * does not count as :focus-visible, and the row must still show where it is.
	 */
	.export-option:focus {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background: var(--fill-hover);
		color: var(--fg-1);
	}

	.export-option:focus-visible {
		box-shadow: var(--ring);
	}

	.export-option:active {
		background: var(--fill-press);
	}

	/* The document row with nothing in the document: dimmed, no hover, skipped by the arrows. */
	.export-option:disabled {
		background: transparent;
		color: var(--fg-2);
		cursor: default;
	}

	.export-option:disabled .export-option-icon,
	.export-option:disabled .export-option-name {
		opacity: 0.5;
	}

	.export-option[aria-checked='true'] {
		color: var(--fg-1);
	}

	.export-option-icon,
	.export-option-check {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.export-option-text {
		display: grid;
		gap: 1px;
		min-width: 0;
	}

	/* One line each, whatever the fallback font: the rows keep one height. */
	.export-option-name,
	.export-option-note {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.export-option-name {
		color: var(--fg-1);
		font: var(--font-ui);
	}

	.export-option-note {
		color: var(--fg-3);
		font:
			400 12px/14px Inter,
			system-ui,
			sans-serif;
	}

	/* A lit row over the white chart takes --fg-3 under 4.5:1; --fg-2 keeps it readable. */
	.export-option:not(:disabled):is(:hover, :focus, :active) .export-option-note {
		color: var(--fg-2);
	}

	.export-option-keys {
		display: inline-flex;
		gap: 3px;
	}

	.export-option-keys kbd {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 4px;
		background: var(--fill-on);
		color: var(--fg-2);
		font:
			500 11px/1 Inter,
			system-ui,
			sans-serif;
	}

	@media (prefers-reduced-motion: reduce) {
		.export-toggle .export-icon {
			transition: none;
		}
	}

	.control-bar-shell {
		display: flex;
		justify-content: center;
		padding: 0 16px 16px;
		pointer-events: none;
		z-index: var(--z-dock);
	}

	/*
	 * Floating dock, still its own grid row so it never covers the chart. No
	 * backdrop-filter: the row has only the flat page behind it, and a filter here
	 * would make the dock the backdrop root of the Layers popover and kill its blur.
	 */
	.control-bar {
		position: relative;
		display: flex;
		align-items: center;
		height: var(--h-dock);
		padding: var(--pad-dock);
		border-radius: var(--r-dock);
		background: var(--dock);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		pointer-events: auto;
	}

	/* 1 px gradient border, cut out of a padded layer with a mask. */
	.control-bar::before {
		content: '';
		position: absolute;
		inset: 0;
		padding: 1px;
		border-radius: inherit;
		background: linear-gradient(
			20deg,
			rgba(255, 255, 255, 0.1),
			rgba(255, 255, 255, 0.25) 20%,
			rgba(255, 255, 255, 0.1)
		);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask-composite: exclude;
		pointer-events: none;
	}

	.control-group {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.control-divider {
		flex-shrink: 0;
		width: 1px;
		height: 20px;
		margin: 0 6px;
		background: var(--hairline);
	}

	@media (max-width: 743px) {
		/* "?" alone, a 32 px square; the label stays for screen readers. */
		.tool-btn,
		.add-btn {
			width: 32px;
			height: 32px;
			padding: 0;
			justify-content: center;
		}

		.tool-icon-info {
			display: none;
		}

		.tool-icon-help {
			display: block;
		}

		.export-main {
			gap: 6px;
			padding: 0 10px 0 9px;
		}

		/* "⤓ PNG ▾": the format alone, "Export" kept for screen readers. */
		.tool-label,
		.export-verb {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* The byline is the first thing to go when the header runs out of room. */
	@media (max-width: 360px) {
		.ray-meta-word {
			display: none;
		}
	}

	/* Phones only: the compact dock with labels still fits up to the 743 px breakpoint. */
	@media (max-width: 480px) {
		.control-bar {
			width: 100%;
			justify-content: center;
		}
	}
</style>
