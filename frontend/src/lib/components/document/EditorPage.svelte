<script lang="ts">
	/**
	 * One page in the editor: its label and orientation toggle above white paper,
	 * and the charts and text on it. The current page's are editable; a neighbouring
	 * page is a button that makes it current, and a drop target.
	 */
	import { contentBox, pageSize } from '$lib/document/geometry';
	import { chartsOf, isBlank, typesetOf } from '$lib/document/blocks';
	import { boundItem, hasFields, shownText } from '$lib/document/text';
	import type { DocPage, TypesetBlock } from '$lib/document/types';
	import { chartCountLabel, plural } from '$lib/document/labels';
	import type { EditorActions } from './editor/actions';
	import type { PageDrag } from './editor/drag-view';
	import EditorItem from './EditorItem.svelte';
	import EditorOrientation from './EditorOrientation.svelte';
	import EditorText from './EditorText.svelte';
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
		/** A chart or a text is being carried somewhere in the editor: the others go quiet. */
		carrying?: boolean;
		/** The text being typed in. */
		editingId?: string | null;
		/** The document's pages: a text may read a chart on another of them. */
		pages?: readonly DocPage[];
		hintId: string;
		textHintId?: string;
		/** What the page and what is on it ask of the editor. */
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
		drag,
		returningId,
		settlingId = null,
		carrying = false,
		editingId = null,
		pages = [],
		hintId,
		textHintId,
		actions
	}: Props = $props();

	const current = $derived(role === 'current');
	const size = $derived(pageSize(page.orientation));
	const margin = $derived(contentBox(page.orientation));
	const charts = $derived(chartsOf(page));
	const count = $derived(charts.length);
	const chartIds = $derived(charts.map((item) => item.id));
	const texts = $derived(typesetOf(page));
	const blank = $derived(isBlank(page));
	/** "2 charts", and "2 charts, 1 text" once the page has text. */
	const chartWord = $derived(
		texts.length > 0
			? `${chartCountLabel(count)}, ${plural(texts.length, 'text')}`
			: chartCountLabel(count)
	);
	/** Screen px per mm. */
	const scale = $derived(box.width / size.w);

	/**
	 * One of this page's charts or texts is in the hand, or on its way to rest after
	 * being let go. The page then stacks above every other, the current one included:
	 * the chart is this page's child wherever on the stage it is drawn, and under
	 * another page it would be out of sight.
	 */
	const lifted = $derived(
		page.blocks.some(
			(item) => item.id === drag?.blockId || item.id === settlingId || item.id === returningId
		)
	);

	/** The text that has the focus (itself, its field or its toolbar). */
	let selectedTextId = $state<string | null>(null);

	function textOf(target: EventTarget | null): string | null {
		const element = (target as Element | null)?.closest?.<HTMLElement>('[data-kind="text"]');
		return element?.dataset.itemId ?? null;
	}

	/**
	 * The chart the selected text reads, while that is a question: the page has two
	 * charts or more, and the text has fields (or is being typed in, and may get some).
	 * The charts then show their numbers, this one marked.
	 */
	const readId = $derived.by(() => {
		if (!current || count < 2) return null;
		const text = texts.find((it) => it.id === selectedTextId);
		const asked = text && (text.kind === 'table' || hasFields(text.text) || editingId === text.id);
		if (!text || !asked) return null;
		return boundItem(page, text, pages)?.id ?? null;
	});

	/** Where on the page the chart a text reads is, 0-based; null when it reads none here. */
	function readIndex(text: TypesetBlock): number | null {
		const id = boundItem(page, text, pages)?.id;
		const at = charts.findIndex((item) => item.id === id);
		return at < 0 ? null : at;
	}

	/** The charts on the other pages, each by its id and "Page 2 · chart 1". */
	const others = $derived(
		pages.flatMap((sheet, at) =>
			sheet.id === page.id
				? []
				: chartsOf(sheet).map((item, i) => ({
						id: item.id,
						label: `Page ${at + 1} · chart ${i + 1}`
					}))
		)
	);

	/** The id of the chart on another page a text reads, if it reads one there. */
	function readOther(text: TypesetBlock): string | null {
		const id = boundItem(page, text, pages)?.id;
		return id !== undefined && others.some((other) => other.id === id) ? id : null;
	}

	function itemState(item: { id: string }) {
		if (drag?.blockId === item.id) return drag.kind;
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
		actions.pages.show(page.id);
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
			{#if current && count > 0}
				<button
					class="action"
					type="button"
					aria-label="Lay page {number} out as a template"
					aria-haspopup="dialog"
					title="Lay out as a template"
					onclick={(event) => actions.pages.pickTemplate(page.id, event.currentTarget)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3.5 3.5h9v9h-9zM3.5 6.5h9M8 6.5v6" />
					</svg>
				</button>
			{/if}
			{#if current}
				<button
					class="action"
					type="button"
					aria-label="Add text to page {number}"
					title="Add text"
					onclick={() => actions.blocks.addText(page.id)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3.5 5V3.5h9V5M8 3.5v9M6.25 12.5h3.5" />
					</svg>
				</button>
				<button
					class="action"
					type="button"
					aria-label="Add a table to page {number}"
					title="Add a table"
					onclick={() => actions.blocks.addTable(page.id)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M2.5 4h11M2.5 8h11M2.5 12h11M6.5 4v8" />
					</svg>
				</button>
			{/if}
			<!-- Only an empty page: one with charts is deleted from the pages panel, where they show. -->
			{#if blank}
				<button
					class="action"
					type="button"
					aria-label="Delete page {number}"
					aria-keyshortcuts={current ? 'Delete' : undefined}
					title="Delete this empty page"
					onclick={() => actions.pages.remove(page.id)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.75 7v3.5M9.25 7v3.5" />
					</svg>
				</button>
			{/if}
			<EditorOrientation
				label="Page {number} orientation"
				value={page.orientation}
				onselect={(orientation) => actions.pages.setOrientation(page.id, orientation)}
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
		onfocusin={(event) => (selectedTextId = textOf(event.target))}
		onfocusout={(event) => {
			if (textOf(event.relatedTarget) === null) selectedTextId = null;
		}}
		onclick={() => {
			if (!current) actions.pages.show(page.id);
		}}
		onkeydown={handlePaperKeydown}
	>
		{#each charts as item, index (item.id)}
			{@const dragged = drag?.blockId === item.id && drag.frame ? drag.frame : null}
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
				badge={readId === null ? null : index + 1}
				linked={readId === item.id}
				{hintId}
				{actions}
			/>
		{/each}

		{#each texts as text, index (text.id)}
			{@const dragged = drag?.blockId === text.id && drag.frame ? drag.frame : null}
			{@const turned = drag?.blockId === text.id ? drag.rotation : null}
			<EditorText
				{text}
				shown={text.kind === 'text' ? shownText(page, text, pages) : ''}
				sheet={page}
				{pages}
				{others}
				readsOther={readOther(text)}
				{index}
				count={texts.length}
				page={size}
				{scale}
				frame={dragged ?? text.frame}
				rotation={turned ?? text.rotation ?? 0}
				turning={turned !== null}
				interactive={current}
				mode={itemState(text)}
				quiet={carrying && itemState(text) === 'idle'}
				editing={current && editingId === text.id}
				{chartIds}
				reads={readIndex(text)}
				pinned={charts.some((item) => item.id === text.chartId)}
				hintId={textHintId}
				{actions}
			/>
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
			<svg
				class="guides"
				viewBox="0 0 {size.w} {size.h}"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				{#if drag.margins}
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

	.action {
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
		.action:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.action:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.action:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.action svg {
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
