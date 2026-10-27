<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { loadConstellationBoundaries, loadConstellations, loadStars } from '$lib/api/catalog';
	import { exportChart, type ExportFormat } from '$lib/api/export';
	import AboutDialog from '$lib/components/AboutDialog.svelte';
	import PinholeFrameOverlay from '$lib/components/PinholeFrameOverlay.svelte';
	import LayersPopover from '$lib/components/dock/LayersPopover.svelte';
	import { PROJECTION_SEGMENTS } from '$lib/components/dock/options';
	import SegmentedControl from '$lib/components/dock/SegmentedControl.svelte';
	import { CHART_CANVAS_BACKING_PX } from '$lib/constants';
	import { loadFlubberInterpolator } from '$lib/flubber';
	import { CanvasRenderer } from '$lib/renderer/canvas-renderer';
	import { InputController } from '$lib/renderer/input-handlers';
	import { isApplePlatform, isHelpShortcut, isModShortcut } from '$lib/shortcuts';
	import { LayerState } from '$lib/state/layers.svelte';
	import {
		ProjectionTransition,
		type ProjectionMode
	} from '$lib/state/projection-transition.svelte';
	import { catalog, view } from '$lib/stores.svelte';
	import { Dropdown, DropdownGroup } from '$lib/ui/dropdown.svelte';

	const EXPORT_FORMATS = ['PNG', 'SVG', 'PDF'] as const satisfies readonly ExportFormat[];

	let canvasEl: HTMLCanvasElement | null = null;
	let chartAreaEl: HTMLElement | null = null;
	let chartSurfaceEl: HTMLDivElement | null = null;
	let surfaceSizePx = $state(1);
	// The chart area clips the surface; the frame overlay keeps its handles inside it.
	let chartClipWidthPx = $state(1);
	let chartClipHeightPx = $state(1);
	let pinholeOverlay = $state<ReturnType<typeof PinholeFrameOverlay>>();
	let input: InputController | null = null;
	let renderer: CanvasRenderer | null = null;
	let rafId = 0;
	let renderDirty = false;
	let lastFrameTimeMs = 0;

	const layers = new LayerState();
	const projection = new ProjectionTransition();
	const exportMenu = new Dropdown();
	const layersMenu = new Dropdown();
	const menus = new DropdownGroup(exportMenu, layersMenu);

	let selectedExportFormat = $state<ExportFormat>('PNG');
	let exportMenuEl = $state<HTMLDivElement | null>(null);
	let aboutOpen = $state(false);
	// ⌘ or Ctrl for the shortcuts; read on mount, so the server render assumes a Mac.
	let apple = $state(true);

	onMount(() => {
		apple = isApplePlatform(navigator);
		input = new InputController({
			canvas: () => canvasEl,
			onChange: markRenderDirty,
			getMode: () => (projection.blend < 0.5 ? 'stereographic' : 'pinhole')
		});
		renderer = canvasEl ? new CanvasRenderer(canvasEl) : null;

		const surfaceObserver = chartSurfaceEl
			? new ResizeObserver((entries) => {
					for (const entry of entries) {
						if (entry.target === chartSurfaceEl) {
							const { width, height } = entry.contentRect;
							surfaceSizePx = Math.max(1, Math.min(width, height));
						} else if (entry.target === chartAreaEl) {
							measureChartClip();
						}
					}
				})
			: null;
		if (surfaceObserver && chartSurfaceEl) {
			surfaceObserver.observe(chartSurfaceEl);
			const rect = chartSurfaceEl.getBoundingClientRect();
			surfaceSizePx = Math.max(1, Math.min(rect.width, rect.height));
		}
		if (surfaceObserver && chartAreaEl) {
			surfaceObserver.observe(chartAreaEl);
			measureChartClip();
		}

		// Zoom gestures are taken on the whole chart surface, not just the canvas, so a
		// trackpad pinch over the frame's resize handles still zooms the sky instead of
		// the page.
		const handleChartWheel = (event: WheelEvent) => input?.onCanvasWheel(event);
		const handleChartGestureStart = (event: Event) => input?.onCanvasGestureStart(event);
		const handleChartGestureChange = (event: Event) => input?.onCanvasGestureChange(event);

		const handleKeyDown = (event: KeyboardEvent) => {
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
				if (!event.repeat) runExport('PNG');
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
				switchProjection(projection.otherMode);
			}
			input?.onKeyDown(event);
		};
		const handleKeyUp = (event: KeyboardEvent) => input?.onKeyUp(event);
		const handleBlur = () => input?.onBlur();
		const stopMenuDismiss = menus.listen();
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		window.addEventListener('blur', handleBlur);
		chartSurfaceEl?.addEventListener('wheel', handleChartWheel, { passive: false });
		chartSurfaceEl?.addEventListener('gesturestart', handleChartGestureStart, { passive: false });
		chartSurfaceEl?.addEventListener('gesturechange', handleChartGestureChange, {
			passive: false
		});

		void loadFlubberInterpolator().then((interpolate) => {
			renderer?.setMorphInterpolatorFactory(interpolate);
			markRenderDirty();
		});
		void loadStars().then(markRenderDirty);
		void loadConstellations().then(markRenderDirty);
		void loadConstellationBoundaries().then(markRenderDirty);
		return () => {
			stopMenuDismiss();
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('blur', handleBlur);
			chartSurfaceEl?.removeEventListener('wheel', handleChartWheel);
			chartSurfaceEl?.removeEventListener('gesturestart', handleChartGestureStart);
			chartSurfaceEl?.removeEventListener('gesturechange', handleChartGestureChange);
			surfaceObserver?.disconnect();
			if (rafId) {
				cancelAnimationFrame(rafId);
			}
			input = null;
		};
	});

	function measureChartClip() {
		if (!chartAreaEl) return;
		chartClipWidthPx = Math.max(1, chartAreaEl.clientWidth);
		chartClipHeightPx = Math.max(1, chartAreaEl.clientHeight);
	}

	function markRenderDirty() {
		renderDirty = true;
		scheduleFrame();
	}

	function scheduleFrame() {
		if (rafId) return;
		rafId = requestAnimationFrame(onFrame);
	}

	function onFrame(frameTimeMs: number) {
		rafId = 0;
		const dtMs = lastFrameTimeMs > 0 ? Math.min(frameTimeMs - lastFrameTimeMs, 100) : 16;
		lastFrameTimeMs = frameTimeMs;

		// A frame-resize drag applies its latest pointer position here, so the overlay
		// and the canvas move together, at most once per frame.
		if (pinholeOverlay?.flush()) renderDirty = true;

		const inputActive = input?.tick(dtMs) ?? false;
		if (inputActive) renderDirty = true;

		const linesAnimating = renderer?.hasActiveLineAnimations() ?? false;
		if (!renderDirty && !projection.animating && !linesAnimating) {
			lastFrameTimeMs = 0;
			return;
		}
		renderDirty = false;

		projection.tick(frameTimeMs);
		renderer?.render({
			orientation: view.orientation,
			stereoFovDeg: view.stereoFovDeg,
			pinholeFovDeg: view.pinholeFovDeg,
			pinholeAspectRatio: view.pinholeAspectRatio,
			pinholeHeightFrac: view.pinholeHeightFrac,
			starVectors: catalog.starVectors,
			projectionBlend: projection.blend,
			referenceLines: layers.referenceLines,
			constellations: catalog.constellations,
			constellationBoundaries: catalog.constellationBoundaries
		});

		const linesAnimatingAfter = renderer?.hasActiveLineAnimations() ?? false;
		if (projection.animating || inputActive || linesAnimatingAfter) {
			scheduleFrame();
		} else {
			lastFrameTimeMs = 0;
		}
	}

	$effect(() => {
		// Reading the snapshot subscribes to every reference-line flag at once.
		void layers.referenceLines;
		markRenderDirty();
	});

	function switchProjection(nextMode: ProjectionMode) {
		projection.start(nextMode);
		markRenderDirty();
	}

	function runExport(format: ExportFormat) {
		void exportChart(canvasEl, {
			format,
			projection: projection.mode,
			layers: {
				planets: layers.planets,
				equator: layers.equator,
				ecliptic: layers.ecliptic,
				galacticEquator: layers.galacticEquator
			}
		});
	}

	function handleExportFormatSelect(format: ExportFormat) {
		selectedExportFormat = format;
		exportMenu.close();
		runExport(format);
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
		const items = Array.from(
			exportMenuEl?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []
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

	function setAboutOpen(next: boolean) {
		if (next) {
			menus.closeAll();
			// Keys held down as the dialog opens must not keep turning the sky behind it.
			input?.onBlur();
		}
		aboutOpen = next;
	}
</script>

<main
	class="page"
	onpointerdown={(event) => input?.onPointerDown(event)}
	onpointermove={(event) => {
		input?.onPointerMove(event);
		pinholeOverlay?.trackPointer(event);
	}}
	onpointerleave={() => pinholeOverlay?.clearPointer()}
	onpointerup={(event) => input?.onPointerUp(event)}
	onpointercancel={(event) => input?.onPointerUp(event)}
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
					<svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="6.25" />
						<path d="M8 7.5v3.5M8 5.1v.01" />
					</svg>
					About
				</button>
				<button class="tool-btn" type="button">Format</button>
				<div class="export-wrap" bind:this={exportMenu.element}>
					<button class="export-main" type="button" onclick={() => runExport(selectedExportFormat)}>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path
								d="M8 1.75a.75.75 0 0 1 .75.75v5.69l1.97-1.97a.75.75 0 1 1 1.06 1.06L8.53 10.53a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 1.06-1.06l1.97 1.97V2.5A.75.75 0 0 1 8 1.75ZM2.75 12a.75.75 0 0 1 .75.75v.5h9v-.5a.75.75 0 0 1 1.5 0V13A1.75 1.75 0 0 1 12.25 14.75h-8.5A1.75 1.75 0 0 1 2 13v-.25a.75.75 0 0 1 .75-.75Z"
							/>
						</svg>
						<span class="export-label-full">Export Image</span>
						<span class="export-label-short" aria-hidden="true">{selectedExportFormat}</span>
					</button>
					<button
						bind:this={exportMenu.trigger}
						class="export-toggle"
						type="button"
						aria-label="Choose export format"
						aria-haspopup="menu"
						aria-expanded={exportMenu.open}
						onclick={() => exportMenu.toggle()}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path
								d="M4.22 6.97a.75.75 0 0 1 1.06 0L8 9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 0 1 0-1.06Z"
							/>
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
							{#each EXPORT_FORMATS as format (format)}
								<button
									class="export-option"
									class:is-selected={format === selectedExportFormat}
									type="button"
									role="menuitemradio"
									aria-checked={format === selectedExportFormat}
									onclick={() => handleExportFormatSelect(format)}
								>
									<span class="export-option-icon" aria-hidden="true">
										{#if format === 'PNG'}
											◼
										{:else if format === 'SVG'}
											◇
										{:else}
											▤
										{/if}
									</span>
									<span class="export-option-label">{format}</span>
									<span class="export-option-check" aria-hidden="true">
										{format === selectedExportFormat ? '✓' : ''}
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</header>
	<section class="chart-area" bind:this={chartAreaEl}>
		<div class="chart-surface" bind:this={chartSurfaceEl}>
			<canvas bind:this={canvasEl} width={CHART_CANVAS_BACKING_PX} height={CHART_CANVAS_BACKING_PX}
			></canvas>
			<PinholeFrameOverlay
				bind:this={pinholeOverlay}
				{surfaceSizePx}
				clipWidthPx={chartClipWidthPx}
				clipHeightPx={chartClipHeightPx}
				visible={projection.isPinholeSettled}
				onChange={markRenderDirty}
			/>
		</div>
	</section>
	<div class="control-bar-shell">
		<div class="control-bar" role="group" aria-label="Generator display controls">
			<div class="control-group">
				<SegmentedControl
					label="Projection"
					options={PROJECTION_SEGMENTS}
					value={projection.mode}
					onselect={switchProjection}
					shortcut="Shift+P"
				/>
			</div>
			<span class="control-divider" aria-hidden="true"></span>
			<div class="control-group">
				<LayersPopover {layers} menu={layersMenu} />
			</div>
		</div>
	</div>
</main>
<AboutDialog bind:open={aboutOpen} {apple} />

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

	.chart-area {
		min-height: 0;
		min-width: 0;
		padding: 12px;
		display: grid;
		place-items: center;
		overflow: hidden;
		container-type: size;
	}

	.chart-surface {
		/* Квадрат: сторона = min(ширина области, высота области, фикс. кап).
		   100cqmin = меньшая сторона .chart-area, кап даёт стабильный размер на десктопе. */
		--chart-cap: 720px;
		position: relative;
		width: min(100cqmin, var(--chart-cap));
		height: min(100cqmin, var(--chart-cap));
		display: grid;
		place-items: center;
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

	.tool-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 11px;
		border-radius: 7px;
		border: 1px solid transparent;
		background: transparent;
		color: #b8bec8;
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		transition:
			border-color 0.16s ease,
			color 0.16s ease,
			box-shadow 0.2s ease,
			background 0.2s ease;
	}

	.tool-btn:hover {
		border-color: rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.06);
		color: #f1f3f6;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
	}

	.tool-btn:active {
		background: rgba(255, 255, 255, 0.08);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
	}

	.tool-icon {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.export-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 30px;
		border-radius: 8px;
		border: 1px solid rgba(255, 124, 124, 0.88);
		background: linear-gradient(180deg, #d34b4b 0%, #bd3d3d 100%);
		box-shadow: 0 0 0 1px rgba(204, 70, 70, 0.5);
		/* No overflow clipping here: the format menu hangs below the wrap. The two
		   buttons round their own outer corners so their hover fills stay inside. */
	}

	.export-wrap:hover {
		background: linear-gradient(180deg, #df5757 0%, #c94848 100%);
		border-color: rgba(255, 148, 148, 0.92);
	}

	.export-main,
	.export-toggle {
		height: 100%;
		border: 0;
		background: transparent;
		color: #fff0f0;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
		font-size: 0.74rem;
		font-weight: 600;
	}

	.export-main {
		gap: 7px;
		padding: 0 12px 0 11px;
		border-radius: 7px 0 0 7px;
	}

	.export-main span {
		color: #ffd1d1;
	}

	.export-main svg,
	.export-toggle svg {
		width: 14px;
		height: 14px;
		fill: currentColor;
	}

	.export-label-short {
		display: none;
	}

	.export-toggle {
		width: 30px;
		justify-content: center;
		border-left: 1px solid rgba(255, 219, 219, 0.28);
		border-radius: 0 7px 7px 0;
	}

	.export-toggle[aria-expanded='true'] {
		background: rgba(255, 255, 255, 0.12);
	}

	.export-main:hover,
	.export-toggle:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.export-main:active,
	.export-toggle:active {
		background: rgba(255, 255, 255, 0.14);
	}

	.export-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		min-width: 138px;
		padding: 4px;
		border-radius: 9px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: linear-gradient(180deg, #1b1d22 0%, #14161b 100%);
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.42),
			0 1px 0 rgba(255, 255, 255, 0.08) inset;
		display: grid;
		gap: 2px;
		z-index: 20;
	}

	.export-option {
		height: 30px;
		padding: 0 8px;
		border-radius: 6px;
		border: 0;
		background: transparent;
		color: #c9ced7;
		font-size: 0.72rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		line-height: 1;
		display: grid;
		grid-template-columns: 14px 1fr auto;
		align-items: center;
		column-gap: 8px;
		cursor: pointer;
		transition:
			background 0.14s ease,
			color 0.14s ease;
	}

	.export-option-icon {
		color: #8f96a1;
		font-size: 0.6rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
	}

	.export-option-label {
		text-align: left;
	}

	.export-option-check {
		color: #e7ebf4;
		font-size: 0.66rem;
		min-width: 10px;
		text-align: right;
		opacity: 0.95;
	}

	.export-option:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #eef2fa;
	}

	.export-option:active {
		background: rgba(255, 255, 255, 0.12);
	}

	.export-option:focus-visible {
		outline: none;
		background: rgba(255, 255, 255, 0.08);
		color: #eef2fa;
		box-shadow: var(--ring);
	}

	.export-menu:focus {
		outline: none;
	}

	.export-option.is-selected {
		background: rgba(255, 255, 255, 0.1);
		color: #f3f6fd;
	}

	.export-option.is-selected .export-option-icon {
		color: #d5dbea;
	}

	canvas {
		width: 100%;
		height: 100%;
		display: block;
		aspect-ratio: 1 / 1;
		object-fit: contain;
		touch-action: none;
		cursor: grab;
	}

	canvas:active {
		cursor: grabbing;
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
		/* On a phone they only push Export off screen: Format does nothing yet, and About is
		   mostly a list of keyboard shortcuts (ray.so hides it there too). */
		.tool-btn {
			display: none;
		}

		.export-main {
			gap: 6px;
			padding: 0 10px 0 9px;
		}

		/* "⤓ PNG ▾": the format replaces the label, which stays for screen readers. */
		.export-label-full {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		.export-label-short {
			display: inline;
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
