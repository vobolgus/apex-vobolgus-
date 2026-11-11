<script lang="ts">
	/**
	 * What every block on a page in the editor has, whatever it holds: its place on
	 * the page, in percent of it, so it follows the page as the editor zooms; what it
	 * is doing (`data-state`), which lifts it into the hand, lands it and eases it
	 * back; the body a press carries it by, focusable on the current page, with its
	 * frame shown on hover and while it is selected; and the handles on it
	 * (`BlockHandles`).
	 *
	 * A text or a table is drawn turned with its handles, about its centre, and typed
	 * in it shows its field in their place. What it shows (`children`), its toolbar
	 * and its readouts (`upright`, which do not turn) are its own.
	 *
	 * A neighbour's block is its body alone: grabbed and dropped on another page,
	 * nothing more.
	 */
	import type { Snippet } from 'svelte';
	import type { DocBlock, Rect } from '$lib/document/types';
	import type { EditorActions } from '../editor/actions';
	import type { BlockState } from '../editor/drag-view';
	import type { Size } from '../editor-geometry';
	import BlockHandles from './BlockHandles.svelte';
	import { providePressGuard } from './press';

	interface Props {
		block: DocBlock;
		/** The page, mm. */
		page: Size;
		/** Where to draw it, mm on its page; off the page while it is dragged to another. */
		box: Rect;
		mode: BlockState;
		/** On the current page: focusable, with its handles and its toolbar. Elsewhere it can still be dragged. */
		interactive: boolean;
		/** Another block is being carried: this one puts its frame and controls away. */
		quiet: boolean;
		/** Its accessible name. */
		name: string;
		/** Id of the element that explains the keys. */
		hintId?: string;
		/** A text's or a table's: the degrees it is drawn turned, clockwise. */
		turn?: number;
		/** A chart drawn as a disc: in the hand, its shadow is round too. */
		disc?: boolean;
		/** The chart the selected text reads. */
		linked?: boolean;
		/** A text being typed in: its field (`field`) stands where its handles were. */
		editing?: boolean;
		/** A chart's ⊖, by its name. */
		removeLabel?: string;
		/** Out: the body, which has the focus while the block is selected. */
		body?: HTMLElement;
		/** What a press, a key or a handle asks of the editor. */
		actions: EditorActions;
		children: Snippet;
		field?: Snippet;
		upright?: Snippet;
	}

	let {
		block,
		page,
		box,
		mode,
		interactive,
		quiet,
		name,
		hintId,
		turn = 0,
		disc = false,
		linked = false,
		editing = false,
		removeLabel,
		body = $bindable(),
		actions,
		children,
		field,
		upright
	}: Props = $props();

	/** The keys a block takes (`blockCommand`): text and tables are typed in, and turn. */
	const KEYS = {
		chart: 'ArrowLeft ArrowRight ArrowUp ArrowDown = - PageUp PageDown Delete',
		type: 'Enter ArrowLeft ArrowRight ArrowUp ArrowDown = - R PageUp PageDown Delete'
	} as const;

	const press = providePressGuard();
	const chart = $derived(block.kind === 'chart');

	function handleBodyPointerDown(event: PointerEvent) {
		press.clear();
		actions.pointer.carry(event, block);
	}

	function handleDoubleClick() {
		if (block.kind === 'text') actions.blocks.edit(block);
	}
</script>

