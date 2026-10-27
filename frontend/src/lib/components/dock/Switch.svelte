<script lang="ts">
	/**
	 * Monochrome switch row for popovers. The whole row is the `role="switch"`
	 * button, so the hit target is the row and not the 28 px track; the track is
	 * decoration. `variant="header"` is the master switch in a group header.
	 */
	interface Props {
		label: string;
		checked: boolean;
		onchange: (checked: boolean) => void;
		/** One quiet line under the label, read out as the description. */
		note?: string;
		variant?: 'row' | 'header';
		/**
		 * Part of the group is on. `role="switch"` has no mixed state, so it stays
		 * aria-checked="false" (a click turns everything on) and says so in the description.
		 */
		mixed?: boolean;
		disabled?: boolean;
	}

	let {
		label,
		checked,
		onchange,
		note,
		variant = 'row',
		mixed = false,
		disabled = false
	}: Props = $props();

	const id = $props.id();
	const describedBy = $derived(
		[note && `${id}-note`, mixed && `${id}-mixed`].filter(Boolean).join(' ') || undefined
	);
</script>

<button
	class="switch"
	class:is-header={variant === 'header'}
	class:is-mixed={mixed && !checked}
	type="button"
	role="switch"
	aria-checked={checked}
	aria-labelledby="{id}-label"
	aria-describedby={describedBy}
	{disabled}
	onclick={() => onchange(!checked)}
>
	<span class="text">
		<span class="label" id="{id}-label">{label}</span>
		{#if note}
			<span class="note" id="{id}-note">{note}</span>
		{/if}
		{#if mixed && !checked}
			<span class="sr-only" id="{id}-mixed">Partly on</span>
		{/if}
	</span>
	<span class="track" aria-hidden="true"><span class="thumb"></span></span>
</button>

<style>
	.switch {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		min-height: var(--h-row);
		padding: 4px 8px;
		border: 0;
		border-radius: var(--r-row);
		background: transparent;
		color: var(--fg-2);
		font: var(--font-ui);
		text-align: left;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.switch[aria-checked='true'] {
		color: var(--fg-1);
	}

	/* Hover only where there is a pointer that hovers; on touch it sticks after a tap. */
	@media (hover: hover) {
		.switch:not(:disabled):hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}

		.switch.is-header:not(:disabled):hover {
			color: var(--fg-2);
		}
	}

	.switch:not(:disabled):active {
		background: var(--fill-press);
	}

	.switch:focus-visible {
		outline: none;
		background: var(--fill-hover);
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.switch:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.switch.is-header {
		min-height: 28px;
		color: var(--fg-3);
		font: var(--font-cap);
	}

	.switch.is-header:focus-visible {
		color: var(--fg-2);
	}

	/* A full row on touch: the master sits right above the first row of its group. */
	@media (pointer: coarse) {
		.switch.is-header {
			min-height: var(--h-row);
		}
	}

	.text {
		display: grid;
		min-width: 0;
	}

	.note {
		color: var(--fg-3);
		font:
			400 12px/14px Inter,
			system-ui,
			sans-serif;
	}

	.track {
		position: relative;
		flex-shrink: 0;
		width: 28px;
		height: 16px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.16);
		transition: background var(--ease-ui);
	}

	.thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--fg-2);
		transition:
			transform var(--ease-ui),
			background var(--ease-ui);
	}

	.switch[aria-checked='true'] .track {
		background: #e8eaed;
	}

	.switch[aria-checked='true'] .thumb {
		background: var(--page);
		transform: translateX(12px);
	}

	/* Mixed: the thumb parks in the middle of a half-lit track. */
	.switch.is-mixed .track {
		background: rgba(255, 255, 255, 0.42);
	}

	.switch.is-mixed .thumb {
		background: var(--fg-1);
		transform: translateX(6px);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.thumb {
			transition: none;
		}
	}
</style>
