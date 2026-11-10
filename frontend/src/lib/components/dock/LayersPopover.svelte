<script lang="ts">
	/**
	 * Dock trigger "Layers N". Where there is room beside the chart (`docked`) it
	 * shows and hides the page's layers panel (`LayersPanel.svelte`), which the
	 * chart keeps clear of. Otherwise, on a phone, it opens an upward popover of
	 * the same grouped switches.
	 *
	 * Keyboard: Enter, Space, ↑ or ↓ on the trigger open the list and focus the
	 * first row. In the popover ↑/↓ (Home/End) move between rows, Space toggles,
	 * Escape closes and returns focus to the trigger, Tab out of it closes it.
	 * Every key handled here stops propagation, so the window-level sky rotation
	 * does not act on it as well.
	 */
	import { tick } from 'svelte';
	import type { LayerState } from '$lib/state/layers.svelte';
	import { Dropdown } from '$lib/ui/dropdown.svelte';
	import { keepFocusOnMousePress } from '$lib/ui/focus';
	import { prefersReducedMotion } from '$lib/ui/motion';
	import LayerSwitches from './LayerSwitches.svelte';
	import { stepSwitchFocus, switchRows } from './switch-keys';

	interface Props {
		layers: LayerState;
		/** Open state. Pass the page's instance so its `DropdownGroup` can dismiss it. */
		menu?: Dropdown;
		/** The layers live in the page's side panel; the trigger only shows and hides it. */
		docked?: boolean;
		/** With `docked`: whether the side panel is open, and its id. */
		panelOpen?: boolean;
		panelId?: string;
		/**
		 * With `docked`: show or hide the side panel. `focus` asks for the focus to go
		 * to its first row, when it was opened from the keyboard.
		 */
		onpanel?: (open: boolean, focus: boolean) => void;
	}

	let {
		layers,
		menu = new Dropdown(),
		docked = false,
		panelOpen = false,
		panelId: sidePanelId,
		onpanel
	}: Props = $props();

	/** Keep the popover this far from the viewport edges. */
	const VIEWPORT_MARGIN_PX = 8;

	const id = $props.id();
	const panelId = `${id}-panel`;

	let panelEl: HTMLDivElement | null = $state(null);
	/** Horizontal offset that keeps the trigger-aligned popover inside the viewport. */
	let shiftPx = $state(0);

	const count = $derived(layers.enabledCount);

	let badgeEl = $state<HTMLElement>();
	/** The count the badge last showed; null before the first one, which arrives without a bump. */
	let shownCount: number | null = null;

	// A layer turned on or off: the count gives a small bump, so the eye finds what changed.
	$effect(() => {
		const next = count;
		const changed = shownCount !== null && next !== shownCount;
		shownCount = next;
		if (!changed || !badgeEl || prefersReducedMotion()) return;
		// Not in every engine (jsdom has none): the number changes all the same.
		if (typeof badgeEl.animate !== 'function') return;
		badgeEl.animate(
			[
				{ transform: 'scale(1)' },
				{ transform: 'scale(1.28)', offset: 0.35 },
				{ transform: 'scale(1)' }
			],
			{ duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
		);
	});

	const expanded = $derived(docked ? panelOpen : menu.open);
	const controls = $derived(
		docked ? (panelOpen ? sidePanelId : undefined) : menu.open ? panelId : undefined
	);

	// A popover left open as the window grows wide would come back open on a phone.
	$effect(() => {
		if (docked) menu.close();
	});

	async function openAndFocusFirst() {
		if (docked) {
			onpanel?.(true, true);
			return;
		}
		menu.show();
		await tick();
		switchRows(panelEl)[0]?.focus();
	}

	function handleTriggerClick(event: MouseEvent) {
		if (docked) {
			// detail 0: activated from the keyboard (Enter/Space), so focus moves in.
			onpanel?.(!panelOpen, event.detail === 0);
			return;
		}
		if (menu.open) menu.close();
		// detail 0: activated from the keyboard (Enter/Space), so focus moves in.
		else if (event.detail === 0) void openAndFocusFirst();
		else menu.show();
	}

	function handleTriggerKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			event.stopPropagation();
			void openAndFocusFirst();
		} else if (event.key === 'Escape' && menu.open) {
			event.preventDefault();
			event.stopPropagation();
			menu.dismiss();
		}
	}

	/**
	 * True from a Tab keydown in the popover until the task ends, i.e. while the
	 * browser moves the focus for it. Tells "Tabbed out of the page" from a
	 * click that only blurs, as both lose focus without a `relatedTarget`.
	 */
	let tabbing = false;

	function handlePanelKeydown(event: KeyboardEvent) {
		if (event.key === 'Tab') {
			tabbing = true;
			setTimeout(() => (tabbing = false));
			return;
		}
		if (stepSwitchFocus(event, panelEl)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			menu.dismiss();
		}
	}

	/**
	 * Tabbing out of the popover closes it, also past the last element of the
	 * page, where focus leaves the document. Clicks are left to the dropdown group.
	 */
	function handleFocusOut(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (next ? !menu.element?.contains(next) : tabbing) menu.close();
		tabbing = false;
	}

	$effect(() => {
		if (!menu.open || !panelEl) return;
		const panel = panelEl;
		const place = () => {
			const anchorLeft = menu.element?.getBoundingClientRect().left ?? 0;
			const maxLeft = window.innerWidth - VIEWPORT_MARGIN_PX - panel.offsetWidth;
			shiftPx = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchorLeft, maxLeft)) - anchorLeft;
		};
		place();
		window.addEventListener('resize', place);
		return () => window.removeEventListener('resize', place);
	});