<!-- What it shows, and on the current page what is on it: the part that turns with a text. -->
{#snippet held()}
	{#if interactive}
		<div
			bind:this={body}
			class="body"
			role="button"
			tabindex="0"
			aria-roledescription={block.kind}
			aria-label={name}
			aria-describedby={hintId}
			aria-keyshortcuts={chart ? KEYS.chart : KEYS.type}
			onpointerdown={handleBodyPointerDown}
			ondblclick={handleDoubleClick}
			onkeydown={(event) => actions.blocks.keydown(event, block)}
		>
			{@render children()}
		</div>
		{#if editing && field}
			{@render field()}
		{:else}
			<BlockHandles {block} {removeLabel} {actions} />
		{/if}
	{:else}
		<!-- A neighbour's block: not focusable, but it can be grabbed and dropped on another page.
		     Pointer only, like dragging itself: the keys move a block with Page Up/Down, and the
		     neighbouring page around it is the button that makes it current. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="body is-grabbable" onpointerdown={handleBodyPointerDown}>
			{@render children()}
		</div>
	{/if}
{/snippet}

<div
	class="block"
	class:is-chart={chart}
	class:is-type={!chart}
	class:is-interactive={interactive}
	class:is-disc={disc}
	class:is-quiet={quiet}
	class:is-linked={linked}
	class:is-editing={editing}
	data-item-id={block.id}
	data-kind={block.kind}
	data-state={mode}
	style:left="{(box.x / page.w) * 100}%"
	style:top="{(box.y / page.h) * 100}%"
	style:width="{(box.w / page.w) * 100}%"
	style:height="{(box.h / page.h) * 100}%"
>
	{#if chart}
		{@render held()}
	{:else}
		<div class="turn" style:rotate="{turn}deg">
			{@render held()}
		</div>
	{/if}
	{#if interactive}
		{@render upright?.()}
	{/if}
</div>

<style>
	.block {
		--lift: 0 8px 20px rgba(0, 0, 0, 0.3);
		position: absolute;
		box-sizing: border-box;
		/* Drawn as they print: a chart drawn later on top, and text over the charts. */
		z-index: 1;
	}

	.block.is-interactive:focus-within,
	.block:not([data-state='idle']) {
		z-index: 3;
	}

	.block[data-state='returning'] {
		transition:
			left 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
			top 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	/*
	 * In the hand, or resized: on a layer of its own. Painted on the paper's, every
	 * frame of it leaves the paper to repaint what it gave up, and in Safari, with the
	 * page zoomed to anything but a whole number of pixels, the edge of each such
	 * repaint is left behind as a hairline down the page. The shadow is a box-shadow
	 * for Safari too: a drop-shadow filter on an element that moves every frame left
	 * smears behind it.
	 */
	.block[data-state='moving'],
	.block[data-state='detached'],
	.block[data-state='resizing'] {
		will-change: transform;
	}

	/* In the hand: lifted off the paper, wherever it is carried. */
	.block[data-state='moving'] .body,
	.block[data-state='detached'] .body {
		box-shadow: var(--lift);
		cursor: grabbing;
	}

	/* A text in the hand is a slip of paper: off the page its words would lie on the dark. */
	.is-type[data-state='moving'] .body,
	.is-type[data-state='detached'] .body,
	.is-type[data-state='settling'] .body,
	.is-type[data-state='returning'] .body {
		background: var(--paper);
	}

	.block.is-disc:not([data-state='idle'], [data-state='resizing']) .body {
		border-radius: 50%;
	}

	/* Let go: the shadow goes as it comes down onto the paper. */
	.block[data-state='settling'] .body,
	.block[data-state='returning'] .body {
		animation: land 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}

	@keyframes land {
		from {
			box-shadow: var(--lift);
		}

		to {
			box-shadow: 0 0 0 rgba(0, 0, 0, 0);
		}
	}

	/* Out of reach of every page: let go here and it goes back, so it is half there. */
	.block[data-state='detached'] {
		opacity: 0.6;
	}

	/* What turns: the words, the field, the handles. The toolbar stays upright. */
	.turn {
		position: absolute;
		inset: 0;
	}

	.body {
		position: absolute;
		inset: 0;
		border-radius: 1px;
		user-select: none;
		-webkit-user-select: none;
	}

	/*
	 * The sky's edge. The preview strokes it one preview px wide in mm, a third of a
	 * screen px here, which leaves a white chart on white paper all but edgeless;
	 * drawn at 1 px as the panel's thumbnails do, over the picture.
	 */
	.is-chart .body::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px var(--paper-chart-edge);
		pointer-events: none;
	}

	.is-disc .body::before {
		border-radius: 50%;
	}

	/* The chart the selected text reads: its edge in the accent, its number filled. */
	.is-linked .body::before {
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	/* A neighbour's block: grabbed and dropped like the current page's, nothing more. */
	.body.is-grabbable,
	.is-interactive .body {
		cursor: grab;
		touch-action: none;
	}

	.is-type .body.is-grabbable,
	.is-interactive .body {
		-webkit-tap-highlight-color: transparent;
	}

	/* The frame's outline: on hover it reads as movable, while selected it shows the frame. */
	.is-interactive .body::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px var(--paper-edge);
		opacity: 0;
		transition: opacity var(--ease-ui);
		pointer-events: none;
	}

	/* A text's: a little clear of the letters. */
	.is-type .body::after {
		inset: -3px;
		border-radius: 2px;
	}

	.is-interactive:focus-within .body::after,
	.block[data-state='resizing'] .body::after {
		opacity: 1;
	}

	/* A dark ring with a white gap: the app's light ring would vanish on white paper. */
	.body:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: var(--ring-paper);
	}

	.is-type .body:focus-visible {
		outline-offset: 5px;
	}

	/* The field lies exactly over the lines it replaces, in their face and size. */
	.is-editing .body :global(svg) {
		visibility: hidden;
	}

	@media (hover: hover) {
		.is-interactive:hover .body::after {
			opacity: 1;
		}
	}

	/*
	 * Carried, a block is what it shows and its shadow, with no frame around it; and
	 * while one is carried, the others put theirs away too.
	 */
	.block:not([data-state='idle'], [data-state='resizing']) .body::after,
	.block.is-quiet .body::after {
		opacity: 0;
		pointer-events: none;
		transition: none;
	}

	@media (forced-colors: active) {
		.is-interactive .body::after {
			box-shadow: none;
			outline: 1px solid CanvasText;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.block[data-state='returning'] {
			transition: none;
		}

		.is-interactive .body::after {
			transition: none;
		}
	}
</style>
