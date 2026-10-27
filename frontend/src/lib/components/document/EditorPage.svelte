<script module lang="ts">
	import type { SnapGuide } from '$lib/document/geometry';
	import type { Rect } from '$lib/document/types';

	/** What a drag (or a keyboard nudge) draws on one page. */
	export interface PageDrag {
		/** This page's chart being dragged, if it is this page's. */
		itemId: string | null;
		/** Where to draw that chart, this page's mm. */
		frame: Rect | null;
		kind: 'moving' | 'detached' | 'resizing';
		/** Snap guides to draw on this page, mm. */
		guides: SnapGuide[];
		/** The chart would land on this page if dropped now. */
		target: boolean;
	}
</script>

<script lang="ts">
	/**
	 * One page in the editor: its label and orientation toggle above white paper,
	 * and the charts on it. The current page's charts are editable; a neighbouring
	 * page is a button that makes it current, and a drop target.
	 */
	import { contentBox, pageSize, type ResizeAnchor } from '$lib/document/geometry';
	import type { DocItem, DocPage, PageOrientation } from '$lib/document/types';
	import { chartCountLabel } from '$lib/document/labels';
	import EditorItem, { type ChartAction } from './EditorItem.svelte';
	import EditorOrientation from './EditorOrientation.svelte';
	import type { Box, SlotRole } from './editor-geometry';

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
		drag: PageDrag | null;
		/** A chart easing back after a drag that was let go off every page. */
		returningId: string | null;
		hintId: string;
		onactivate: (pageId: string) => void;
		onorientation: (pageId: string, orientation: PageOrientation) => void;
		onmovestart: (event: PointerEvent, item: DocItem) => void;
		onresizestart: (event: PointerEvent, item: DocItem, handle: ResizeAnchor) => void;
		onitemkeydown: (event: KeyboardEvent, item: DocItem) => void;
		onremove: (item: DocItem) => void;
		onitemaction: (item: DocItem, action: ChartAction) => void;
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
		drag,
		returningId,
		hintId,
		onactivate,
		onorientation,
		onmovestart,
		onresizestart,
		onitemkeydown,
		onremove,
		onitemaction
	}: Props = $props();

	const current = $derived(role === 'current');
	const size = $derived(pageSize(page.orientation));
	const margin = $derived(contentBox(page.orientation));
	const count = $derived(page.items.length);
	const chartWord = $derived(chartCountLabel(count));

	function itemState(item: DocItem) {
		if (drag?.itemId === item.id) return drag.kind;
		return returningId === item.id ? 'returning' : 'idle';
	}

	function handlePaperPointerDown(event: PointerEvent) {
		if (!current) return;
		// A press on bare paper puts the focus on the page: no chart stays selected.
		if ((event.target as Element).closest('[data-item-id]')) return;
		(event.currentTarget as HTMLElement).focus({ preventScroll: true });
	}

	function handlePaperKeydown(event: KeyboardEvent) {
		if (current || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault();
		onactivate(page.id);
	}
</script>

<div
	class="slot"
	data-role={role}
	data-page-id={page.id}
	class:is-target={drag?.target && !current}
	class:is-narrow={narrow}
	style:left="{box.left}px"
	style:top="{box.top - labelHeight}px"
	style:width="{box.width}px"
	style:--label-h="{labelHeight}px"
>
	<div class="label">
		<span class="name">Page {number} <span class="format">· A4</span></span>
		<EditorOrientation
			label="Page {number} orientation"
			value={page.orientation}
			onselect={(orientation) => onorientation(page.id, orientation)}
		/>
	</div>
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
		onclick={() => {
			if (!current) onactivate(page.id);
		}}
		onkeydown={handlePaperKeydown}
	>
		{#each page.items as item, index (item.id)}
			{@const dragged = drag?.itemId === item.id && drag.frame ? drag.frame : null}
			<EditorItem
				{item}
				{index}
				{count}
				page={size}
				orientation={page.orientation}
				{prevPage}
				{nextPage}
				frame={dragged ?? item.frame}
				interactive={current}
				mode={itemState(item)}
				{hintId}
				{onmovestart}
				{onresizestart}
				onkeydown={onitemkeydown}
				{onremove}
				onaction={onitemaction}
			/>
		{/each}

		<!-- Only on the current page: a neighbour is dimmed, which would take its words under 4.5:1. -->
		{#if count === 0 && current && !drag?.target}
			<div class="empty" aria-hidden="true">
				<span class="empty-title">Empty page</span>
				<span class="empty-note"
					>Drag a chart here from a neighbouring page, or use Add to PDF.</span
				>
			</div>
		{/if}

		{#if drag && (drag.guides.length > 0 || (drag.target && drag.kind !== 'detached'))}
			<svg
				class="guides"
				viewBox="0 0 {size.w} {size.h}"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				{#if drag.target}
					<rect
						class="margin"
						x={margin.x}
						y={margin.y}
						width={margin.w}
						height={margin.h}
						vector-effect="non-scaling-stroke"
					/>
				{/if}
				{#each drag.guides as guide, i (i)}
					{#if guide.axis === 'x'}
						<line
							x1={guide.at}
							x2={guide.at}
							y1={guide.from}
							y2={guide.to}
							vector-effect="non-scaling-stroke"
						/>
					{:else}
						<line
							x1={guide.from}
							x2={guide.to}
							y1={guide.at}
							y2={guide.at}
							vector-effect="non-scaling-stroke"
						/>
					{/if}
				{/each}
			</svg>
		{/if}
	</div>
</div>

<style>
	.slot {
		position: absolute;
		z-index: 1;
		animation: slot-in 200ms ease-out;
	}

	/* Above its neighbours, so a chart dragged off it is drawn over them. */
	.slot[data-role='current'] {
		z-index: 2;
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
			opacity 160ms ease,
			box-shadow 160ms ease;
	}

	@keyframes slot-in {
		from {
			opacity: 0;
		}
	}

	.label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		box-sizing: border-box;
		height: var(--label-h);
		padding-bottom: 8px;
	}

	.name {
		min-width: 0;
		overflow: hidden;
		color: var(--fg-2);
		font: var(--font-ui);
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.slot[data-role='current'] .name {
		color: var(--fg-1);
	}

	.format {
		color: var(--fg-3);
	}

	/* The neighbours peek in at the stage's edges; their labels would be cut off. */
	.slot.is-narrow:not([data-role='current']) .label {
		visibility: hidden;
	}

	.paper {
		position: relative;
		border-radius: 2px;
		background: var(--paper);
		box-shadow: var(--paper-shadow-lg);
		outline: none;
	}

	/* Programmatic focus lands here after the last selected chart goes; show it to the keyboard. */
	.paper:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: var(--ring), var(--paper-shadow-lg);
	}

	.slot:not([data-role='current']) .paper {
		opacity: 0.42;
		cursor: pointer;
	}

	@media (hover: hover) {
		.slot:not([data-role='current']) .paper:hover {
			opacity: 0.62;
		}
	}

	/* The drop target: full strength and ringed, so it is plain where the chart goes. */
	.slot.is-target .paper {
		opacity: 1;
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

	.guides {
		position: absolute;
		inset: 0;
		z-index: 5;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	.guides line {
		stroke: var(--guide);
		stroke-width: 1;
	}

	.guides .margin {
		fill: none;
		stroke: var(--paper-margin);
		stroke-width: 1;
		stroke-dasharray: 4 3;
	}

	@media (forced-colors: active) {
		.paper {
			border: 1px solid CanvasText;
		}

		.slot.is-target .paper {
			outline: 2px solid Highlight;
			outline-offset: 2px;
		}

		.guides line {
			stroke: Highlight;
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
