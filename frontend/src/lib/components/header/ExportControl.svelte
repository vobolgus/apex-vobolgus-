<script lang="ts">
	/**
	 * The export button: ray.so's tinted primary, split into the main action, which
	 * saves the chart in the format chosen, and a toggle for the format menu
	 * (`ExportMenu`). The main half shows what the export is doing: its icon, a
	 * turning ring while a file is drawn, a check once it is saved.
	 */
	import type { ExportController } from './export.svelte';
	import ExportMenu from './ExportMenu.svelte';

	interface Props {
		exporter: ExportController;
		/** ⌘ on Apple platforms, Ctrl elsewhere, for the shortcuts. */
		apple: boolean;
	}

	let { exporter, apple }: Props = $props();
</script>

<div class="export-wrap" bind:this={exporter.menu.element}>
	<button
		class="export-main"
		type="button"
		aria-busy={exporter.phase === 'busy'}
		onclick={() => exporter.run(exporter.format)}
	>
		{#if exporter.phase === 'busy'}
			<svg class="export-icon export-spinner" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />
			</svg>
		{:else if exporter.phase === 'done'}
			<svg class="export-icon export-done" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M3.5 8.5l3 3 6-7" pathLength="1" />
			</svg>
		{:else}
			<svg class="export-icon" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M8 2.5v7M5 6.5l3 3 3-3M3 12.5h10" />
			</svg>
		{/if}
		<span><span class="export-verb">Export</span> {exporter.format}</span>
	</button>
	<button
		bind:this={exporter.menu.trigger}
		class="export-toggle"
		type="button"
		aria-label="Choose export format"
		aria-haspopup="menu"
		aria-expanded={exporter.menu.open}
		aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
		onclick={() => exporter.menu.toggle()}
	>
		<svg class="export-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M5 6.5l3 3 3-3" />
		</svg>
	</button>
	{#if exporter.menu.open}
		<ExportMenu {exporter} {apple} />
	{/if}
</div>

<style>
	/*
	 * The wash and edge sit on the wrap; each half lays its own hover or press
	 * overlay over them, rounding its outer corners so the fill stays inside. No
	 * overflow clipping: the format menu hangs below.
	 */
	.export-wrap {
		position: relative;
		display: inline-flex;
		align-items: stretch;
		height: 30px;
		border-radius: var(--r-ctl);
		background: var(--accent-wash);
		box-shadow: inset 0 0 0 1px var(--accent-edge);
		color: var(--accent-fg);
	}

	.export-main,
	.export-toggle {
		display: inline-flex;
		align-items: center;
		border: 0;
		background-color: transparent;
		color: inherit;
		font: var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.export-main {
		gap: 7px;
		padding: 0 12px 0 10px;
		border-radius: var(--r-ctl) 0 0 var(--r-ctl);
	}

	/* The divider stops 1 px short of each end, so it meets the wrap's edge instead of doubling it. */
	.export-toggle {
		width: 28px;
		justify-content: center;
		border-radius: 0 var(--r-ctl) var(--r-ctl) 0;
		background-image: linear-gradient(var(--accent-edge), var(--accent-edge));
		background-position: left center;
		background-repeat: no-repeat;
		background-size: 1px calc(100% - 2px);
	}

	@media (hover: hover) {
		.export-main:hover,
		.export-toggle:hover {
			background-color: var(--accent-wash-hover);
		}
	}

	.export-main:focus-visible,
	.export-toggle:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background-color: var(--accent-wash-hover);
		box-shadow: var(--ring);
	}

	.export-main:active,
	.export-toggle:active,
	.export-toggle[aria-expanded='true'] {
		background-color: var(--accent-wash-press);
	}

	/* Forced colors drop the wash and the inset edge: keep the button's outline. */
	@media (forced-colors: active) {
		.export-wrap {
			outline: 1px solid ButtonText;
		}
	}

	.export-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* A file is being drawn: three quarters of a ring, turning. */
	.export-spinner {
		animation: export-spin 700ms linear infinite;
	}

	@keyframes export-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Saved: the check draws itself, start to end. */
	.export-done path {
		stroke-dasharray: 1;
		animation: export-check 240ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes export-check {
		from {
			stroke-dashoffset: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		/* The ring still says "working" standing still; the check is simply there. */
		.export-spinner,
		.export-done path {
			animation: none;
		}
	}

	.export-toggle .export-icon {
		width: 14px;
		height: 14px;
		transition: transform 160ms ease;
	}

	.export-toggle[aria-expanded='true'] .export-icon {
		transform: rotate(180deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.export-toggle .export-icon {
			transition: none;
		}
	}

	@media (max-width: 743px) {
		.export-main {
			gap: 6px;
			padding: 0 10px 0 9px;
		}

		/* "⤓ PNG ▾": the format alone, "Export" kept for screen readers. */
		.export-verb {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
