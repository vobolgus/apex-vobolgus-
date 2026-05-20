<script lang="ts">
	import { projectPointerToArcball } from '$lib/math/arcball';
	import {
		EPSILON,
		MAX_FOV_DEG,
		MIN_FOV_DEG,
		PROJECTION_TRANSITION_MIN_MS,
		PROJECTION_TRANSITION_MS
	} from '$lib/constants';
	import { clamp } from '$lib/math/easing';
	import { CanvasRenderer, getProjectionBlend } from '$lib/renderer/canvas-renderer';
	import type { MorphInterpolatorFactory, ProjectionAnimationState } from '$lib/renderer/types';
	import { catalog, view } from '$lib/stores.svelte';
	import { onMount } from 'svelte';
	import {
		multiplyQuaternions,
		normalizeQuaternion,
		quaternionBetweenVectors,
		type Vec3
	} from '$lib/math/quaternion';

	let canvasEl: HTMLCanvasElement | null = null;
	let dragging = false;
	let lastArcballVector: Vec3 | null = null;
	let activePointerId: number | null = null;
	let rafId = 0;
	let renderDirty = false;
	let exportMenuOpen = $state(false);
	let selectedExportFormat = $state<'PNG' | 'SVG' | 'PDF'>('PNG');
	let exportControlEl: HTMLDivElement | null = null;
	let projectionMenuOpen = $state(false);
	let projectionControlEl: HTMLDivElement | null = null;
	const exportFormats = ['PNG', 'SVG', 'PDF'] as const;
	const projectionOptions = ['stereographic', 'pinhole'] as const;
	let selectedProjection = $state<(typeof projectionOptions)[number]>('stereographic');
	let flubberInterpolate: MorphInterpolatorFactory | null = null;
	let projectionBlend = 0;
	let projectionBlendAnimating = false;
	let projectionBlendFrom = 0;
	let projectionBlendTo = 0;
	let projectionBlendStartMs = 0;
	let projectionBlendDurationMs = PROJECTION_TRANSITION_MS;
	let renderer: CanvasRenderer | null = null;
	const activeCanvasPointers = new Map<number, { x: number; y: number }>();
	let pinchStartDistance = 0;
	let pinchStartFovDeg = 100;
	let gestureStartFovDeg = 100;

	onMount(() => {
		renderer = canvasEl ? new CanvasRenderer(canvasEl) : null;
		renderer?.setMorphInterpolatorFactory(flubberInterpolate);

		const handleOutsidePointerDown = (event: PointerEvent) => {
			if (exportMenuOpen && exportControlEl && !exportControlEl.contains(event.target as Node)) {
				exportMenuOpen = false;
			}
			if (projectionMenuOpen && projectionControlEl && !projectionControlEl.contains(event.target as Node)) {
				projectionMenuOpen = false;
			}
		};
		const handleEscapeKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			exportMenuOpen = false;
			projectionMenuOpen = false;
		};
		window.addEventListener('pointerdown', handleOutsidePointerDown);
		window.addEventListener('keydown', handleEscapeKey);
		canvasEl?.addEventListener('wheel', onCanvasWheel, { passive: false });
		canvasEl?.addEventListener('gesturestart', onCanvasGestureStart as EventListener, { passive: false });
		canvasEl?.addEventListener('gesturechange', onCanvasGestureChange as EventListener, { passive: false });

		void loadFlubber().then(() => {
			markRenderDirty();
		});

		void loadStars().then(() => {
			markRenderDirty();
		});
		return () => {
			window.removeEventListener('pointerdown', handleOutsidePointerDown);
			window.removeEventListener('keydown', handleEscapeKey);
			canvasEl?.removeEventListener('wheel', onCanvasWheel);
			canvasEl?.removeEventListener('gesturestart', onCanvasGestureStart as EventListener);
			canvasEl?.removeEventListener('gesturechange', onCanvasGestureChange as EventListener);
			if (rafId) {
				cancelAnimationFrame(rafId);
			}
		};
	});

	async function loadFlubber() {
		try {
			const module = await import('flubber');
			const maybeDefault = module.default as unknown;
			const interpolate =
				module.interpolate ??
				(typeof maybeDefault === 'function'
					? (maybeDefault as MorphInterpolatorFactory)
					: (maybeDefault as { interpolate?: MorphInterpolatorFactory } | undefined)?.interpolate);
			if (!interpolate) {
				console.warn('Flubber loaded without interpolate export; using hard switch fallback');
				return;
			}
			flubberInterpolate = interpolate;
			renderer?.setMorphInterpolatorFactory(interpolate);
		} catch (error) {
			console.warn('Flubber lazy import failed; using hard switch fallback', error);
		}
	}

	function markRenderDirty() {
		renderDirty = true;
		if (rafId) return;
		rafId = requestAnimationFrame((frameTimeMs) => {
			rafId = 0;
			if (!renderDirty && !projectionBlendAnimating) return;
			renderDirty = false;
			const tick = getProjectionBlend(frameTimeMs, getProjectionAnimationState(), projectionBlend);
			projectionBlend = tick.blend;
			projectionBlendAnimating = tick.animating;
			renderer?.render({
				orientation: view.orientation,
				fovDeg: view.fovDeg,
				starVectors: catalog.starVectors,
				projectionBlend
			});
			if (projectionBlendAnimating) {
				markRenderDirty();
			}
		});
	}

	function getProjectionAnimationState(): ProjectionAnimationState {
		return {
			animating: projectionBlendAnimating,
			from: projectionBlendFrom,
			to: projectionBlendTo,
			startMs: projectionBlendStartMs,
			durationMs: projectionBlendDurationMs
		};
	}

	function startProjectionTransition(nextProjection: (typeof projectionOptions)[number]) {
		const targetBlend = nextProjection === 'pinhole' ? 1 : 0;
		const nowMs = performance.now();
		const tick = getProjectionBlend(nowMs, getProjectionAnimationState(), projectionBlend);
		projectionBlend = tick.blend;
		projectionBlendAnimating = tick.animating;
		const currentBlend = projectionBlend;
		selectedProjection = nextProjection;
		projectionMenuOpen = false;
		if (Math.abs(targetBlend - currentBlend) <= 0.001) {
			projectionBlendAnimating = false;
			projectionBlend = targetBlend;
			markRenderDirty();
			return;
		}
		projectionBlendFrom = currentBlend;
		projectionBlendTo = targetBlend;
		projectionBlendStartMs = nowMs;
		projectionBlendDurationMs = Math.max(
			PROJECTION_TRANSITION_MIN_MS,
			PROJECTION_TRANSITION_MS * Math.abs(projectionBlendTo - projectionBlendFrom)
		);
		projectionBlendAnimating = true;
		projectionBlend = currentBlend;
		markRenderDirty();
	}

	function setFov(nextFovDeg: number) {
		const clampedFovDeg = clamp(nextFovDeg, MIN_FOV_DEG, MAX_FOV_DEG);
		if (Math.abs(clampedFovDeg - view.fovDeg) <= 0.01) return;
		view.fovDeg = clampedFovDeg;
		markRenderDirty();
	}

	function getPointersDistance() {
		const [a, b] = [...activeCanvasPointers.values()];
		if (!a || !b) return 0;
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	function startPinchIfReady() {
		if (activeCanvasPointers.size !== 2) return;
		pinchStartDistance = Math.max(getPointersDistance(), EPSILON);
		pinchStartFovDeg = view.fovDeg;
		dragging = false;
		activePointerId = null;
		lastArcballVector = null;
	}

	async function loadStars() {
		try {
			const response = await fetch('/api/catalog/full?max_mag=6.5');
			if (!response.ok) throw new Error(`catalog load failed: ${response.status}`);
			catalog.stars = await response.json();
			catalog.starVectors = catalog.stars.map((star) => {
				const cosDec = Math.cos(star.dec);
				return {
					x: cosDec * Math.cos(star.ra),
					y: cosDec * Math.sin(star.ra),
					z: Math.sin(star.dec),
					v_mag: star.v_mag
				};
			});
			markRenderDirty();
		} catch (error) {
			console.error(error);
		}
	}

	function onPointerDown(event: PointerEvent) {
		if (!(event.target instanceof HTMLCanvasElement)) return;
		event.target.setPointerCapture(event.pointerId);
		activeCanvasPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (activeCanvasPointers.size >= 2) {
			startPinchIfReady();
			return;
		}
		dragging = true;
		activePointerId = event.pointerId;
		const rect = event.target.getBoundingClientRect();
		lastArcballVector = projectPointerToArcball(event.clientX, event.clientY, rect);
	}

	function onPointerMove(event: PointerEvent) {
		if (activeCanvasPointers.has(event.pointerId)) {
			activeCanvasPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}
		if (activeCanvasPointers.size === 2) {
			const currentDistance = Math.max(getPointersDistance(), EPSILON);
			const scale = currentDistance / Math.max(pinchStartDistance, EPSILON);
			setFov(pinchStartFovDeg / Math.max(scale, EPSILON));
			return;
		}
		if (!dragging || event.pointerId !== activePointerId) return;
		if (!canvasEl || !lastArcballVector) return;
		const rect = canvasEl.getBoundingClientRect();
		const currentArcballVector = projectPointerToArcball(event.clientX, event.clientY, rect);
		const deltaRotation = quaternionBetweenVectors(lastArcballVector, currentArcballVector);
		view.orientation = normalizeQuaternion(multiplyQuaternions(deltaRotation, view.orientation));
		lastArcballVector = currentArcballVector;
		markRenderDirty();
	}

	function onPointerUp(event: PointerEvent) {
		if (!activeCanvasPointers.has(event.pointerId)) return;
		if (canvasEl?.hasPointerCapture(event.pointerId)) {
			canvasEl.releasePointerCapture(event.pointerId);
		}
		activeCanvasPointers.delete(event.pointerId);
		if (activeCanvasPointers.size >= 2) {
			startPinchIfReady();
			return;
		}
		if (activeCanvasPointers.size === 1 && canvasEl) {
			const [nextPointerId, point] = [...activeCanvasPointers.entries()][0];
			dragging = true;
			activePointerId = nextPointerId;
			const rect = canvasEl.getBoundingClientRect();
			lastArcballVector = projectPointerToArcball(point.x, point.y, rect);
			return;
		}
		dragging = false;
		activePointerId = null;
		lastArcballVector = null;
		pinchStartDistance = 0;
	}

	function onCanvasWheel(event: WheelEvent) {
		if (!event.ctrlKey) return;
		event.preventDefault();
		const zoomFactor = Math.exp(event.deltaY * 0.0025);
		setFov(view.fovDeg * zoomFactor);
	}

	function onCanvasGestureStart(event: Event) {
		event.preventDefault();
		gestureStartFovDeg = view.fovDeg;
	}

	function onCanvasGestureChange(event: Event) {
		const gestureEvent = event as Event & { scale?: number };
		const scale = gestureEvent.scale;
		if (!scale || !Number.isFinite(scale)) return;
		event.preventDefault();
		setFov(gestureStartFovDeg / Math.max(scale, EPSILON));
	}

function exportChart(format: 'PNG' | 'SVG' | 'PDF') {
	if (!canvasEl) return;
	if (format === 'PNG') {
		const link = document.createElement('a');
		link.download = `skychart-${Date.now()}.png`;
		link.href = canvasEl.toDataURL('image/png');
		link.click();
		return;
	}
	console.info(`TODO: implement ${format} export`);
}

function handleExportPrimaryClick() {
	exportChart(selectedExportFormat);
}

function handleExportFormatSelect(format: 'PNG' | 'SVG' | 'PDF') {
	selectedExportFormat = format;
	exportMenuOpen = false;
	exportChart(format);
}

	function handleProjectionSelect(projection: (typeof projectionOptions)[number]) {
		startProjectionTransition(projection);
	}
</script>

<main
	class="page"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<header class="ray-header">
		<div class="ray-bottom">
			<div class="ray-left">
				<img src="/icon-constellation.png" alt="Apex icon" class="ray-logo" />
				<span class="ray-textline">
					<span class="ray-brand">Skycharts</span>
					<span class="ray-meta-word">by Apex</span>
				</span>
			</div>
			<div class="ray-right">
				<button class="tool-btn" type="button">About</button>
				<button class="tool-btn" type="button">Format</button>
				<div class="export-wrap" bind:this={exportControlEl}>
					<button class="export-main" type="button" onclick={handleExportPrimaryClick}>
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
						aria-expanded={exportMenuOpen}
						onclick={() => (exportMenuOpen = !exportMenuOpen)}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4.22 6.97a.75.75 0 0 1 1.06 0L8 9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 0 1 0-1.06Z" />
						</svg>
					</button>
					{#if exportMenuOpen}
						<div class="export-menu" role="menu" aria-label="Export format">
							{#each exportFormats as format}
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
	<canvas bind:this={canvasEl} width="1200" height="1200"></canvas>
	<div class="control-bar-shell">
		<div class="control-bar" role="group" aria-label="Generator display controls">
			<div class="control-group projection-group">
				<label class="control-label control-label-no-caps" id="projection-label">Projection</label>
				<div class="projection-wrap" bind:this={projectionControlEl}>
					<button
						class="projection-trigger"
						type="button"
						aria-haspopup="listbox"
						aria-expanded={projectionMenuOpen}
						aria-labelledby="projection-label projection-trigger-value"
						onclick={() => (projectionMenuOpen = !projectionMenuOpen)}
					>
						<span id="projection-trigger-value">{selectedProjection}</span>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4.22 6.97a.75.75 0 0 1 1.06 0L8 9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 0 1 0-1.06Z" />
						</svg>
					</button>
					{#if projectionMenuOpen}
						<div class="projection-menu" role="listbox" aria-labelledby="projection-label">
							{#each projectionOptions as projection}
								<button
									class="projection-option"
									class:is-selected={projection === selectedProjection}
									type="button"
									role="option"
									aria-selected={projection === selectedProjection}
									onclick={() => handleProjectionSelect(projection)}
								>
									<span class="projection-option-label">{projection}</span>
									<span class="projection-option-check" aria-hidden="true">
										{projection === selectedProjection ? '✓' : ''}
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
		min-height: 100vh;
		background: #0a0a0b;
		display: grid;
		place-items: center;
		overflow: hidden;
		padding-top: 56px;
		padding-bottom: 136px;
	}

	.ray-header {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		padding: 0 10px;
		display: flex;
		align-items: center;
		background: #101114;
		border-bottom: none;
		z-index: 5;
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
		font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
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
		transition: border-color 0.16s ease, color 0.16s ease, box-shadow 0.2s ease, background 0.2s ease;
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
		transition: background 0.14s ease, color 0.14s ease;
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
		width: 700px;
		height: 700px;
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
		position: absolute;
		left: 0;
		right: 0;
		bottom: 2px;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 6;
	}

	.control-bar {
		width: 920px;
		max-width: 920px;
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
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.22) 48%, rgba(255, 255, 255, 0.04) 100%);
		flex-shrink: 0;
	}

	.chip-row {
		display: inline-flex;
		gap: 6px;
	}

	.control-chip {
		height: 28px;
		padding: 0 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
		color: #d4dae3;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
	}

	.control-chip:hover {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f9;
	}

	.control-chip:active {
		background: rgba(255, 255, 255, 0.14);
	}

	.control-chip.is-active {
		border-color: rgba(170, 198, 255, 0.6);
		background: rgba(113, 148, 220, 0.24);
		color: #f4f8ff;
	}

	.toggle-chip {
		height: 28px;
		padding: 0 10px 0 8px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.03);
		color: #d4dae3;
		font-size: 0.72rem;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
	}

	.toggle-chip:hover {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f9;
	}

	.toggle-chip:active {
		background: rgba(255, 255, 255, 0.14);
	}

	.toggle-chip.is-on {
		border-color: rgba(128, 169, 242, 0.65);
		background: rgba(108, 144, 216, 0.22);
	}

	.toggle-thumb {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: #7e8694;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4) inset;
		transition: background 0.16s ease;
	}

	.toggle-chip.is-on .toggle-thumb {
		background: #d6e6ff;
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
		transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
	}

	.projection-trigger svg {
		width: 14px;
		height: 14px;
		fill: #adb4bf;
		flex-shrink: 0;
		transition: transform 0.14s ease, fill 0.14s ease;
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
		transition: background 0.14s ease, color 0.14s ease;
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

	@media (max-width: 640px) {
		.ray-meta-word {
			display: none;
		}
		.ray-right {
			gap: 6px;
		}
		.tool-btn {
			padding: 0 8px;
		}
	}

	@media (max-width: 860px) {
		.page {
			padding-bottom: 136px;
		}

		canvas {
			width: min(700px, 92vw, calc(100vh - 164px));
			height: min(700px, 92vw, calc(100vh - 164px));
		}

		.control-bar {
			width: 100%;
			max-width: 100%;
			padding: 14px 10px;
			gap: 12px;
			border-radius: 0;
			border-left: 0;
			border-right: 0;
		}
	}

</style>
