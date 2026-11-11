<script lang="ts">
	/**
	 * The generator: the chart with its header and its dock, the PDF document's pages
	 * beside it, and the dialogs over it. The page makes the controllers and puts the
	 * components in their places; what each one does is its own. What the page keeps
	 * is what ties them together: which dialog is open, whether the screen is narrow,
	 * the keys it binds itself (`$lib/shortcuts`), and what is saved as the tab goes.
	 */
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import AboutDialog from '$lib/components/AboutDialog.svelte';
	import ControlBar from '$lib/components/dock/ControlBar.svelte';
	import { LayersDock } from '$lib/components/dock/layers-dock.svelte';
	import LayersPanel from '$lib/components/dock/LayersPanel.svelte';
	import { LAYERS_PANEL_FOOTPRINT_PX } from '$lib/components/dock/options';
	import FlyingCopy from '$lib/components/document/flight/FlyingCopy.svelte';
	import { PdfFlight } from '$lib/components/document/flight/pdf-flight.svelte';
	import PageEditor from '$lib/components/document/PageEditor.svelte';
	import PagesPanel from '$lib/components/document/panel/PagesPanel.svelte';
	import AppHeader from '$lib/components/header/AppHeader.svelte';
	import { ExportController } from '$lib/components/header/export.svelte';
	import ChartStage from '$lib/components/stage/ChartStage.svelte';
	import { StageController } from '$lib/components/stage/stage.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { DocumentStore } from '$lib/document/document.svelte';
	import { isApplePlatform, pageCommand } from '$lib/shortcuts';
	import { LayerState } from '$lib/state/layers.svelte';
	import { ProjectionTransition } from '$lib/state/projection-transition.svelte';
	import { ViewUrl } from '$lib/state/view-url';
	import { Announcer } from '$lib/ui/announcer.svelte';
	import { Dropdown, DropdownGroup } from '$lib/ui/dropdown.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	/** The compact header and the collapsed pages panel start here (as in the CSS). */
	const NARROW_QUERY = '(max-width: 743px)';
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
	const layersDock = new LayersDock(layersMenu);
	const menus = new DropdownGroup(exporter.menu, layersMenu);
	const headerActions = { about: () => setAboutOpen(true), addToPdf: flight.add };

	let aboutOpen = $state(false);
	// ⌘ or Ctrl for the shortcuts; read on mount, so the server render assumes a Mac.
	let apple = $state(true);
	/** The page the editor is open on; null while it is closed. */
	let editorPageId = $state<string | null>(null);
	let header = $state<ReturnType<typeof AppHeader>>();
	let pagesPanel = $state<ReturnType<typeof PagesPanel>>();
	/** How far the pages panel reaches into the chart area, px; the chart keeps clear of it. */
	let panelFootprintPx = $state(0);
	let narrow = $state(false);
	/**
	 * The page has settled after its load: from here on a panel that opens slides
	 * and the chart moves with it. Before, what storage remembers is simply there.
	 */
	let motionReady = $state(false);
	const modalOpen = $derived(aboutOpen || editorPageId !== null);
	// On a phone the panel floats over the chart, which it may cover; on a wide screen the chart moves aside.
	const panelReservePx = $derived(narrow ? 0 : panelFootprintPx);
	/** The layers panel is beside the chart where there is room for it; a phone keeps the popover. */
	const layersDocked = $derived(!narrow);
	const layersReservePx = $derived(layersDocked && layersDock.open ? LAYERS_PANEL_FOOTPRINT_PX : 0);

	onMount(() => {
		apple = isApplePlatform(navigator);
		const narrowQuery = window.matchMedia(NARROW_QUERY);
		narrow = narrowQuery.matches;
		const handleNarrowChange = (event: MediaQueryListEvent) => (narrow = event.matches);
		narrowQuery.addEventListener('change', handleNarrowChange);
		documentStore.load();
		// Collapsed by default on a phone, where the open panel would cover the chart.
		if (narrow) documentStore.panelOpen = false;
		layersDock.restore();
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
		const stopMenuDismiss = menus.listen();
		window.addEventListener('keydown', handleKeydown);
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
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('keyup', stage.keyup);
			window.removeEventListener('blur', stage.release);
		};
	});

	$effect(() => viewUrl.follow());

	/** The page's own keys (`pageCommand`); the ones it leaves alone turn the sky. */
	function handleKeydown(event: KeyboardEvent) {
		const command = pageCommand(event, apple);
		// ⌘Z/Ctrl+Z takes back what the toast offers to undo, from anywhere; the editor,
		// which keeps its keys from the page, does the same through its `undo`.
		if (command === 'undo' && toast.current?.undo) return once(event, () => toast.undo());
		// The editor is modal and handles its own keys; nothing here acts behind it.
		if (editorPageId !== null) return;
		if (command === 'help') return once(event, () => setAboutOpen(!aboutOpen));
		// The dialog is modal: the chart and the menus behind it stay put.
		if (aboutOpen) return;
		if (command === 'exportMenu') return once(event, () => void exporter.toggleMenu());
		if (command === 'savePng') return once(event, () => void exporter.run('PNG'));
		if (command === 'switchProjection') {
			event.preventDefault();
			stage.switchProjection(projection.otherMode);
		}
		stage.keydown(event);
	}

	/** A shortcut's key is the page's alone, and held down it acts once. */
	function once(event: KeyboardEvent, act: () => void) {
		event.preventDefault();
		if (!event.repeat) act();
	}

	function openEditor(pageId: string) {
		menus.closeAll();
		// Keys held down as the editor opens must not keep turning the sky behind it.
		stage.release();
		documentStore.selectedPageId = pageId;
		editorPageId = pageId;
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
	<AppHeader bind:this={header} {exporter} actions={headerActions} {apple} />
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
				bind:this={layersDock.panel}
				{layers}
				open={layersDock.open}
				animated={motionReady}
				id={layersDock.id}
				onclose={layersDock.close}
			/>
		{/if}
	</ChartStage>
	<ControlBar
		projection={projection.mode}
		onprojection={stage.switchProjection}
		{layers}
		{layersMenu}
		dock={layersDock}
		docked={layersDocked}
	/>
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

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
