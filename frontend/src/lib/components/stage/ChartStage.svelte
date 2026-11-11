<script lang="ts">
	/**
	 * The chart area: the preview's square surface (its canvas, with the pinhole
	 * frame's handles over it), the catalogue's notice, and what floats over the area
	 * beside the chart (`children`: the pages panel, the layers panel).
	 *
	 * The panels reserve room on either side, and the chart keeps clear of it; when a
	 * reserve changes, the chart moves to its new place smoothly once the page has
	 * settled (`surface-motion.ts`). What draws and moves the sky is the stage's
	 * controller (`StageController`), which the page holds.
	 */
	import { onMount, untrack, type Snippet } from 'svelte';
	import { CHART_CANVAS_BACKING_PX } from '$lib/constants';
	import { clearWidthAroundChart } from '$lib/math/chart-area';
	import { prefersReducedMotion } from '$lib/ui/motion';
	import { CatalogLoad } from './catalog-load.svelte';
	import CatalogNotice from './CatalogNotice.svelte';
	import PinholeFrameOverlay from './PinholeFrameOverlay.svelte';
	import type { StageController } from './stage.svelte';
	import { moveToNextLayout } from './surface-motion';

	interface Props {
		stage: StageController;
		/** How far the pages panel reaches in from the left, px; the chart keeps clear of it. */
		reserveLeftPx: number;
		/** And the layers panel from the right. */
		reserveRightPx: number;
		/**
		 * The page has settled after its load: from here on a panel that opens slides
		 * and the chart moves with it. Before, what storage remembers is simply there.
		 */
		animated: boolean;
		children?: Snippet;
	}

	let { stage, reserveLeftPx, reserveRightPx, animated, children }: Props = $props();

	/** The chart area's padding, px, as in the CSS: the panels' reserves are measured inside it. */
	const CHART_AREA_PADDING_PX = 12;

	let canvasEl: HTMLCanvasElement | null = null;
	let chartAreaEl: HTMLElement | null = null;
	let chartSurfaceEl: HTMLDivElement | null = null;
	let surfaceSizePx = $state(1);
	// The chart area clips the surface; the frame overlay keeps its handles inside it.
	let chartClipWidthPx = $state(1);
	let chartClipHeightPx = $state(1);
	/** Room for the pinhole frame's handles between the two panels, around where the chart sits. */
	const frameClipWidthPx = $derived(
		clearWidthAroundChart(
			chartClipWidthPx - 2 * CHART_AREA_PADDING_PX,
			surfaceSizePx,
			reserveLeftPx,
			reserveRightPx
		) +
			2 * CHART_AREA_PADDING_PX
	);

	const catalogue = new CatalogLoad(() => stage.markDirty());

	onMount(() => {
		const detach = canvasEl ? stage.attach(canvasEl) : null;
		const surface = chartSurfaceEl;
		const observer = surface
			? new ResizeObserver((entries) => {
					for (const entry of entries) {
						if (entry.target === surface) {
							const { width, height } = entry.contentRect;
							surfaceSizePx = Math.max(1, Math.min(width, height));
						} else if (entry.target === chartAreaEl) {
							measureChartClip();
						}
					}
				})
			: null;
		if (observer && surface) {
			observer.observe(surface);
			const rect = surface.getBoundingClientRect();
			surfaceSizePx = Math.max(1, Math.min(rect.width, rect.height));
		}
		if (observer && chartAreaEl) {
			observer.observe(chartAreaEl);
			measureChartClip();
		}
		// Zoom gestures are taken on the whole chart surface, not just the canvas, so a
		// trackpad pinch over the frame's resize handles still zooms the sky instead of
		// the page.
		surface?.addEventListener('wheel', stage.wheel, { passive: false });
		surface?.addEventListener('gesturestart', stage.gesturestart, { passive: false });
		surface?.addEventListener('gesturechange', stage.gesturechange, { passive: false });
		void catalogue.load();
		return () => {
			surface?.removeEventListener('wheel', stage.wheel);
			surface?.removeEventListener('gesturestart', stage.gesturestart);
			surface?.removeEventListener('gesturechange', stage.gesturechange);
			observer?.disconnect();
			detach?.();
		};
	});

	function measureChartClip() {
		if (!chartAreaEl) return;
		chartClipWidthPx = Math.max(1, chartAreaEl.clientWidth);
		chartClipHeightPx = Math.max(1, chartAreaEl.clientHeight);
	}

	$effect(() => {
		// Reading the snapshot subscribes to every reference-line flag at once.
		void stage.layers.referenceLines;
		stage.markDirty();
	});

	// A panel opening or closing changes what room the chart has: it moves there.
	$effect.pre(() => {
		void reserveLeftPx;
		void reserveRightPx;
		const surface = chartSurfaceEl;
		if (!surface || !untrack(() => animated) || prefersReducedMotion()) return;
		if (typeof surface.animate !== 'function') return;
		moveToNextLayout(surface);
	});
</script>

<section
	class="chart-area"
	bind:this={chartAreaEl}
	style:--reserve-left="{reserveLeftPx}px"
	style:--reserve-right="{reserveRightPx}px"
>
	<div class="chart-surface" bind:this={chartSurfaceEl}>
		<canvas bind:this={canvasEl} width={CHART_CANVAS_BACKING_PX} height={CHART_CANVAS_BACKING_PX}
		></canvas>
		<PinholeFrameOverlay
			bind:this={stage.overlay}
			{surfaceSizePx}
			clipWidthPx={Math.max(1, frameClipWidthPx)}
			clipHeightPx={chartClipHeightPx}
			visible={stage.projection.isPinholeSettled}
			onChange={stage.markDirty}
		/>
	</div>
	<CatalogNotice load={catalogue} />
	{@render children?.()}
</section>

<style>
	/*
	 * Its own stacking context: the pages panel and the frame overlay inside it
	 * stay under the header's export menu and the dock's popover.
	 */
	.chart-area {
		position: relative;
		isolation: isolate;
		min-height: 0;
		min-width: 0;
		padding: 12px;
		display: grid;
		place-items: center;
		overflow: hidden;
		container-type: size;
	}

	.chart-surface {
		/* Квадрат: сторона = min(ширина области без панелей, высота области, фикс. кап);
		   кап даёт стабильный размер на десктопе. Слева место занимает панель страниц
		   (--reserve-left), справа панель слоёв (--reserve-right). Карта остаётся по центру
		   области, пока там не задевает ни одну из панелей, иначе сдвигается ровно настолько,
		   чтобы не уйти под панель (--chart-centre; та же формула в $lib/math/chart-area.ts),
		   и только когда места не хватает и так, уменьшается. */
		--chart-cap: 720px;
		--chart-side: max(
			0px,
			min(100cqw - var(--reserve-left, 0px) - var(--reserve-right, 0px), 100cqh, var(--chart-cap))
		);
		--chart-centre: clamp(
			var(--reserve-left, 0px) + var(--chart-side) / 2,
			50cqw,
			100cqw - var(--reserve-right, 0px) - var(--chart-side) / 2
		);
		position: relative;
		left: calc(var(--chart-centre) - 50cqw);
		width: var(--chart-side);
		height: var(--chart-side);
		display: grid;
		place-items: center;
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
</style>
