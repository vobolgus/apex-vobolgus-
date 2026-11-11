<script lang="ts">
	/**
	 * The toolbar a block shows while it is selected, in the dark of the readouts:
	 * rows of tools, the first of a block's own, the others ruled off under it. Shown
	 * only while the block is at rest and nothing else is being carried.
	 *
	 * The look of everything in it is here, once, for every block's toolbar: a row
	 * (`.row`, ruled off as `.fields`, kept on one line with `.is-table`), a tool
	 * (`.tool`: an icon, a word with `.is-wide`, a letter with `.is-letter`), a chip
	 * (`.field`, a number with `.is-number`, a list with `.other`), a value between two
	 * tools (`.size`, `.is-rows`), a row's name (`.row-label`), and a divider
	 * (`.tool-divider`). The tools themselves are `Tool` and `Chip`.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		/** The block it belongs to: "Chart 1", "Text 2". */
		label: string;
		/** Where it stands, against the block's box (CSS lengths). */
		top?: string;
		bottom?: string;
		children: Snippet;
	}

	let { label, top, bottom, children }: Props = $props();
</script>

<div class="tools" role="group" aria-label={label} style:top style:bottom>
	{@render children()}
</div>

<style>
	.tools {
		position: absolute;
		z-index: 4;
		left: 50%;
		display: none;
		flex-direction: column;
		gap: 2px;
		padding: 2px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		background: rgba(24, 24, 27, 0.92);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		transform: translateX(-50%);
	}

	:global(.block.is-interactive[data-state='idle']:focus-within) .tools {
		display: flex;
	}

	:global(.block.is-interactive.is-quiet[data-state='idle']:focus-within) .tools {
		display: none;
	}

	/* No hover on touch screens: bigger targets for the fingers once the block is selected. */
	@media (pointer: coarse) {
		.tools :global(.tool) {
			width: 36px;
			height: 36px;
		}
	}

	.tools :global(.row) {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.tools :global(.tool) {
		display: grid;
		flex: none;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: #eceef1;
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.tools :global(.tool.is-wide) {
		width: auto;
		min-width: 44px;
		padding: 0 8px;
	}

	.tools :global(.tool.is-letter) {
		font:
			400 14px/1 'PT Serif',
			Georgia,
			serif;
	}

	.tools :global(.tool[aria-pressed='true']),
	.tools :global(.field[aria-pressed='true']) {
		background: rgba(255, 255, 255, 0.18);
	}

	.tools :global(.tool svg) {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (hover: hover) {
		.tools :global(.tool:not(:disabled):hover),
		.tools :global(.field:hover) {
			background: rgba(255, 255, 255, 0.1);
		}
	}

	.tools :global(.tool:not(:disabled):active),
	.tools :global(.field:active) {
		background: rgba(255, 255, 255, 0.16);
	}

	.tools :global(.tool:disabled) {
		color: rgba(236, 238, 241, 0.4);
		cursor: default;
	}

	.tools :global(.tool:focus-visible),
	.tools :global(.field:focus-visible) {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7);
	}

	.tools :global(.size) {
		min-width: 20px;
		color: #eceef1;
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.tools :global(.size.is-rows) {
		min-width: 52px;
	}

	/* The list of the other pages' charts: a chip like its neighbours, the browser's own list behind it. */
	.tools :global(.field.other) {
		max-width: 132px;
		appearance: none;
		text-overflow: ellipsis;
	}

	.tools :global(.field.other.is-chosen) {
		background: rgba(255, 255, 255, 0.18);
	}

	.tools :global(.field.other option) {
		color: initial;
	}

	.tools :global(.tool-divider) {
		flex: none;
		width: 1px;
		height: 16px;
		margin: 0 2px;
		background: rgba(255, 255, 255, 0.14);
	}

	/* What a table lists and its rows, on one line. */
	.tools :global(.fields.is-table) {
		flex-wrap: nowrap;
		max-width: none;
	}

	.tools :global(.fields) {
		flex-wrap: wrap;
		max-width: 296px;
		padding-top: 2px;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.tools :global(.field) {
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #eceef1;
		font:
			400 12px/1 Inter,
			system-ui,
			sans-serif;
		white-space: nowrap;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.tools :global(.field.is-number) {
		min-width: 24px;
		padding: 0 6px;
		font-variant-numeric: tabular-nums;
	}

	.tools :global(.row-label) {
		padding: 0 4px 0 8px;
		color: rgba(236, 238, 241, 0.6);
		font:
			400 12px/1 Inter,
			system-ui,
			sans-serif;
	}

	@media (forced-colors: active) {
		.tools {
			border: 1px solid ButtonText;
		}
	}
</style>
