<script lang="ts">
	/**
	 * What a drag on a block reads out while it goes on, in the dark of the toolbar it
	 * stands in for: a chart's size as its corner is dragged, a text's angle as its
	 * knob turns it. For the eye only; the editor says what the drag did once it is let go.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		/** Where it stands, against the block's box (CSS lengths). */
		top?: string;
		bottom?: string;
		children: Snippet;
	}

	let { top, bottom, children }: Props = $props();
</script>

<span class="readout" aria-hidden="true" style:top style:bottom>{@render children()}</span>

<style>
	.readout {
		position: absolute;
		z-index: 4;
		left: 50%;
		display: flex;
		align-items: center;
		height: 24px;
		padding: 0 10px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		background: rgba(24, 24, 27, 0.92);
		color: #eceef1;
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transform: translateX(-50%);
		pointer-events: none;
	}
</style>
