<script lang="ts">
	/**
	 * The dock under the chart: the projection's switch and the Layers button, which
	 * shows and hides the layers panel where the screen has room for one, and opens
	 * its popover where it has not.
	 */
	import type { LayerState } from '$lib/state/layers.svelte';
	import type { ProjectionMode } from '$lib/state/projection-transition.svelte';
	import type { Dropdown } from '$lib/ui/dropdown.svelte';
	import type { LayersDock } from './layers-dock.svelte';
	import LayersPopover from './LayersPopover.svelte';
	import { PROJECTION_SEGMENTS } from './options';
	import SegmentedControl from './SegmentedControl.svelte';

	interface Props {
		/** The projection the chart shows, or is heading to. */
		projection: ProjectionMode;
		onprojection: (mode: ProjectionMode) => void;
		layers: LayerState;
		/** The Layers popover, in the page's `DropdownGroup`. */
		layersMenu: Dropdown;
		/** The layers panel beside the chart, and whether the screen has room for it. */
		dock: LayersDock;
		docked: boolean;
	}

	let { projection, onprojection, layers, layersMenu, dock, docked }: Props = $props();
</script>

<div class="control-bar-shell">
	<div class="control-bar" role="group" aria-label="Generator display controls">
		<div class="control-group">
			<SegmentedControl
				label="Projection"
				options={PROJECTION_SEGMENTS}
				value={projection}
				onselect={onprojection}
				shortcut="Shift+P"
			/>
		</div>
		<span class="control-divider" aria-hidden="true"></span>
		<div class="control-group">
			<LayersPopover
				{layers}
				menu={layersMenu}
				{docked}
				panelOpen={dock.open}
				panelId={dock.id}
				onpanel={dock.set}
			/>
		</div>
	</div>
</div>

<style>
	.control-bar-shell {
		display: flex;
		justify-content: center;
		padding: 0 16px 16px;
		pointer-events: none;
		z-index: var(--z-dock);
	}

	/*
	 * Floating dock, still its own grid row so it never covers the chart. No
	 * backdrop-filter: the row has only the flat page behind it, and a filter here
	 * would make the dock the backdrop root of the Layers popover and kill its blur.
	 */
	.control-bar {
		position: relative;
		display: flex;
		align-items: center;
		height: var(--h-dock);
		padding: var(--pad-dock);
		border-radius: var(--r-dock);
		background: var(--dock);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		pointer-events: auto;
	}

	/* 1 px gradient border, cut out of a padded layer with a mask. */
	.control-bar::before {
		content: '';
		position: absolute;
		inset: 0;
		padding: 1px;
		border-radius: inherit;
		background: linear-gradient(
			20deg,
			rgba(255, 255, 255, 0.1),
			rgba(255, 255, 255, 0.25) 20%,
			rgba(255, 255, 255, 0.1)
		);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask-composite: exclude;
		pointer-events: none;
	}

	.control-group {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.control-divider {
		flex-shrink: 0;
		width: 1px;
		height: 20px;
		margin: 0 6px;
		background: var(--hairline);
	}

	/* Phones only: the compact dock with labels still fits up to the 743 px breakpoint. */
	@media (max-width: 480px) {
		.control-bar {
			width: 100%;
			justify-content: center;
		}
	}
</style>
