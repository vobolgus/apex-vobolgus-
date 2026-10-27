<script lang="ts" generics="T extends string">
	/**
	 * Segmented control for a choice between a few options (a radio group).
	 *
	 * One tab stop (roving tabindex on the selected option); ←/→ (and ↑/↓, as
	 * screen readers send them in a radio group) move the selection and the focus
	 * together. Options share one width so the thumb can slide with a plain
	 * `translateX`.
	 */
	import type { SegmentOption } from './options';

	interface Props {
		/** Accessible name of the group, e.g. "Projection". */
		label: string;
		options: readonly SegmentOption<T>[];
		value: T;
		onselect: (value: T) => void;
		/** Global shortcut that switches the options, shown in every tooltip. */
		shortcut?: string;
		disabled?: boolean;
	}

	let { label, options, value, onselect, shortcut, disabled = false }: Props = $props();

	const selectedIndex = $derived(options.findIndex((option) => option.value === value));
	/** Option that holds the single tab stop: the selected one, or the first. */
	const tabIndexOwner = $derived(Math.max(0, selectedIndex));

	let groupEl: HTMLDivElement | null = $state(null);

	function radios(): HTMLElement[] {
		return groupEl ? Array.from(groupEl.querySelectorAll<HTMLElement>('[role="radio"]')) : [];
	}

	function select(next: T) {
		if (next !== value) onselect(next);
	}

	function handleKeydown(event: KeyboardEvent, index: number) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		let step: number;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') step = 1;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') step = -1;
		else return;
		// The window-level InputController rotates the sky on arrows; this key is ours.
		event.preventDefault();
		event.stopPropagation();
		// A held key would flip the projection back and forth on every repeat.
		if (event.repeat) return;
		// Step from the selection, not from the focus: they differ for a moment
		// when Shift+P switches the projection while an option has focus.
		const from = selectedIndex >= 0 ? selectedIndex : index;
		const next = (from + step + options.length) % options.length;
		radios()[next]?.focus();
		select(options[next].value);
	}

	// When the value changes from outside (Shift+P) while an option has focus,
	// move the focus with it, so the focused option is always the tab stop.
	$effect(() => {
		const owner = tabIndexOwner;
		const items = radios();
		if (items.includes(document.activeElement as HTMLElement)) items[owner]?.focus();
	});
</script>

<div
	bind:this={groupEl}
	class="segment"
	role="radiogroup"
	aria-label={label}
	aria-keyshortcuts={shortcut}
	aria-disabled={disabled || undefined}
	style:--count={options.length}
	style:--index={selectedIndex}
>
	<span class="thumb" class:is-hidden={selectedIndex < 0} aria-hidden="true"></span>
	{#each options as option, index (option.value)}
		<button
			class="option"
			type="button"
			role="radio"
			aria-checked={index === selectedIndex}
			aria-label={option.name}
			title={shortcut ? `${option.name} · ${shortcut}` : option.name}
			tabindex={index === tabIndexOwner ? 0 : -1}
			{disabled}
			onclick={() => select(option.value)}
			onkeydown={(event) => handleKeydown(event, index)}
		>
			<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
				<path d={option.iconPath} />
			</svg>
			<span class="label">{option.label}</span>
		</button>
	{/each}
</div>

<style>
	.segment {
		position: relative;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		height: var(--h-ctl);
	}

	.thumb {
		position: absolute;
		top: 0;
		left: 0;
		width: calc(100% / var(--count));
		height: 100%;
		border-radius: var(--r-ctl);
		background: var(--fill-on);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
		transform: translateX(calc(var(--index) * 100%));
		transition: transform 160ms ease;
		pointer-events: none;
	}

	.thumb.is-hidden {
		visibility: hidden;
	}

	.option {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: var(--h-ctl);
		padding: 0 10px 0 8px;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-3);
		font: var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.option[aria-checked='true'] {
		color: var(--fg-1);
		cursor: default;
	}

	@media (hover: hover) {
		.option:not([aria-checked='true']):not(:disabled):hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.option:not([aria-checked='true']):not(:disabled):active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.option:focus-visible {
		outline: none;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.option:not([aria-checked='true']):focus-visible {
		background: var(--fill-hover);
	}

	.option:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
	}

	@media (prefers-reduced-motion: reduce) {
		.thumb {
			transition: none;
		}
	}

	@media (max-width: 480px) {
		/* Icons only; the accessible name stays on aria-label. */
		.label {
			display: none;
		}

		.option {
			padding: 0 10px;
		}
	}
</style>
