<script lang="ts">
	/**
	 * A chip in a row under a block's toolbar: one of a few to choose from (what a
	 * table lists, the chart a text reads), or a field to put in the words. A tool in
	 * all but its look: out of the tab order, the focus kept where it is, acting only
	 * on a click that began on it. Its look is the toolbar's.
	 */
	import type { Snippet } from 'svelte';
	import { pressGuard } from './press';

	interface Props {
		label?: string;
		title?: string;
		/** One of a choice: whether it is the one chosen. */
		pressed?: boolean;
		/** A number: kept as narrow as one. */
		number?: boolean;
		onpress: () => void;
		children: Snippet;
	}

	let { label, title, pressed, number = false, onpress, children }: Props = $props();

	const press = pressGuard();
</script>

<button
	class="field"
	class:is-number={number}
	type="button"
	tabindex="-1"
	aria-pressed={pressed}
	aria-label={label}
	{title}
	onpointerdown={(event) => press.hold(event)}
	onclick={(event) => {
		if (press.counts(event)) onpress();
	}}
>
	{@render children()}
</button>
