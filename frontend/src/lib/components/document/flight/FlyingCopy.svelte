<script lang="ts">
	/**
	 * The chart's copy in the air after Add to PDF (`PdfFlight`). It is the chart as a
	 * page thumbnail shows it (paper, the brighter stars, a hairline edge), laid out by
	 * the flight on its place on that thumbnail and played there from over the
	 * preview; above the page and its panels, under the toast. It takes no pointer.
	 */
	import type { PdfFlight } from './pdf-flight.svelte';

	let { flight }: { flight: PdfFlight } = $props();
</script>

{#if flight.copy}
	{#key flight.copy.id}
		<div
			class="pdf-flight"
			aria-hidden="true"
			style:--corner={flight.copy.corner}
			use:flight.fly={flight.copy}
		>
			<canvas></canvas>
			<span class="pdf-flight-edge"></span>
		</div>
	{/key}
{/if}

<style>
	.pdf-flight {
		position: fixed;
		z-index: 900;
		overflow: hidden;
		border-radius: var(--corner);
		background: var(--paper);
		transform-origin: center;
		pointer-events: none;
		will-change: transform, opacity;
	}

	/* Drawn to fit, as the preview's canvas is. */
	.pdf-flight canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.pdf-flight-edge {
		position: absolute;
		inset: 0;
		border-radius: var(--corner);
	}
</style>
