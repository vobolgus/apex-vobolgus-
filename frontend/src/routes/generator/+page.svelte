<script lang="ts">
	import { onMount } from 'svelte';
	import { loadConstellationBoundaries, loadConstellations, loadStars } from '$lib/api/catalog';
	import { exportChart, type ExportFormat } from '$lib/api/export';
	import PinholeResizeHandles from '$lib/components/PinholeResizeHandles.svelte';
	import PlanetsToggle from '$lib/components/PlanetsToggle.svelte';
	import { CHART_RADIUS_FRAC } from '$lib/constants';
	import { loadFlubberInterpolator } from '$lib/flubber';
	import { CanvasRenderer } from '$lib/renderer/canvas-renderer';
	import { InputController } from '$lib/renderer/input-handlers';
	import { LayerState, REFERENCE_LINE_OPTIONS } from '$lib/state/layers.svelte';
	import {
		PROJECTION_OPTIONS,
		ProjectionTransition,
		type ProjectionMode
	} from '$lib/state/projection-transition.svelte';
	import { catalog, view } from '$lib/stores.svelte';
	import { Dropdown, DropdownGroup } from '$lib/ui/dropdown.svelte';

	const EXPORT_FORMATS = ['PNG', 'SVG', 'PDF'] as const satisfies readonly ExportFormat[];

	let canvasEl: HTMLCanvasElement | null = null;
	let chartSurfaceEl: HTMLDivElement | null = null;
	let surfaceSizePx = $state(1);
	let input: InputController | null = null;
	let renderer: CanvasRenderer | null = null;
	let rafId = 0;
	let renderDirty = false;
	let lastFrameTimeMs = 0;

	const layers = new LayerState();
	const projection = new ProjectionTransition();
	const exportMenu = new Dropdown();
	const projectionMenu = new Dropdown();
	const linesMenu = new Dropdown();
	const menus = new DropdownGroup(exportMenu, projectionMenu, linesMenu);

	let selectedExportFormat = $state<ExportFormat>('PNG');

	onMount(() => {
		input = new InputController({
			canvas: () => canvasEl,
			onChange: markRenderDirty,
			getMode: () => (projection.blend < 0.5 ? 'stereographic' : 'pinhole')
		});
		renderer = canvasEl ? new CanvasRenderer(canvasEl) : null;

		const surfaceObserver = chartSurfaceEl
			? new ResizeObserver((entries) => {
					for (const entry of entries) {
						const { width, height } = entry.contentRect;
						surfaceSizePx = Math.max(1, Math.min(width, height));
					}
				})
			: null;
		if (surfaceObserver && chartSurfaceEl) {
			surfaceObserver.observe(chartSurfaceEl);
			const rect = chartSurfaceEl.getBoundingClientRect();
			surfaceSizePx = Math.max(1, Math.min(rect.width, rect.height));
		}

		const handleCanvasWheel = (event: WheelEvent) => input?.onCanvasWheel(event);
		const handleCanvasGestureStart = (event: Event) => input?.onCanvasGestureStart(event);
		const handleCanvasGestureChange = (event: Event) => input?.onCanvasGestureChange(event);

		const handleKeyDown = (event: KeyboardEvent) => {
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
		canvasEl?.addEventListener('wheel', handleCanvasWheel, { passive: false });
		canvasEl?.addEventListener('gesturestart', handleCanvasGestureStart, { passive: false });
		canvasEl?.addEventListener('gesturechange', handleCanvasGestureChange, { passive: false });

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
			canvasEl?.removeEventListener('wheel', handleCanvasWheel);
			canvasEl?.removeEventListener('gesturestart', handleCanvasGestureStart);
			canvasEl?.removeEventListener('gesturechange', handleCanvasGestureChange);
			surfaceObserver?.disconnect();
			if (rafId) {
				cancelAnimationFrame(rafId);
			}
			input = null;
		};
	});

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
		projectionMenu.close();
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
</script>

