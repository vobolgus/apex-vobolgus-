<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import AboutDialog from '$lib/components/AboutDialog.svelte';
	import { chartThumbnail, drawChartThumbnail } from '$lib/components/document/chart-thumbnail';
	import PageEditor from '$lib/components/document/PageEditor.svelte';
	import PagesPanel from '$lib/components/document/panel/PagesPanel.svelte';
	import AppHeader from '$lib/components/header/AppHeader.svelte';
	import { ExportController } from '$lib/components/header/export.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import LayersPanel from '$lib/components/dock/LayersPanel.svelte';
	import LayersPopover from '$lib/components/dock/LayersPopover.svelte';
	import { LAYERS_PANEL_FOOTPRINT_PX, PROJECTION_SEGMENTS } from '$lib/components/dock/options';
	import SegmentedControl from '$lib/components/dock/SegmentedControl.svelte';
	import ChartStage from '$lib/components/stage/ChartStage.svelte';
	import { StageController } from '$lib/components/stage/stage.svelte';
	import { DocumentStore, MAX_CHARTS, MAX_PAGES } from '$lib/document/document.svelte';
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
	import { snapshotChart } from '$lib/document/render';
	import { isApplePlatform, isHelpShortcut, isModShortcut } from '$lib/shortcuts';
	import { LayerState } from '$lib/state/layers.svelte';
	import { ProjectionTransition } from '$lib/state/projection-transition.svelte';
	import { ViewUrl } from '$lib/state/view-url';
	import { catalog } from '$lib/state/catalog.svelte';
	import { Announcer } from '$lib/ui/announcer.svelte';
	import { Dropdown, DropdownGroup } from '$lib/ui/dropdown.svelte';
	import { prefersReducedMotion } from '$lib/ui/motion';
	import { toast } from '$lib/ui/toast.svelte';

	/** The compact header and the collapsed pages panel start here (as in the CSS). */
	const NARROW_QUERY = '(max-width: 743px)';
	const LAYERS_PANEL_ID = 'layers-panel';
	/** Whether the layers panel was left open, kept for the next visit. */
	const LAYERS_PANEL_STORAGE_KEY = 'skycharts.layers.panel';
	/** How long the live region stays empty before new words: a beat it is sure to notice. */
	const ANNOUNCE_SETTLE_MS = 50;

	const layers = new LayerState();
	const projection = new ProjectionTransition();
	const stage = new StageController(layers, projection);
	const viewUrl = new ViewUrl(stage, {
		get hash() {
			return window.location.hash;
		},
		replace: (hash) => replaceState(`#${hash}`, {})
	});
	/** Read out after Add to PDF (the thumbnail's flash is the visual cue) and an export. */
	const voice = new Announcer(
		() => new Promise((settled) => setTimeout(settled, ANNOUNCE_SETTLE_MS))
	);
	// The PDF document. Read from storage on mount, so the server render and hydration agree.
	const documentStore = new DocumentStore();
	const exporter = new ExportController({
		get canvas() {
			return stage.canvas;
		},
		get chartView() {
			return stage.chartView;
		},
		layers,
		document: documentStore,
		announce: voice.say
	});
	const layersMenu = new Dropdown();
	const menus = new DropdownGroup(exporter.menu, layersMenu);

	let aboutOpen = $state(false);
	// ⌘ or Ctrl for the shortcuts; read on mount, so the server render assumes a Mac.
	let apple = $state(true);

	/** The page the editor is open on; null while it is closed. */
	let editorPageId = $state<string | null>(null);
	let pagesPanel = $state<ReturnType<typeof PagesPanel>>();
	let header = $state<ReturnType<typeof AppHeader>>();
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
	const modalOpen = $derived(aboutOpen || editorPageId !== null);
	// On a phone the panel floats over the chart, which it may cover; on a wide screen the chart moves aside.
	const panelReservePx = $derived(narrow ? 0 : panelFootprintPx);
	const layersDocked = $derived(!narrow);
	const layersReservePx = $derived(layersDocked && layersPanelOpen ? LAYERS_PANEL_FOOTPRINT_PX : 0);

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
		viewUrl.read();
		const stopViewUrl = viewUrl.listen();
		// Saves are debounced: write the last one before the tab goes away.
		const flushDocument = () => {
			documentStore.flush();
			viewUrl.flush();
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
				if (!event.repeat) void exporter.toggleMenu();
				return;
			}
			if (isModShortcut(event, 'KeyS', apple)) {
				event.preventDefault();
				if (!event.repeat) void exporter.run('PNG');
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
			stopViewUrl();
			cancelAnimationFrame(motionFrame);
			exporter.dispose();
			narrowQuery.removeEventListener('change', handleNarrowChange);
			window.removeEventListener('pagehide', flushDocument);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			flushDocument();
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', stage.keyup);
			window.removeEventListener('blur', stage.release);
		};
	});

	$effect(() => viewUrl.follow());

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
		voice.say(added);
		notify(relaid ? `${added}, layout updated` : added, () => {
			// Taken back mid-flight: the copy has nowhere to land.
			if (pendingItemId === itemId) {
				pendingItemId = null;
				pdfFlight = null;
			}
			if (undo()) voice.say('Add to PDF undone');
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

	function openEditor(pageId: string) {
		menus.closeAll();
		// Keys held down as the editor opens must not keep turning the sky behind it.
		stage.release();
		documentStore.selectedPageId = pageId;
		editorPageId = pageId;
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
	<AppHeader
		bind:this={header}
		{exporter}
		actions={{ about: () => setAboutOpen(true), addToPdf }}
		{apple}
	/>
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
			onemptied={() => header?.focusAdd()}
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
	<p class="sr-only" role="status">{voice.message}</p>
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

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* Phones only: the compact dock with labels still fits up to the 743 px breakpoint. */
	@media (max-width: 480px) {
		.control-bar {
			width: 100%;
			justify-content: center;
		}
	}
</style>
