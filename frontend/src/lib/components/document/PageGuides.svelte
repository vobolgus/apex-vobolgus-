<script lang="ts">
	/**
	 * Over a page in the editor while a drag goes on: the margins a chart being resized
	 * is held to, and the lines anything snaps to, drawn only with Shift held (and for
	 * a moment after a nudge from the keys). Drawn in the page's mm, stretched over it.
	 */
	import { contentBox } from '$lib/document/geometry';
	import type { PageOrientation } from '$lib/document/types';
	import type { PageDrag } from './editor/drag-view';
	import type { Size } from './editor-geometry';

	interface Props {
		drag: PageDrag;
		orientation: PageOrientation;
		/** The page, mm. */
		size: Size;
	}

	let { drag, orientation, size }: Props = $props();

	const margin = $derived(contentBox(orientation));
</script>

<svg class="guides" viewBox="0 0 {size.w} {size.h}" preserveAspectRatio="none" aria-hidden="true">
	{#if drag.margins}
		<rect
			class="margin"
			x={margin.x}
			y={margin.y}
			width={margin.w}
			height={margin.h}
			vector-effect="non-scaling-stroke"
		/>
	{/if}
	{#each drag.guides as guide, i (i)}
		{#if guide.axis === 'x'}
			<line
				x1={guide.at}
				x2={guide.at}
				y1={guide.from}
				y2={guide.to}
				vector-effect="non-scaling-stroke"
			/>
		{:else}
			<line
				x1={guide.from}
				x2={guide.to}
				y1={guide.at}
				y2={guide.at}
				vector-effect="non-scaling-stroke"
			/>
		{/if}
	{/each}
</svg>

<style>
	.guides {
		position: absolute;
		inset: 0;
		z-index: 5;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	.guides line {
		stroke: var(--guide);
		stroke-width: 1;
	}

	.guides .margin {
		fill: none;
		stroke: var(--paper-margin);
		stroke-width: 1;
		stroke-dasharray: 4 3;
	}

	@media (forced-colors: active) {
		.guides line {
			stroke: Highlight;
		}
	}
</style>
