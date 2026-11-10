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
		/** A chart coming to rest after it was let go over a page. */
		settlingId?: string | null;
		/** A chart is being carried somewhere in the editor: the others go quiet. */
		carrying?: boolean;
		hintId: string;
		onactivate: (pageId: string) => void;
		onorientation: (pageId: string, orientation: PageOrientation) => void;
		/** Delete this page; offered while it is empty. */
		ondelete?: (pageId: string) => void;
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
		settlingId = null,
		carrying = false,
		hintId,
		onactivate,
		onorientation,
		ondelete,
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

	/**
	 * One of this page's charts is in the hand, or on its way to rest after being let
	 * go. The page then stacks above every other, the current one included: the chart
	 * is this page's child wherever on the stage it is drawn, and under another page
	 * it would be out of sight.
	 */
	const lifted = $derived(
		page.items.some(
			(item) => item.id === drag?.itemId || item.id === settlingId || item.id === returningId
		)
	);

	function itemState(item: DocItem) {
		if (drag?.itemId === item.id) return drag.kind;
		if (settlingId === item.id) return 'settling';
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
	class:is-lifted={lifted}
	class:is-narrow={narrow}
	style:left="{box.left}px"
	style:top="{box.top - labelHeight}px"
	style:width="{box.width}px"
	style:--label-h="{labelHeight}px"
>
	<div class="label">
		<span class="name">Page {number} <span class="format">· A4</span></span>
		<div class="actions">
			<!-- Only an empty page: one with charts is deleted from the pages panel, where they show. -->
			{#if count === 0 && ondelete}
				<button
					class="delete"
					type="button"
					aria-label="Delete page {number}"
					aria-keyshortcuts={current ? 'Delete' : undefined}
					title="Delete this empty page"
					onclick={() => ondelete(page.id)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.75 7v3.5M9.25 7v3.5" />
					</svg>
				</button>
			{/if}
			<EditorOrientation
				label="Page {number} orientation"
				value={page.orientation}
				onselect={(orientation) => onorientation(page.id, orientation)}
			/>
		</div>
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
				quiet={carrying && itemState(item) === 'idle'}
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

		<!-- A resize shows the margins it is held to; a chart being carried, its snap lines only with Shift held. -->
		{#if drag && (drag.guides.length > 0 || drag.kind === 'resizing')}
			<svg
				class="guides"
				viewBox="0 0 {size.w} {size.h}"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				{#if drag.kind === 'resizing'}
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

	/* And a page a chart is being dragged from is above them all, the current one too. */
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

	.label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		box-sizing: border-box;
		height: var(--label-h);
		padding-bottom: 8px;
	}

	.actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: 6px;
	}

	.delete {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-3);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.delete:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.delete:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.delete:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.delete svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
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

	/*
	 * A neighbour is dimmed by a veil of the editor's own colour laid over the paper,
	 * not by making the paper translucent: a chart being dragged off the page is the
	 * paper's child, and translucency would dim it along with the page. The veil lies
	 * above the charts at rest (z-index 1) and under the one in the hand (3), which
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

	/* The drop target: full strength and ringed, so it is plain where the chart goes. */
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