<main
	class="page"
	onpointerdown={(event) => input?.onPointerDown(event)}
	onpointermove={(event) => input?.onPointerMove(event)}
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
				<button class="tool-btn" type="button">About</button>
				<button class="tool-btn" type="button">Format</button>
				<div class="export-wrap" bind:this={exportMenu.element}>
					<button class="export-main" type="button" onclick={() => runExport(selectedExportFormat)}>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path
								d="M8 1.75a.75.75 0 0 1 .75.75v5.69l1.97-1.97a.75.75 0 1 1 1.06 1.06L8.53 10.53a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 1.06-1.06l1.97 1.97V2.5A.75.75 0 0 1 8 1.75ZM2.75 12a.75.75 0 0 1 .75.75v.5h9v-.5a.75.75 0 0 1 1.5 0V13A1.75 1.75 0 0 1 12.25 14.75h-8.5A1.75 1.75 0 0 1 2 13v-.25a.75.75 0 0 1 .75-.75Z"
							/>
						</svg>
						<span>Export Image</span>
					</button>
					<button
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
						<div class="export-menu" role="menu" aria-label="Export format">
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
	<section class="chart-area">
		<div class="chart-surface" bind:this={chartSurfaceEl}>
			<canvas bind:this={canvasEl} width="1200" height="1200"></canvas>
			<PinholeResizeHandles
				viewportWidthPx={surfaceSizePx *
					CHART_RADIUS_FRAC *
					(view.pinholeAspectRatio * view.pinholeHeightFrac)}
				viewportHeightPx={surfaceSizePx * CHART_RADIUS_FRAC * view.pinholeHeightFrac}
				visible={projection.isPinholeSettled}
				onChange={markRenderDirty}
			/>
		</div>
	</section>
	<div class="control-bar-shell">
		<div class="control-bar" role="group" aria-label="Generator display controls">
			<div class="control-group projection-group">
				<span class="control-label control-label-no-caps" id="projection-label">Projection</span>
				<div class="projection-wrap" bind:this={projectionMenu.element}>
					<button
						class="projection-trigger"
						type="button"
						aria-haspopup="listbox"
						aria-expanded={projectionMenu.open}
						aria-labelledby="projection-label projection-trigger-value"
						onclick={() => projectionMenu.toggle()}
					>
						<span id="projection-trigger-value">{projection.mode}</span>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path
								d="M4.22 6.97a.75.75 0 0 1 1.06 0L8 9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 0 1 0-1.06Z"
							/>
						</svg>
					</button>
					{#if projectionMenu.open}
						<div class="projection-menu" role="listbox" aria-labelledby="projection-label">
							{#each PROJECTION_OPTIONS as mode (mode)}
								<button
									class="projection-option"
									class:is-selected={mode === projection.mode}
									type="button"
									role="option"
									aria-selected={mode === projection.mode}
									onclick={() => switchProjection(mode)}
								>
									<span class="projection-option-label">{mode}</span>
									<span class="projection-option-check" aria-hidden="true">
										{mode === projection.mode ? '✓' : ''}
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
			<div class="control-divider"></div>
			<div class="control-group">
				<span class="control-label control-label-no-caps">Layers</span>
				<PlanetsToggle bind:showPlanets={layers.planets} />
				<div class="projection-wrap is-lines" bind:this={linesMenu.element}>
					<button
						class="projection-trigger"
						type="button"
						aria-haspopup="menu"
						aria-expanded={linesMenu.open}
						aria-label="Reference lines"
						onclick={() => linesMenu.toggle()}
					>
						<span>Lines</span>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path
								d="M4.22 6.97a.75.75 0 0 1 1.06 0L8 9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 0 1 0-1.06Z"
							/>
						</svg>
					</button>
					{#if linesMenu.open}
						<div class="projection-menu" role="menu" aria-label="Reference lines">
							{#each REFERENCE_LINE_OPTIONS as option (option.key)}
								<button
									class="projection-option"
									class:is-selected={layers[option.key]}
									type="button"
									role="menuitemcheckbox"
									aria-checked={layers[option.key]}
									onclick={() => layers.toggle(option.key)}
								>
									<span class="projection-option-label">{option.label}</span>
									<span class="lines-tickbox" class:is-on={layers[option.key]} aria-hidden="true">
										{#if layers[option.key]}
											<svg viewBox="0 0 12 12"
												><path
													d="M2.5 6.2 L5 8.5 L9.5 3.8"
													fill="none"
													stroke="currentColor"
													stroke-width="1.8"
													stroke-linecap="round"
													stroke-linejoin="round"
												/></svg
											>
										{/if}
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</main>

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

	.export-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 30px;
		border-radius: 8px;
		border: 1px solid rgba(255, 124, 124, 0.88);
		background: linear-gradient(180deg, #d34b4b 0%, #bd3d3d 100%);
		box-shadow: 0 0 0 1px rgba(204, 70, 70, 0.5);
		overflow: hidden;
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

	.export-toggle {
		width: 30px;
		justify-content: center;
		border-left: 1px solid rgba(255, 219, 219, 0.28);
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
		pointer-events: none;
		z-index: 6;
		padding-top: 8px;
	}

	.control-bar {
		width: 744px;
		max-width: 744px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		row-gap: 10px;
		gap: 12px;
		padding: 14px 18px;
		border-radius: 20px 20px 0 0;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: linear-gradient(180deg, #141518 0%, #0f1012 100%);
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.42),
			0 1px 0 rgba(255, 255, 255, 0.06) inset;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		overflow: visible;
		pointer-events: auto;
	}

	.control-group {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.projection-group {
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	.control-label {
		color: #9299a6;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.control-label-no-caps {
		text-transform: none;
		letter-spacing: 0;
	}

	.control-divider {
		width: 1px;
		height: 24px;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.04) 0%,
			rgba(255, 255, 255, 0.22) 48%,
			rgba(255, 255, 255, 0.04) 100%
		);
		flex-shrink: 0;
	}

	.projection-wrap {
		position: relative;
	}

	.projection-trigger {
		height: 28px;
		min-width: 146px;
		padding: 0 10px 0 12px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.13);
		background: rgba(255, 255, 255, 0.03);
		color: #d8deea;
		font-size: 0.72rem;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		text-transform: lowercase;
		cursor: pointer;
		transition:
			border-color 0.16s ease,
			background 0.16s ease,
			color 0.16s ease;
	}

	.projection-trigger svg {
		width: 14px;
		height: 14px;
		fill: #adb4bf;
		flex-shrink: 0;
		transition:
			transform 0.14s ease,
			fill 0.14s ease;
	}

	.projection-trigger:hover {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f9;
	}

	.projection-trigger[aria-expanded='true'] {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.projection-trigger[aria-expanded='true'] svg {
		transform: rotate(180deg);
		fill: #d1d7e2;
	}

	.projection-trigger:active {
		background: rgba(255, 255, 255, 0.12);
	}

	.projection-trigger:focus-visible {
		outline: 2px solid rgba(209, 215, 226, 0.48);
		outline-offset: 2px;
	}

	.projection-menu {
		position: absolute;
		left: 0;
		bottom: calc(100% + 6px);
		width: 100%;
		max-height: min(220px, calc(100vh - 24px));
		overflow-y: auto;
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

	.projection-option {
		height: 30px;
		padding: 0 9px;
		border-radius: 6px;
		border: 0;
		background: transparent;
		color: #c9ced7;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		line-height: 1;
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		column-gap: 8px;
		cursor: pointer;
		text-transform: lowercase;
		transition:
			background 0.14s ease,
			color 0.14s ease;
	}

	.projection-option-label {
		text-align: left;
	}

	.projection-option-check {
		color: #e7ebf4;
		font-size: 0.66rem;
		min-width: 10px;
		text-align: right;
		opacity: 0.95;
	}

	.projection-option:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #eef2fa;
	}

	.projection-option:active {
		background: rgba(255, 255, 255, 0.12);
	}

	.projection-option.is-selected {
		background: rgba(255, 255, 255, 0.1);
		color: #f3f6fd;
	}

	.projection-wrap.is-lines .projection-trigger {
		min-width: 0;
		padding: 0 8px 0 12px;
		text-transform: none;
	}

	.projection-wrap.is-lines .projection-menu {
		width: max-content;
		min-width: 100%;
	}

	.projection-wrap.is-lines .projection-option {
		text-transform: none;
		white-space: nowrap;
		grid-template-columns: 1fr auto;
		column-gap: 14px;
	}

	.projection-wrap.is-lines .projection-option-label {
		white-space: nowrap;
	}

	.lines-tickbox {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		border: 1px solid rgba(255, 255, 255, 0.32);
		background: rgba(255, 255, 255, 0.04);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #0a0a0b;
		transition:
			background 0.14s ease,
			border-color 0.14s ease;
	}

	.lines-tickbox.is-on {
		background: #e7ebf4;
		border-color: #e7ebf4;
	}

	.lines-tickbox svg {
		width: 12px;
		height: 12px;
		display: block;
	}

	@media (max-width: 743px) {
		.control-bar {
			width: 100%;
			max-width: 100%;
			padding: 14px 18px;
			gap: 12px;
			border-radius: 0;
			border-left: 0;
			border-right: 0;
		}
	}
</style>
