<script lang="ts">
	/**
	 * The layers as a panel on the right of the chart area, where a screen has the
	 * room. It stays open while the sky is turned and the chart keeps clear of it
	 * (the page reserves `LAYERS_PANEL_FOOTPRINT_PX`), so a switch shows its effect
	 * on a chart that nothing covers; the popover it replaces opened over a quarter
	 * of the disc. The dock's Layers button shows and hides it. On a phone there is
	 * no room beside the chart and the dock's popover does the job.
	 *
	 * Keyboard: ↑/↓ (Home/End) move between the rows and are kept from the sky's
	 * controls; Escape with the focus in the panel hides it, and the page gives the
	 * focus back to the Layers button.
	 *
	 * It is always in the tree while there is room for it, and fades in with a
	 * short slide from the right when `open`. Closed, it is `visibility: hidden`:
	 * out of the tab order and the accessibility tree.
	 */
	import type { LayerState } from '$lib/state/layers.svelte';
	import { keepFocusOnMousePress } from '$lib/ui/focus';
	import LayerSwitches from './LayerSwitches.svelte';
	import { LAYERS_PANEL_INSET_PX, LAYERS_PANEL_WIDTH_PX } from './options';
	import { stepSwitchFocus, switchRows } from './switch-keys';

	interface Props {
		layers: LayerState;
		/** Shown, or slid away past the right edge. */
		open: boolean;
		/**
		 * Slide on a change of `open`. Off until the page has settled, so a panel
		 * remembered as open is simply there on a load instead of arriving.
		 */
		animated?: boolean;
		/** The panel's id, which the Layers button names in `aria-controls`. */
		id: string;
		/** Hide the panel: its close button, or Escape. */
		onclose: () => void;
	}

	let { layers, open, animated = true, id, onclose }: Props = $props();

	let panelEl = $state<HTMLElement>();

	/** Put the focus on the first switch, for a panel opened from the keyboard. */
	export function focusFirst() {
		switchRows(panelEl ?? null)[0]?.focus();
	}

	/** Whether the focus is inside the panel (the page then returns it to the trigger on close). */
	export function hasFocus(): boolean {
		return panelEl?.contains(document.activeElement) ?? false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (stepSwitchFocus(event, panelEl ?? null)) return;
		if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			onclose();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (keys pressed on the rows inside bubble here) -->
<aside
	bind:this={panelEl}
	class="panel"
	class:open
	class:animated
	{id}
	aria-labelledby="{id}-title"
	style:--inset="{LAYERS_PANEL_INSET_PX}px"
	style:--width="{LAYERS_PANEL_WIDTH_PX}px"
	onkeydown={handleKeydown}
>
	<div class="head">
		<h2 class="title" id="{id}-title">Layers</h2>
		<button
			class="close"
			type="button"
			aria-label="Hide layers"
			onmousedown={keepFocusOnMousePress}
			onclick={onclose}
		>
			<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
		</button>
	</div>
	<LayerSwitches {layers} />
</aside>

<style>
	/*
	 * Top right of the chart area, no taller than it: a list that does not fit
	 * scrolls inside the panel. Styled as the pages panel on the other side is.
	 */
	.panel {
		position: absolute;
		top: var(--inset);
		right: var(--inset);
		z-index: 5;
		width: var(--width);
		max-height: calc(100% - 2 * var(--inset));
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 6px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-dock);
		background: var(--dock-solid);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		/* Closed: a little to the right, clear, and gone for the keyboard and for assistive tech. */
		transform: translateX(20px);
		opacity: 0;
		visibility: hidden;
	}

	.panel.open {
		transform: none;
		opacity: 1;
		visibility: visible;
	}

	/*
	 * A fade over a 20 px slide. The whole width from past the edge, on a curve
	 * that spends itself at the start, was 40 px a frame: steps, not a slide. This
	 * is three at most. Hiding waits for it to end; showing does not wait.
	 */
	.panel.animated {
		transition:
			transform 240ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 240ms cubic-bezier(0.4, 0, 0.2, 1),
			visibility 0s linear 240ms;
	}

	.panel.animated.open {
		transition-delay: 0s;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0 2px 8px;
	}

	.title {
		margin: 0;
		color: var(--fg-1);
		font: var(--font-ui);
	}

	.close {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--r-row);
		background: transparent;
		color: var(--fg-2);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.close svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	@media (hover: hover) {
		.close:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.close:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.close:focus-visible {
		outline: none;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	@media (prefers-reduced-motion: reduce) {
		.panel.animated {
			transition: none;
		}
	}

	@media (forced-colors: active) {
		.panel {
			border-color: CanvasText;
		}
	}
</style>