</script>

<div class="layers" bind:this={menu.element} onfocusout={handleFocusOut}>
	<button
		bind:this={menu.trigger}
		class="trigger"
		type="button"
		aria-haspopup={docked ? undefined : 'dialog'}
		aria-expanded={expanded}
		aria-controls={controls}
		aria-label="Layers, {count} on"
		onmousedown={keepFocusOnMousePress}
		onclick={handleTriggerClick}
		onkeydown={handleTriggerKeydown}
	>
		<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" />
			<path d="M8 2.75v10.5" />
		</svg>
		<span>Layers</span>
		<span bind:this={badgeEl} class="badge" class:is-zero={count === 0} aria-hidden="true"
			>{count}</span
		>
		<svg class="chevron" viewBox="0 0 12 12" aria-hidden="true">
			<path d="M3 7.5 6 4.5l3 3" />
		</svg>
	</button>
	{#if menu.open && !docked}
		<div
			bind:this={panelEl}
			class="panel"
			id={panelId}
			role="dialog"
			aria-labelledby="{id}-title"
			tabindex="-1"
			style:--shift="{shiftPx}px"
			onkeydown={handlePanelKeydown}
		>
			<div class="title" id="{id}-title">Layers</div>
			<LayerSwitches {layers} />
		</div>
	{/if}
</div>

<style>
	.layers {
		position: relative;
	}

	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: var(--h-ctl);
		padding: 0 8px;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-2);
		font: var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.trigger:not(:disabled):hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	/* As specific as the hover rule and after it: pressed and open hold under the pointer. */
	.trigger:not(:disabled):active,
	.trigger:not(:disabled)[aria-expanded='true'] {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.trigger:focus-visible {
		outline: none;
		background: var(--fill-hover);
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.trigger:disabled {
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

	.badge {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--fill-on);
		color: var(--fg-1);
		font:
			600 11px/18px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	/* --fg-2, not --fg-3: on the --fill-on pill --fg-3 drops below 4.5:1. */
	.badge.is-zero {
		color: var(--fg-2);
	}

	.chevron {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
		margin-left: -2px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.5;
		transition: transform 160ms ease;
	}

	.trigger[aria-expanded='true'] .chevron {
		transform: rotate(180deg);
	}

	.panel {
		position: absolute;
		left: var(--shift, 0px);
		/* 8 px above the dock: the trigger sits --pad-dock inside it. */
		bottom: calc(100% + var(--pad-dock) + 8px);
		z-index: 20;
		width: min(280px, calc(100vw - 16px));
		max-height: calc(100dvh - 56px - 44px - 48px);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-pop);
		background: var(--pop);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
	}

	.panel:focus {
		outline: none;
	}

	.title {
		padding: 6px 8px 4px;
		color: var(--fg-1);
		font: var(--font-ui);
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}

	@media (max-width: 480px) {
		/* Full width above the dock: the dock (the positioned ancestor) becomes the anchor. */
		.layers {
			position: static;
		}

		.panel {
			left: 0;
			right: 0;
			bottom: calc(100% + 8px);
			width: auto;
		}
	}
</style>
