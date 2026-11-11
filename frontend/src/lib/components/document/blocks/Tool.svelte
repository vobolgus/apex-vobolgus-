<script lang="ts">
	/**
	 * A tool in a block's toolbar: an icon, or a word or a letter. Out of the tab
	 * order, as the keys do what the tools do; a press on it keeps the focus where it
	 * is, and it acts only on a click that began on it (`PressGuard`). Its look is the
	 * toolbar's.
	 */
	import type { Snippet } from 'svelte';
	import { pressGuard } from './press';

	interface Props {
		/** What it does, when its face does not say it. */
		label?: string;
		title?: string;
		/** A toggle: whether it is on. */
		pressed?: boolean;
		disabled?: boolean;
		/** Its icon: a path in a 16-unit box. Without one, `children` is its face. */
		icon?: string;
		/** A word, as wide as it needs. */
		wide?: boolean;
		/** A letter, in the face of the type it sets. */
		letter?: boolean;
		onpress: () => void;
		children?: Snippet;
	}

	let {
		label,
		title,
		pressed,
		disabled = false,
		icon,
		wide = false,
		letter = false,
		onpress,
		children
	}: Props = $props();

	const press = pressGuard();
</script>

<button
	class="tool"
	class:is-wide={wide}
	class:is-letter={letter}
	type="button"
	tabindex="-1"
	aria-label={label}
	aria-pressed={pressed}
	{title}
	{disabled}
	onpointerdown={(event) => press.hold(event)}
	onclick={(event) => {
		if (press.counts(event)) onpress();
	}}
>
	{#if icon}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d={icon} /></svg>
	{:else}
		{@render children?.()}
	{/if}
</button>
