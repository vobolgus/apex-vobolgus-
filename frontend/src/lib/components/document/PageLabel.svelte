<script lang="ts">
	/**
	 * Above a page in the editor: its name, and what is done to it as a whole. The page
	 * shown lays itself out as a template (with charts to lay out) and takes text and
	 * tables; an empty page is deleted from here, and any page turns.
	 */
	import type { DocPage } from '$lib/document/types';
	import { ICONS } from './blocks/icons';
	import type { EditorActions } from './editor/actions';
	import EditorOrientation from './EditorOrientation.svelte';

	interface Props {
		page: DocPage;
		/** 1-based. */
		number: number;
		/** It is the page shown. */
		current: boolean;
		/** Narrow layout: the neighbours peek in at the stage's edges, and their labels would be cut off. */
		narrow: boolean;
		/** It has charts on it. */
		charted: boolean;
		/** Nothing is on it. */
		blank: boolean;
		actions: EditorActions;
	}

	let { page, number, current, narrow, charted, blank, actions }: Props = $props();
</script>

<div class="label" class:is-hidden={narrow && !current}>
	<span class="name" class:is-current={current}>Page {number} <span class="format">· A4</span></span
	>
	<div class="actions">
		{#if current && charted}
			<button
				class="action"
				type="button"
				aria-label="Lay page {number} out as a template"
				aria-haspopup="dialog"
				title="Lay out as a template"
				onclick={(event) => actions.pages.pickTemplate(page.id, event.currentTarget)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3.5 3.5h9v9h-9zM3.5 6.5h9M8 6.5v6" />
				</svg>
			</button>
		{/if}
		{#if current}
			<button
				class="action"
				type="button"
				aria-label="Add text to page {number}"
				title="Add text"
				onclick={() => actions.blocks.addText(page.id)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3.5 5V3.5h9V5M8 3.5v9M6.25 12.5h3.5" />
				</svg>
			</button>
			<button
				class="action"
				type="button"
				aria-label="Add a table to page {number}"
				title="Add a table"
				onclick={() => actions.blocks.addTable(page.id)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M2.5 4h11M2.5 8h11M2.5 12h11M6.5 4v8" />
				</svg>
			</button>
		{/if}
		<!-- Only an empty page: one with charts is deleted from the pages panel, where they show. -->
		{#if blank}
			<button
				class="action"
				type="button"
				aria-label="Delete page {number}"
				aria-keyshortcuts={current ? 'Delete' : undefined}
				title="Delete this empty page"
				onclick={() => actions.pages.remove(page.id)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d={ICONS.bin} />
				</svg>
			</button>
		{/if}
		<EditorOrientation
			label="Page {number} orientation"
			value={page.orientation}
			onselect={(orientation) => actions.pages.setOrientation(page.id, orientation)}
		/>
	</div>
</div>

<style>
	.label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		box-sizing: border-box;
		height: var(--label-h);
		padding-bottom: 8px;
	}

	.actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: 6px;
	}

	.action {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-3);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.action:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.action:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.action:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.action svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.name {
		min-width: 0;
		overflow: hidden;
		color: var(--fg-2);
		font: var(--font-ui);
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name.is-current {
		color: var(--fg-1);
	}

	.format {
		color: var(--fg-3);
	}

	.label.is-hidden {
		visibility: hidden;
	}
</style>
