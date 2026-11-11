<script lang="ts">
	/**
	 * The handles on a block of the page shown, pointer only: the keys and the toolbar
	 * do what they do. A chart's are its corners, which resize it keeping its aspect,
	 * and a ⊖ that removes it; a text's or a table's are its sides, which set its
	 * width, and the knob on a stalk over its top, which turns it.
	 *
	 * They show while the block is hovered or selected, and while it is resized;
	 * carried, a block puts them away, and so do the others while one is carried. What
	 * the block is doing is its frame's (`BlockFrame`), which these are drawn in.
	 */
	import type { ResizeAnchor } from '$lib/document/geometry';
	import type { DocBlock } from '$lib/document/types';
	import type { EditorActions, TextSide } from '../editor/actions';
	import { ICONS } from './icons';
	import { pressGuard } from './press';

	interface Props {
		block: DocBlock;
		/** A chart's ⊖, by its name. */
		removeLabel?: string;
		actions: EditorActions;
	}

	let { block, removeLabel, actions }: Props = $props();

	const CORNERS: readonly ResizeAnchor[] = ['nw', 'ne', 'sw', 'se'];
	const SIDES: readonly TextSide[] = ['w', 'e'];

	const press = pressGuard();

	function handleRemovePointerDown(event: PointerEvent) {
		event.stopPropagation();
		press.begin(event);
	}

	function handleRemoveClick(event: MouseEvent) {
		if (press.counts(event)) actions.blocks.remove(block);
	}
</script>

