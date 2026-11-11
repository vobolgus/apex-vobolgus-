<script lang="ts">
	/**
	 * The export button's menu: the chart's formats, each with what it is for and its
	 * shortcut, the one the button saves checked; then the whole PDF document, off
	 * while the document is empty or on its way. The dock's popover look: one family
	 * of menus across the page.
	 */
	import { ariaKeys, keyLabel } from '$lib/shortcuts';
	import { EXPORT_OPTIONS, type ExportController } from './export.svelte';

	interface Props {
		exporter: ExportController;
		/** ⌘ on Apple platforms, Ctrl elsewhere, for the shortcuts. */
		apple: boolean;
	}

	let { exporter, apple }: Props = $props();
</script>

<div
	bind:this={exporter.menuElement}
	class="export-menu"
	role="menu"
	aria-label="Export format"
	tabindex="-1"
	onkeydown={exporter.menuKeydown}
>
	<div class="export-group" role="group" aria-label="Chart">
		{#each EXPORT_OPTIONS as option (option.format)}
			{@const checked = option.format === exporter.format}
			<button
				class="export-option"
				type="button"
				role="menuitemradio"
				aria-checked={checked}
				aria-labelledby="export-{option.format}-name"
				aria-describedby="export-{option.format}-note"
				aria-keyshortcuts={option.keys.length ? ariaKeys(option.keys, apple) : undefined}
				onclick={() => exporter.choose(option.format)}
			>
				<svg class="export-option-icon" viewBox="0 0 16 16" aria-hidden="true">
					{#if option.format === 'PNG'}
						<rect x="2.5" y="3" width="11" height="10" rx="1.5" />
						<path d="M2.5 10.5l3-3 3 3 2-2 3 3" />
					{:else if option.format === 'SVG'}
						<path d="M3 13l4-10 2 6 4-2" />
						<circle cx="3" cy="13" r="1" />
						<circle cx="13" cy="7" r="1" />
					{:else}
						<path d="M4 2.5h5.5l3 3v8h-8.5z" />
						<path d="M9.5 2.5v3h3" />
					{/if}
				</svg>
				<span class="export-option-text">
					<span class="export-option-name" id="export-{option.format}-name">
						{option.format}
					</span>
					<span class="export-option-note" id="export-{option.format}-note">
						{option.note}
					</span>
				</span>
				<span class="export-option-keys" aria-hidden="true">
					{#each option.keys as key (key)}
						<kbd>{keyLabel(key, apple)}</kbd>
					{/each}
				</span>
				<svg class="export-option-check" viewBox="0 0 16 16" aria-hidden="true">
					{#if checked}<path d="M3.5 8.5l3 3 6-7" />{/if}
				</svg>
			</button>
		{/each}
	</div>
	<div class="export-separator" role="separator"></div>
	<button
		class="export-option"
		type="button"
		role="menuitem"
		disabled={exporter.documentEmpty || exporter.documentExporting}
		aria-labelledby="export-document-name"
		aria-describedby="export-document-note"
		onclick={exporter.runDocument}
	>
		<svg class="export-option-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M5.5 2.5h5l3 3v7.5h-8z" />
			<path d="M10.5 2.5v3h3M2.5 5v8.5a1 1 0 0 0 1 1H10" />
		</svg>
		<span class="export-option-text">
			<span class="export-option-name" id="export-document-name">PDF document</span>
			<span class="export-option-note" id="export-document-note">{exporter.documentNote}</span>
		</span>
		<span class="export-option-keys" aria-hidden="true"></span>
		<span class="export-option-check" aria-hidden="true"></span>
	</button>
</div>

<style>
	.export-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 20;
		display: grid;
		gap: 2px;
		width: min(280px, calc(100vw - 20px));
		padding: 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-pop);
		background: var(--pop);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
	}

	.export-menu:focus {
		outline: none;
	}

	.export-group {
		display: grid;
		gap: 2px;
	}

	.export-separator {
		height: 1px;
		margin: 3px 2px;
		background: var(--hairline);
	}

	.export-option {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) auto 16px;
		align-items: center;
		column-gap: 10px;
		min-height: 44px;
		padding: 6px 8px;
		border: 0;
		border-radius: var(--r-row);
		background: transparent;
		color: var(--fg-2);
		text-align: left;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.export-option:not(:disabled):hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	/*
	 * Any focus fills the row: ⌘K moves focus here from a shortcut, which Chrome
	 * does not count as :focus-visible, and the row must still show where it is.
	 */
	.export-option:focus {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background: var(--fill-hover);
		color: var(--fg-1);
	}

	.export-option:focus-visible {
		box-shadow: var(--ring);
	}

	.export-option:active {
		background: var(--fill-press);
	}

	/* The document row with nothing in the document: dimmed, no hover, skipped by the arrows. */
	.export-option:disabled {
		background: transparent;
		color: var(--fg-2);
		cursor: default;
	}

	.export-option:disabled .export-option-icon,
	.export-option:disabled .export-option-name {
		opacity: 0.5;
	}

	.export-option[aria-checked='true'] {
		color: var(--fg-1);
	}

	.export-option-icon,
	.export-option-check {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.export-option-text {
		display: grid;
		gap: 1px;
		min-width: 0;
	}

	/* One line each, whatever the fallback font: the rows keep one height. */
	.export-option-name,
	.export-option-note {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.export-option-name {
		color: var(--fg-1);
		font: var(--font-ui);
	}

	.export-option-note {
		color: var(--fg-3);
		font:
			400 12px/14px Inter,
			system-ui,
			sans-serif;
	}

	/* A lit row over the white chart takes --fg-3 under 4.5:1; --fg-2 keeps it readable. */
	.export-option:not(:disabled):is(:hover, :focus, :active) .export-option-note {
		color: var(--fg-2);
	}

	.export-option-keys {
		display: inline-flex;
		gap: 3px;
	}

	.export-option-keys kbd {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 4px;
		background: var(--fill-on);
		color: var(--fg-2);
		font:
			500 11px/1 Inter,
			system-ui,
			sans-serif;
	}
</style>
