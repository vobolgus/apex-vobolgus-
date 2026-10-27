<script lang="ts">
	/**
	 * Portrait / landscape for one page: a compact icon-only radio group above the
	 * page in the editor, the dock's segmented control in miniature.
	 *
	 * One tab stop (the checked option); ←/→ and ↑/↓ switch, and are kept from the
	 * editor, where ←/→ change the current page.
	 */
	import type { PageOrientation } from '$lib/document/types';

	interface Props {
		/** Accessible name of the group, e.g. "Page 2 orientation". */
		label: string;
		value: PageOrientation;
		onselect: (value: PageOrientation) => void;
	}

	let { label, value, onselect }: Props = $props();

	const OPTIONS: readonly { value: PageOrientation; name: string; icon: string }[] = [
		{
			value: 'portrait',
			name: 'Portrait',
			icon: 'M5.5 2.25h5a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 12.25v-8.5a1.5 1.5 0 0 1 1.5-1.5Z'
		},
		{
			value: 'landscape',
			name: 'Landscape',
			icon: 'M3.75 4h8.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 3.75 4Z'
		}
	];

	let groupEl = $state<HTMLDivElement>();

	function handleKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat) return;
		const next = value === 'portrait' ? 'landscape' : 'portrait';
		onselect(next);
		// The checked option is the tab stop; take the focus with the selection.
		queueMicrotask(() => groupEl?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
	}
</script>

<div bind:this={groupEl} class="orientation" role="radiogroup" aria-label={label}>
	{#each OPTIONS as option (option.value)}
		{@const checked = option.value === value}
		<button
			class="option"
			type="button"
			role="radio"
			aria-checked={checked}
			aria-label={option.name}
			title={option.name}
			tabindex={checked ? 0 : -1}
			onclick={() => {
				if (!checked) onselect(option.value);
			}}
			onkeydown={handleKeydown}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path d={option.icon} />
			</svg>
		</button>
	{/each}
</div>

<style>
	.orientation {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border-radius: var(--r-ctl);
		background: var(--fill-hover);
	}

	.option {
		display: grid;
		place-items: center;
		width: 28px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: var(--r-row);
		background: transparent;
		color: var(--fg-3);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.option[aria-checked='true'] {
		background: var(--fill-on);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
		color: var(--fg-1);
		cursor: default;
	}

	@media (hover: hover) {
		.option:not([aria-checked='true']):hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.option:not([aria-checked='true']):active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	/* The ring is a box-shadow, which forced colors drop; the transparent outline then shows. */
	.option:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
	}

	@media (forced-colors: active) {
		.option[aria-checked='true'] {
			outline: 1px solid Highlight;
		}
	}
</style>
