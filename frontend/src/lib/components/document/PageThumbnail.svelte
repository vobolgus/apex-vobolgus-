<script lang="ts">
	/**
	 * One page at a small scale: a white sheet with its charts and text where they
	 * sit. Decorative: whatever holds it carries the name.
	 *
	 * Each chart is drawn here at its size on the sheet (`drawChartThumbnail`): the
	 * brighter stars, none under half a pixel. The vector preview draws stars at
	 * their size in mm, under a pixel at this scale, and the preview's own pixels
	 * scaled down lose them too, so either way the sheet looked empty. Redrawn when
	 * a chart's frame changes and once the star catalogue has loaded.
	 *
	 * `pendingItemId` names a chart that is on its way here (Add to PDF flies a copy
	 * of it from the preview): its place on the sheet is kept, empty, until the copy
	 * lands on it, and then it is drawn. The copy is this same drawing, so nothing
	 * changes under the eye at that moment.
	 *
	 * Text is set as in the editor, in its own lines; at this scale it is a grey of
	 * the right shape, which is what a page seen from afar looks like.
	 */
	import { PINHOLE_CORNER_RADIUS } from '$lib/constants';
	import { pageSize, PRINT_MM_PER_PREVIEW_PX } from '$lib/document/geometry';
	import { anchoredFrame } from '$lib/document/text';
	import { shownLayout } from '$lib/document/text-fonts.svelte';
	import type { DocPage } from '$lib/document/types';
	import { catalog } from '$lib/stores.svelte';
	import { drawChartThumbnail } from './chart-thumbnail';
	import TextLines from './TextLines.svelte';

	interface Props {
		page: DocPage;
		/** Screen px per mm. */
		scale: number;
		/** The chart still in the air, whose place stays empty for now. */
		pendingItemId?: string | null;
		/** The document's pages, for a text that reads a chart on another page. */
		pages?: readonly DocPage[];
	}

	let { page, scale, pendingItemId = null, pages }: Props = $props();

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
			class:pending={item.id === pendingItemId}
			data-item-id={item.id}
			style:left="{item.frame.x * scale}px"
			style:top="{item.frame.y * scale}px"
			style:width="{w}px"
			style:height="{h}px"
			style:--corner={round ? '50%' : `${cornerMm * scale}px`}
		>
			{#if item.id !== pendingItemId}
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
			{/if}
		</div>
	{/each}
	{#each page.texts ?? [] as text (text.id)}
		{@const layout = shownLayout(page, text, text.frame.w, pages)}
		{@const box = anchoredFrame(text.frame, text.rotation ?? 0, text.frame.w, layout.height)}
		<div
			class="text"
			data-item-id={text.id}
			style:left="{box.x * scale}px"
			style:top="{box.y * scale}px"
			style:width="{box.w * scale}px"
			style:height="{box.h * scale}px"
			style:rotate="{text.rotation ?? 0}deg"
		>
			<TextLines {layout} style={text.style} width={text.frame.w} />
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

	.text {
		position: absolute;
		pointer-events: none;
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

	/* Still in the air: not even its edge is on the sheet yet. */
	.chart.pending::after {
		content: none;
	}

	/* Forced colours drop the paper fill: keep the sheet's edge. */
	@media (forced-colors: active) {
		.sheet {
			outline: 1px solid CanvasText;
		}
	}
</style>
