<script lang="ts">
	/**
	 * One chart on a page in the editor: its vector preview (`ChartPreview`) in the
	 * frame every block has, and on the current page its toolbar over its foot, its
	 * size while a corner is dragged, and its number while a text is choosing the
	 * chart it reads.
	 */
	import type { ChartBlock, PageOrientation, Rect } from '$lib/document/types';
	import type { EditorActions } from '../editor/actions';
	import type { BlockState } from '../editor/drag-view';
	import { sizeLabel, spokenSize, type Size } from '../editor/screen-geometry';
	import BlockFrame from './BlockFrame.svelte';
	import BlockToolbar from './BlockToolbar.svelte';
	import { ChartPreview } from './chart-preview.svelte';
	import ChartToolbar from './ChartToolbar.svelte';
	import Readout from './Readout.svelte';

	interface Props {
		chart: ChartBlock;
		/** 0-based position among its page's charts, for the accessible name. */
		index: number;
		count: number;
		/** The page's size, mm. */
		pageSize: Size;
		orientation: PageOrientation;
		/** 1-based numbers of the pages before and after this one, null where there is none. */
		prevPage: number | null;
		nextPage: number | null;
		/** Where to draw the chart, mm on its page; off the page while it is dragged to another. */
		frame: Rect;
		/** On the current page: focusable, resizable, with its toolbar. Elsewhere it can still be dragged. */
		interactive: boolean;
		mode: BlockState;
		/** Another block is being carried: this one puts its frame and controls away. */
		quiet: boolean;
		/** Its number on the page, shown while a text is choosing the chart it reads. */
		badge: number | null;
		/** The selected text reads this chart. */
		linked: boolean;
		/** Id of the element that explains the keys. */
		hintId?: string;
		/** What the chart asks of the editor: to be carried, resized, stepped, sent on, removed. */
		actions: EditorActions;
	}

	let {
		chart,
		index,
		count,
		pageSize,
		orientation,
		prevPage,
		nextPage,
		frame,
		interactive,
		mode,
		quiet,
		badge,
		linked,
		hintId,
		actions
	}: Props = $props();

	const preview = new ChartPreview(() => chart);
	const disc = $derived(chart.chart.view.projection === 'stereographic');
	const name = $derived(
		`Chart ${index + 1} of ${count}, ${chart.chart.view.projection}, ${spokenSize(chart.frame)}`
	);
</script>

<BlockFrame
	block={chart}
	{pageSize}
	box={frame}
	{mode}
	{interactive}
	{quiet}
	{name}
	{hintId}
	{disc}
	{linked}
	removeLabel="Remove chart {index + 1}"
	{actions}
>
	{#if preview.picture}
		<img src={preview.picture} alt="" draggable="false" onerror={preview.lost} />
	{:else}
		<span class="placeholder" class:is-disc={disc} class:is-failed={preview.failed}></span>
	{/if}

	{#snippet upright()}
		<BlockToolbar label="Chart {index + 1}" bottom="8px">
			<ChartToolbar
				{chart}
				number={index + 1}
				{orientation}
				{prevPage}
				{nextPage}
				blocks={actions.blocks}
			/>
		</BlockToolbar>
		<!-- The pinhole frame's size readout. -->
		{#if mode === 'resizing'}
			<Readout bottom="-36px">{sizeLabel(frame)}</Readout>
		{/if}
		{#if badge !== null && mode === 'idle'}
			<span class="badge" class:is-linked={linked} aria-hidden="true">{badge}</span>
		{/if}
	{/snippet}
</BlockFrame>

<style>
	img,
	.placeholder {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* `fill`: during a resize the old picture stretches to the new frame until the new one loads. */
	img {
		object-fit: fill;
		-webkit-user-drag: none;
	}

	.placeholder {
		box-sizing: border-box;
		border: 1px solid var(--paper-chart-edge);
		border-radius: 2px;
		background: var(--paper-chart);
		animation: placeholder-pulse 1.4s ease-in-out infinite alternate;
	}

	.placeholder.is-disc {
		border-radius: 50%;
	}

	.placeholder.is-failed {
		animation: none;
		background:
			repeating-linear-gradient(-45deg, transparent 0 6px, rgba(10, 10, 11, 0.05) 6px 7px),
			var(--paper-chart);
	}

	@keyframes placeholder-pulse {
		to {
			background: var(--paper-chart-pulse);
		}
	}

	/* A chart's number, at its top: a text is being told which chart to read. */
	.badge {
		position: absolute;
		z-index: 2;
		top: 6px;
		left: 50%;
		display: grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		box-sizing: border-box;
		padding: 0 6px;
		border-radius: 10px;
		background: rgba(24, 24, 27, 0.92);
		color: #eceef1;
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		transform: translateX(-50%);
		pointer-events: none;
	}

	/* The chart the selected text reads: its number filled. */
	.badge.is-linked {
		background: var(--accent);
		color: #ffffff;
	}

	@media (prefers-reduced-motion: reduce) {
		.placeholder {
			animation: none;
		}
	}
</style>
