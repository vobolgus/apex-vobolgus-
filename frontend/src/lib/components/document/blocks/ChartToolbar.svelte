<script lang="ts">
	/**
	 * A chart's tools, over its foot: smaller, larger, and to the page before or after,
	 * for whoever cannot drag (and the same as − + Page Up/Down).
	 */
	import { stepSize } from '$lib/document/geometry';
	import type { ChartBlock, PageOrientation } from '$lib/document/types';
	import type { BlockActions } from '../editor/actions';
	import { ICONS } from './icons';
	import Tool from './Tool.svelte';

	interface Props {
		chart: ChartBlock;
		/** 1-based, as the chart is named. */
		number: number;
		orientation: PageOrientation;
		/** 1-based numbers of the pages before and after its own, null where there is none. */
		prevPage: number | null;
		nextPage: number | null;
		blocks: BlockActions;
	}

	let { chart, number, orientation, prevPage, nextPage, blocks }: Props = $props();

	const canShrink = $derived(stepSize(chart.frame, chart.chart.aspect, orientation, -1) !== null);
	const canGrow = $derived(stepSize(chart.frame, chart.chart.aspect, orientation, 1) !== null);
</script>

<div class="row">
	<Tool
		label="Make chart {number} smaller"
		title="Smaller · −"
		disabled={!canShrink}
		icon={ICONS.shrink}
		onpress={() => blocks.step(chart, -1)}
	/>
	<Tool
		label="Make chart {number} larger"
		title="Larger · +"
		disabled={!canGrow}
		icon={ICONS.grow}
		onpress={() => blocks.step(chart, 1)}
	/>
	{#if prevPage !== null || nextPage !== null}
		<span class="tool-divider" aria-hidden="true"></span>
	{/if}
	{#if prevPage !== null}
		<Tool
			label="Move chart {number} to page {prevPage}"
			title="To page {prevPage} · Page Up"
			icon={ICONS.before}
			onpress={() => blocks.toPage(chart, -1)}
		/>
	{/if}
	{#if nextPage !== null}
		<Tool
			label="Move chart {number} to page {nextPage}"
			title="To page {nextPage} · Page Down"
			icon={ICONS.after}
			onpress={() => blocks.toPage(chart, 1)}
		/>
	{/if}
</div>
