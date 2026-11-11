<script lang="ts">
	/**
	 * "Reads": the chart a text's fields or a table's rows read, told from under its
	 * toolbar. The nearest unless it is told a chart of its page by its number, which
	 * the page shows on the charts meanwhile; or a chart of another page from a list,
	 * which is how a table on a page of its own reads its sky. Shown only while that is
	 * a question (`reads.ts`).
	 */
	import { chartsOf } from '$lib/document/blocks';
	import type { DocPage, TypesetBlock } from '$lib/document/types';
	import type { BlockActions } from '../editor/actions';
	import Chip from './Chip.svelte';
	import { otherCharts, readingOf, readsAChart } from './reads';

	interface Props {
		block: TypesetBlock;
		/** Its page. */
		page: DocPage;
		/** The document's pages. */
		pages: readonly DocPage[];
		/** What it says just now: a text's words, as typed while it is typed in. */
		words: string;
		blocks: BlockActions;
		/** A chart was chosen from the list: the focus goes back to the block. */
		onpicked: () => void;
	}

	let { block, page, pages, words, blocks, onpicked }: Props = $props();

	const chartIds = $derived(chartsOf(page).map((chart) => chart.id));
	const others = $derived(otherCharts(page, pages));
	const chooses = $derived(
		(chartIds.length >= 2 || others.length > 0) && readsAChart(block, words)
	);
	const reading = $derived(readingOf(page, block, pages, others));

	function pick(event: Event) {
		const chosen = (event.currentTarget as HTMLSelectElement).value;
		if (chosen !== '') blocks.bind(block, chosen);
		onpicked();
	}
</script>

{#if chooses}
	{@const { at, pinned, other } = reading}
	<div class="row fields" role="group" aria-label="The chart the fields read">
		<span class="row-label" aria-hidden="true">Reads</span>
		<Chip
			pressed={!pinned && other === null}
			label="Read the nearest chart{at !== null ? `, now chart ${at + 1}` : ''}"
			title="The chart nearest to the text"
			onpress={() => blocks.bind(block, null)}
		>
			Nearest{!pinned && at !== null ? ` · ${at + 1}` : ''}
		</Chip>
		{#each chartIds as chartId, chart (chart)}
			<Chip
				pressed={pinned && at === chart}
				label="Read chart {chart + 1}"
				title="Chart {chart + 1}"
				number
				onpress={() => blocks.bind(block, chartId)}
			>
				{chart + 1}
			</Chip>
		{/each}
		{#if others.length > 0}
			<!-- Charts of the other pages: a table on a page of its own reads its sky from there. -->
			<select
				class="field other"
				class:is-chosen={other !== null}
				tabindex="-1"
				aria-label="Read a chart on another page"
				value={other ?? ''}
				onpointerdown={(event) => event.stopPropagation()}
				onchange={pick}
			>
				<option value="" disabled>Other page…</option>
				{#each others as choice (choice.id)}
					<option value={choice.id}>{choice.label}</option>
				{/each}
			</select>
		{/if}
	</div>
{/if}
