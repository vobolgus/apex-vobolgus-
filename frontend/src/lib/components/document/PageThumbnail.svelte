<script lang="ts">
	/**
	 * One page at a small scale: a white sheet with its charts where they sit.
	 * Decorative: whatever holds it carries the name.
	 *
	 * Each chart is drawn here at its size on the sheet (`drawChartThumbnail`): the
	 * brighter stars, none under half a pixel. The vector preview draws stars at
	 * their size in mm, under a pixel at this scale, and the preview's own pixels
	 * scaled down lose them too, so either way the sheet looked empty. Redrawn when
	 * a chart's frame changes and once the star catalogue has loaded.
	 */
	import { PINHOLE_CORNER_RADIUS } from '$lib/constants';
	import { pageSize, PRINT_MM_PER_PREVIEW_PX } from '$lib/document/geometry';
	import type { DocPage } from '$lib/document/types';
	import { catalog } from '$lib/stores.svelte';
	import { drawChartThumbnail } from './chart-thumbnail';

	interface Props {
		page: DocPage;
		/** Screen px per mm. */
		scale: number;
	}

	let { page, scale }: Props = $props();

	/** The pinhole frame's rounded corner, in mm on the page. */
	const cornerMm = PINHOLE_CORNER_RADIUS * PRINT_MM_PER_PREVIEW_PX;

	const size = $derived(pageSize(page.orientation));
</script>

<div
	class="sheet"
	style:width="{size.w * scale}px"
	style:height="{size.h * scale}px"
	aria-hidden="true"
>
	{#each page.items as item (item.id)}
		{@const round = item.chart.view.projection === 'stereographic'}
		{@const w = item.frame.w * scale}
		{@const h = item.frame.h * scale}
		<div
			class="chart"
			style:left="{item.frame.x * scale}px"
			style:top="{item.frame.y * scale}px"
			style:width="{w}px"
			style:height="{h}px"
			style:--corner={round ? '50%' : `${cornerMm * scale}px`}
		>
			<canvas
				{@attach (canvas) =>
					drawChartThumbnail(
						canvas,
						item.chart,
						w,
						h,
						catalog.starVectors,
						window.devicePixelRatio || 1
					)}
			></canvas>
		</div>
	{/each}
</div>

<style>
	.sheet {
		position: relative;
		display: block;
		overflow: hidden;
		border-radius: 2px;
		background: var(--paper);
		box-shadow: var(--paper-shadow);
	}

	.chart {
		position: absolute;
		overflow: hidden;
		border-radius: var(--corner);
		pointer-events: none;
		user-select: none;
	}

	.chart canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	/*
	 * The sky's edge, which the preview draws a hairline in mm: far under a pixel at
	 * this scale. Drawn here at 1 px, so a white chart on white paper still shows.
	 */
	.chart::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--corner);
		box-shadow: inset 0 0 0 1px var(--paper-chart-edge);
	}

	/* Forced colours drop the paper fill: keep the sheet's edge. */
	@media (forced-colors: active) {
		.sheet {
			outline: 1px solid CanvasText;
		}
	}
</style>