{#if block.kind === 'chart'}
	{@const chart = block}
	{#each CORNERS as corner (corner)}
		<span
			class="handle"
			data-handle={corner}
			aria-hidden="true"
			onpointerdown={(event) => actions.pointer.resize(event, chart, corner)}
		>
			<svg viewBox="0 0 24 24">
				<path class="halo" d="M9 19V9h10" />
				<path class="bracket" d="M9 19V9h10" />
			</svg>
		</span>
	{/each}
	<button
		class="remove"
		type="button"
		tabindex="-1"
		aria-label={removeLabel}
		title="Remove chart"
		onpointerdown={handleRemovePointerDown}
		onclick={handleRemoveClick}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d={ICONS.minus} /></svg>
	</button>
{:else}
	{@const type = block}
	{#each SIDES as side (side)}
		<!-- The width is the text's own to keep from the keyboard. -->
		<span
			class="handle"
			data-handle={side}
			aria-hidden="true"
			onpointerdown={(event) => actions.pointer.resize(event, type, side)}
		></span>
	{/each}
	<!-- The toolbar turns it by quarters, as R does. -->
	<span
		class="knob"
		aria-hidden="true"
		onpointerdown={(event) => actions.pointer.turn(event, type)}
	>
		<svg viewBox="0 0 16 16">
			<path d={ICONS.turn} />
		</svg>
	</span>
{/if}

<style>
	/*
	 * In ink for paper. Hidden, they take no presses either (nor does the ⊖): on a
	 * touch screen nothing shows them before the block is selected, and an unseen
	 * control must not act.
	 */
	.handle {
		position: absolute;
		z-index: 2;
		opacity: 0;
		pointer-events: none;
		touch-action: none;
		transition: opacity var(--ease-ui);
		-webkit-tap-highlight-color: transparent;
	}

	/* A chart's: corner brackets, the pinhole frame's resize handles. */
	:global(.is-chart) .handle {
		width: 24px;
		height: 24px;
		margin: -12px;
	}

	.handle[data-handle='nw'] {
		top: 0;
		left: 0;
		cursor: nwse-resize;
	}

	.handle[data-handle='ne'] {
		top: 0;
		right: 0;
		cursor: nesw-resize;
	}

	.handle[data-handle='sw'] {
		bottom: 0;
		left: 0;
		cursor: nesw-resize;
	}

	.handle[data-handle='se'] {
		right: 0;
		bottom: 0;
		cursor: nwse-resize;
	}

	.handle svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.handle[data-handle='ne'] svg {
		transform: scaleX(-1);
	}

	.handle[data-handle='sw'] svg {
		transform: scaleY(-1);
	}

	.handle[data-handle='se'] svg {
		transform: scale(-1);
	}

	.halo {
		stroke: #ffffff;
		stroke-width: 5;
	}

	.bracket {
		stroke: var(--ink);
		stroke-width: 2;
	}

	/* A text's: round knobs on the two sides, for the width is all its frame has to set. */
	:global(.is-type) .handle {
		top: 50%;
		width: 20px;
		height: 28px;
		margin-top: -14px;
		cursor: ew-resize;
	}

	:global(.is-type) .handle::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 8px;
		height: 8px;
		margin: -5px;
		border: 1px solid var(--ink);
		border-radius: 50%;
		background: #ffffff;
	}

	.handle[data-handle='w'] {
		left: -13px;
	}

	.handle[data-handle='e'] {
		right: -13px;
	}

	/* The knob that turns a text, on a stalk over the middle of its top. */
	.knob {
		position: absolute;
		z-index: 2;
		bottom: 100%;
		left: 50%;
		width: 24px;
		height: 24px;
		margin-left: -12px;
		opacity: 0;
		pointer-events: none;
		cursor: grab;
		touch-action: none;
		transition: opacity var(--ease-ui);
		-webkit-tap-highlight-color: transparent;
	}

	/* The stalk: just enough to say what the knob belongs to. */
	.knob::before {
		content: '';
		position: absolute;
		bottom: 3px;
		left: 50%;
		width: 1px;
		height: 5px;
		margin-left: -0.5px;
		background: var(--paper-edge);
	}

	/* A turning arrow, in the ink of the other handles; on white, so it reads over a chart too. */
	.knob svg {
		position: absolute;
		top: 0;
		left: 50%;
		box-sizing: border-box;
		width: 16px;
		height: 16px;
		margin-left: -8px;
		padding: 1px;
		border-radius: 50%;
		background: #ffffff;
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	:global(.block[data-state='resizing']) .knob {
		cursor: grabbing;
	}

	/* A chart's ⊖: inset clear of the corner handle's box, with a 28 px target around the 20 px badge. */
	.remove {
		position: absolute;
		z-index: 2;
		top: 16px;
		left: 16px;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--accent);
		box-shadow:
			0 0 0 1.5px #ffffff,
			0 1px 3px rgba(0, 0, 0, 0.35);
		color: #ffffff;
		opacity: 0;
		pointer-events: none;
		cursor: pointer;
		transition:
			opacity var(--ease-ui),
			background var(--ease-ui),
			transform var(--ease-ui);
	}

	.remove::before {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: 50%;
	}

	.remove svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	@media (hover: hover) {
		:global(.is-interactive:hover) .handle,
		:global(.is-interactive:hover) .knob,
		:global(.is-interactive:hover) .remove {
			opacity: 1;
			pointer-events: auto;
		}

		.remove:hover {
			background: var(--accent-hover);
			transform: scale(1.08);
		}
	}

	:global(.is-interactive:focus-within) .handle,
	:global(.is-interactive:focus-within) .knob,
	:global(.is-interactive:focus-within) .remove,
	:global(.block[data-state='resizing']) .handle,
	:global(.block[data-state='resizing']) .knob {
		opacity: 1;
		pointer-events: auto;
	}

	/* Mid-drag the block is all that matters; the minus would only get in the way. */
	:global(.block:not([data-state='idle'])) .remove {
		opacity: 0;
		pointer-events: none;
	}

	/*
	 * Carried, a block is what it shows and its shadow, with no handles around it;
	 * and while one is carried, the others put theirs away too.
	 */
	:global(.block:not([data-state='idle'], [data-state='resizing'])) .handle,
	:global(.block:not([data-state='idle'], [data-state='resizing'])) .knob,
	:global(.block.is-quiet) .handle,
	:global(.block.is-quiet) .knob,
	:global(.block.is-quiet) .remove {
		opacity: 0;
		pointer-events: none;
		transition: none;
	}

	.remove:active {
		background: var(--accent-press);
	}

	.remove:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		opacity: 1;
		box-shadow: var(--ring-paper);
	}

	/* No hover on touch screens: bigger targets for the fingers once the block is selected. */
	@media (pointer: coarse) {
		:global(.is-chart) .handle {
			width: 40px;
			height: 40px;
			margin: -20px;
		}

		.handle svg {
			margin: 8px;
			width: 24px;
			height: 24px;
		}

		.remove {
			top: 20px;
			left: 20px;
			width: 28px;
			height: 28px;
		}

		:global(.is-type) .handle {
			width: 36px;
			height: 40px;
			margin-top: -20px;
		}

		.handle[data-handle='w'] {
			left: -21px;
		}

		.handle[data-handle='e'] {
			right: -21px;
		}
	}

	@media (forced-colors: active) {
		.remove {
			border: 1px solid ButtonText;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.handle,
		.knob,
		.remove {
			transition: none;
		}
	}
</style>
