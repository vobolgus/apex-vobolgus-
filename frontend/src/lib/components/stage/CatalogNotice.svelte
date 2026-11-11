<script lang="ts">
	/**
	 * The catalogue's notice, top centre of the chart area over the chart: that it is
	 * loading, when that is slow, and what did not arrive, with a button to try again.
	 * It stays until the catalogue has loaded.
	 */
	import type { CatalogLoad } from './catalog-load.svelte';

	let { load }: { load: CatalogLoad } = $props();
</script>

<!-- Always in the tree, so the live region is there before its text changes. -->
<div class="catalog-notice-host" role="status">
	{#if load.loading && load.slow}
		<p class="catalog-notice">Loading the star catalogue…</p>
	{:else if !load.loading && load.failed.length > 0}
		<p class="catalog-notice">
			<span class="catalog-notice-text">{load.failure}</span>
			<span class="catalog-notice-divider" aria-hidden="true"></span>
			<button class="catalog-notice-action" type="button" onclick={load.retry}> Try again </button>
		</p>
	{/if}
</div>

<style>
	/* Styled as the toast is. */
	.catalog-notice-host {
		position: absolute;
		inset: 12px 12px auto;
		z-index: 2;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}

	.catalog-notice {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: min(440px, 100%);
		min-height: 40px;
		margin: 0;
		padding: 4px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-pop);
		background: var(--pop);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
		color: var(--fg-1);
		font: var(--font-ui);
		pointer-events: auto;
		animation: catalog-notice-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	/* The toast's entrance, from the other side: this one hangs from the top. */
	@keyframes catalog-notice-in {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
	}

	.catalog-notice:has(.catalog-notice-action) {
		padding-right: 4px;
	}

	.catalog-notice-text {
		min-width: 0;
		padding: 4px 0;
	}

	.catalog-notice-divider {
		flex-shrink: 0;
		width: 1px;
		height: 16px;
		margin: 0 4px 0 8px;
		background: var(--hairline);
	}

	.catalog-notice-action {
		flex-shrink: 0;
		height: var(--h-row);
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-row);
		background: transparent;
		color: var(--fg-1);
		font: var(--font-ui);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	@media (hover: hover) {
		.catalog-notice-action:hover {
			background: var(--fill-hover);
		}
	}

	.catalog-notice-action:active {
		background: var(--fill-press);
	}

	.catalog-notice-action:focus-visible {
		outline: none;
		box-shadow: var(--ring);
	}

	/* The notice is simply there. */
	@media (prefers-reduced-motion: reduce) {
		.catalog-notice {
			animation: none;
		}
	}
</style>
