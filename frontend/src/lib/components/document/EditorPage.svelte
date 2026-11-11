<script lang="ts">
	/**
	 * One page in the editor: its label (`PageLabel`) above white paper, and the blocks
	 * on it, in the order they print. The current page's are editable; a neighbouring
	 * page is a button that makes it current, and a drop target.
	 *
	 * The page knows which of its texts is selected, for while that one reads a chart
	 * and the page has two, the charts show their numbers, the one it reads marked.
	 */
	import { pageSize } from '$lib/document/geometry';
	import { chartsOf, isBlank, typesetOf } from '$lib/document/blocks';
	import type { DocPage } from '$lib/document/types';
	import { chartCountLabel, plural } from '$lib/document/labels';
	import EditorChart from './blocks/EditorChart.svelte';
	import EditorTypeset from './blocks/EditorTypeset.svelte';
	import { linkedChartId } from './blocks/reads';
	import type { EditorActions } from './editor/actions';
	import { blockState } from './editor/drag-view';
	import type { Box, SlotRole } from './editor/screen-geometry';
	import PageGuides from './PageGuides.svelte';
	import PageLabel from './PageLabel.svelte';

	interface Props {
		page: DocPage;
		/** 1-based. */
		number: number;
		/** 1-based numbers of the pages either side, null where there is none. */
		prevPage: number | null;
		nextPage: number | null;
		role: SlotRole;
		/** The paper, stage px. */
		box: Box;
		labelHeight: number;
		/** Narrow layout: the neighbours peek in at the edges, without their labels. */
		narrow: boolean;
		/** The document's pages: a text may read a chart on another of them. */
		pages: readonly DocPage[];
		hintId: string;
		textHintId: string;
		/**
		 * What the page and what is on it ask of the editor, and what they read of it: the
		 * drag going on (`actions.drag`) and the text being typed in (`actions.blocks`).
		 */
		actions: EditorActions;
	}

	let {
		page,
		number,
		prevPage,
		nextPage,
		role,
		box,
		labelHeight,
		narrow,
		pages,
		hintId,
		textHintId,
		actions
	}: Props = $props();

	const current = $derived(role === 'current');
	const size = $derived(pageSize(page.orientation));
	const charts = $derived(chartsOf(page));
	const texts = $derived(typesetOf(page));
	const blank = $derived(isBlank(page));
	/** "2 charts", and "2 charts, 1 text" once the page has text. */
	const chartWord = $derived(
		texts.length > 0
			? `${chartCountLabel(charts.length)}, ${plural(texts.length, 'text')}`
			: chartCountLabel(charts.length)
	);
	/** Screen px per mm. */
	const scale = $derived(box.width / size.w);

	/** What of the drag going on this page draws. */
	const drag = $derived(actions.drag.pageDrag(page));
	const carrying = $derived(actions.drag.carrying);
	const editingId = $derived(actions.blocks.editingId);

	function stateOf(blockId: string) {
		return blockState(blockId, drag, actions.drag.settlingId, actions.drag.returningId);
	}

	/**
	 * One of this page's blocks is in the hand, or on its way to rest after being let
	 * go. The page then stacks above every other, the current one included: the block
	 * is this page's child wherever on the stage it is drawn, and under another page
	 * it would be out of sight.
	 */
	const lifted = $derived(page.blocks.some((block) => stateOf(block.id) !== 'idle'));

	/** The text or table that has the focus (itself, its field or its toolbar). */
	let selectedTextId = $state<string | null>(null);

	function typesetAt(target: EventTarget | null): string | null {
		const element = (target as Element | null)?.closest?.<HTMLElement>(
			'[data-kind="text"], [data-kind="table"]'
		);
		return element?.dataset.itemId ?? null;
	}

	/** The chart the selected text reads, while that is a question; its badge is marked. */
	const readId = $derived(
		current
			? linkedChartId(
					page,
					pages,
					texts.find((text) => text.id === selectedTextId),
					editingId
				)
			: null
	);

	function handlePaperPointerDown(event: PointerEvent) {
		if (!current) return;
		// A press on bare paper puts the focus on the page: no chart stays selected.
		if ((event.target as Element).closest('[data-item-id]')) return;
		(event.currentTarget as HTMLElement).focus({ preventScroll: true });
	}

	function handlePaperKeydown(event: KeyboardEvent) {
		if (current || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault();
		actions.pages.show(page.id);
	}
</script>

<div
	class="slot"
	data-role={role}
	data-page-id={page.id}
	class:is-target={drag?.target && !current}
	class:is-lifted={lifted}
	style:left="{box.left}px"
	style:top="{box.top - labelHeight}px"
	style:width="{box.width}px"
	style:--label-h="{labelHeight}px"
>
	<PageLabel {page} {number} {current} {narrow} charted={charts.length > 0} {blank} {actions} />
	<!-- The current page takes the focus when nothing on it is selected; a neighbour is a button. -->
	<div
		class="paper"
		data-paper
		role={current ? 'group' : 'button'}
		tabindex="-1"
		aria-label={current
			? `Page ${number}, A4 ${page.orientation}, ${chartWord}`
			: `Show page ${number}, ${chartWord}`}
		style:height="{box.height}px"
		onpointerdown={handlePaperPointerDown}
		onfocusin={(event) => (selectedTextId = typesetAt(event.target))}
		onfocusout={(event) => {
			if (typesetAt(event.relatedTarget) === null) selectedTextId = null;
		}}
		onclick={() => {
			if (!current) actions.pages.show(page.id);
		}}
		onkeydown={handlePaperKeydown}
	>
		<!-- Charts first, then texts and tables over them: the page's order is the order they print in. -->
		{#each page.blocks as block (block.id)}
			{@const mode = stateOf(block.id)}
			{@const held = drag?.blockId === block.id ? drag : null}
			{@const frame = held?.frame ?? block.frame}
			{@const quiet = carrying && mode === 'idle'}
			{#if block.kind === 'chart'}
				{@const index = charts.findIndex((chart) => chart.id === block.id)}
				<EditorChart
					chart={block}
					{index}
					count={charts.length}
					page={size}
					orientation={page.orientation}
					{prevPage}
					{nextPage}
					{frame}
					interactive={current}
					{mode}
					{quiet}
					badge={readId === null ? null : index + 1}
					linked={readId === block.id}
					{hintId}
					{actions}
				/>
			{:else}
				{@const turned = held ? held.rotation : null}
				<EditorTypeset
					{block}
					sheet={page}
					{pages}
					index={texts.findIndex((text) => text.id === block.id)}
					count={texts.length}
					page={size}
					{scale}
					{frame}
					rotation={turned ?? block.rotation ?? 0}
					turning={turned !== null}
					interactive={current}
					{mode}
					{quiet}
					editing={current && editingId === block.id}
					hintId={textHintId}
					{actions}
				/>
			{/if}
		{/each}

		<!-- Only on the current page: a neighbour is dimmed, which would take its words under 4.5:1. -->
		{#if blank && current && !drag?.target}
			<div class="empty" aria-hidden="true">
				<span class="empty-title">Empty page</span>
				<span class="empty-note"
					>Drag a chart here from a neighbouring page, use Add to PDF, or add text.</span
				>
			</div>
		{/if}

		<!-- A chart being resized shows the margins it is held to; the lines anything snaps to, only with Shift held. -->
		{#if drag && (drag.guides.length > 0 || drag.margins)}
			<PageGuides {drag} orientation={page.orientation} {size} />
		{/if}
	</div>
</div>

<style>
	.slot {
		position: absolute;
		z-index: 1;
		animation: slot-in 200ms ease-out;
	}

	/* Above its neighbours, so a block dragged off it is drawn over them. */
	.slot[data-role='current'] {
		z-index: 2;
	}

	/* And a page a block is being dragged from is above them all, the current one too. */
	.slot.is-lifted {
		z-index: 3;
	}

	/* The page carousel: set by the editor once the stage has its size. */
	:global(.is-animated) .slot {
		transition:
			left 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
			top 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
			width 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	:global(.is-animated) .paper {
		transition:
			height 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
			box-shadow 160ms ease;
	}

	:global(.is-animated) .paper::after {
		transition: opacity 160ms ease;
	}

	@keyframes slot-in {
		from {
			opacity: 0;
		}
	}

	.paper {
		position: relative;
		border-radius: 2px;
		background: var(--paper);
		box-shadow: var(--paper-shadow-lg);
		outline: none;
	}

	/* Programmatic focus lands here after the last selected block goes; show it to the keyboard. */
	.paper:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: var(--ring), var(--paper-shadow-lg);
	}

	/*
	 * A neighbour is dimmed by a veil of the editor's own colour laid over the paper,
	 * not by making the paper translucent: a block being dragged off the page is the
	 * paper's child, and translucency would dim it along with the page. The veil lies
	 * above the blocks at rest (z-index 1) and under the one in the hand (3), which
	 * so comes up at full strength the moment it is picked up. The shadow, which the
	 * veil does not reach, is dimmed by the same amount in its own colours.
	 */
	.paper::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 2;
		border-radius: inherit;
		background: var(--panel);
		opacity: 0;
		pointer-events: none;
	}

	.slot:not([data-role='current']) .paper {
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.21),
			0 12px 40px rgba(0, 0, 0, 0.19);
		cursor: pointer;
	}

	.slot:not([data-role='current']) .paper::after {
		opacity: 0.58;
	}

	@media (hover: hover) {
		.slot:not([data-role='current']) .paper:hover {
			box-shadow:
				0 1px 2px rgba(0, 0, 0, 0.31),
				0 12px 40px rgba(0, 0, 0, 0.28);
		}

		.slot:not([data-role='current']) .paper:hover::after {
			opacity: 0.38;
		}
	}

	/* The drop target: full strength and ringed, so it is plain where the block goes. */
	.slot.is-target .paper::after {
		opacity: 0;
	}

	.slot.is-target .paper {
		box-shadow:
			0 0 0 2px var(--panel),
			0 0 0 4px var(--fg-1),
			var(--paper-shadow-lg);
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 24px;
		text-align: center;
		pointer-events: none;
	}

	.empty-title {
		color: var(--paper-fg);
		font: var(--font-ui);
	}

	.empty-note {
		max-width: 220px;
		color: var(--paper-fg-2);
		font:
			400 12px/16px Inter,
			system-ui,
			sans-serif;
	}

	@media (forced-colors: active) {
		.paper {
			border: 1px solid CanvasText;
		}

		.slot.is-target .paper {
			outline: 2px solid Highlight;
			outline-offset: 2px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.slot {
			animation: none;
		}

		:global(.is-animated) .slot,
		:global(.is-animated) .paper {
			transition: none;
		}
	}
</style>
