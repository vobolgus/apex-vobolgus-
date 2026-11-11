<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import AboutDialog from '$lib/components/AboutDialog.svelte';
	import FlyingCopy from '$lib/components/document/FlyingCopy.svelte';
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
	import { DocumentStore } from '$lib/document/document.svelte';
	import { PdfFlight } from '$lib/document/pdf-flight.svelte';
	import { isApplePlatform, isHelpShortcut, isModShortcut } from '$lib/shortcuts';
	import { LayerState } from '$lib/state/layers.svelte';
	import { ProjectionTransition } from '$lib/state/projection-transition.svelte';
	import { ViewUrl } from '$lib/state/view-url';
	import { Announcer } from '$lib/ui/announcer.svelte';
	import { Dropdown, DropdownGroup } from '$lib/ui/dropdown.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	/** The compact header and the collapsed pages panel start here (as in the CSS). */
	const NARROW_QUERY = '(max-width: 743px)';
	const LAYERS_PANEL_ID = 'layers-panel';
	/** Whether the layers panel was left open, kept for the next visit. */
	const LAYERS_PANEL_STORAGE_KEY = 'skycharts.layers.panel';
	/** How long the live region stays empty before new words: a beat it is sure to notice. */
	const ANNOUNCE_SETTLE_MS = 50;

	const notify = (message: string, undo?: () => void) => {
		toast.show(message, undo);
	};
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
	const flight = new PdfFlight({
		store: documentStore,
		get canvas() {
			return stage.canvas;
		},
		get chartView() {
			return stage.chartView;
		},
		layers,
		get panel() {
			return pagesPanel;
		},
		announce: voice.say,
		notify
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
	const modalOpen = $derived(aboutOpen || editorPageId !== null);
	// On a phone the panel floats over the chart, which it may cover; on a wide screen the chart moves aside.
	const panelReservePx = $derived(narrow ? 0 : panelFootprintPx);
	const layersDocked = $derived(!narrow);
	const layersReservePx = $derived(layersDocked && layersPanelOpen ? LAYERS_PANEL_FOOTPRINT_PX : 0);

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
		actions={{ about: () => setAboutOpen(true), addToPdf: flight.add }}
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
			pendingItemId={flight.pendingId}
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
<FlyingCopy {flight} />
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
