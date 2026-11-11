<script lang="ts">
	/**
	 * One page in the pages panel: its thumbnail, which opens the editor on it, and
	 * its number under it, a pill for the selected page. Hovered or focused, the
	 * thumbnail lifts a little and shows a red ⊖ that deletes the page and, across
	 * from it on a page with charts, a button that lays the page out as a template;
	 * on a touch screen, with no hover to show them, they are always there. A ring
	 * around it is lit from the script after Add to PDF.
	 */
	import { chartsOf } from '$lib/document/blocks';
	import { pageSize } from '$lib/document/geometry';
	import { chartCountLabel } from '$lib/document/labels';
	import type { DocPage } from '$lib/document/types';
	import { keepFocusOnMousePress } from '$lib/ui/focus';
	import PageThumbnail from '../PageThumbnail.svelte';
	import type { PageCellActions } from './pages-list.svelte';

	interface Props {
		page: DocPage;
		/** 0-based. */
		index: number;
		/** The page last added to or edited. */
		selected: boolean;
		/** Under a pointer that has not moved since the page appeared there: as if not hovered. */
		quiet: boolean;
		/** The document's pages: a text may read a chart on another of them. */
		pages: readonly DocPage[];
		/** A chart still flying to its page (Add to PDF): its place there stays empty until it lands. */
		pendingItemId: string | null;
		actions: PageCellActions;
	}

	let { page, index, selected, quiet, pages, pendingItemId, actions }: Props = $props();

	/**
	 * Every page is this wide, whichever way it is turned: a landscape page is drawn
	 * at a smaller scale and comes out lower, not wider. At one scale for both it was
	 * 124 px wide, and the panel jumped that much wider (and the chart beside it moved)
	 * the moment a landscape page was added, turned or scrolled to.
	 */
	const THUMB_WIDTH_PX = 88;

	/** Screen px per mm: its width fills the column. */
	const scale = $derived(THUMB_WIDTH_PX / pageSize(page.orientation).w);
	const charts = $derived(chartsOf(page).length);
</script>

<li class="cell" class:selected class:is-quiet={quiet} data-page-id={page.id}>
	<div class="thumb-wrap">
		<button
			class="thumb"
			type="button"
			aria-label="Page {index + 1}, {chartCountLabel(charts)}"
			aria-current={selected ? 'true' : undefined}
			aria-keyshortcuts="Delete"
			onmousedown={keepFocusOnMousePress}
			onclick={() => actions.open(page.id)}
			onkeydown={(event) => actions.keydown(event, page.id)}
		>
			<PageThumbnail {page} {scale} {pendingItemId} {pages} />
		</button>
		<button
			class="remove"
			type="button"
			aria-label="Delete page {index + 1}"
			title="Delete page"
			onclick={() => actions.remove(page.id)}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.75 8h6.5" /></svg>
		</button>
		{#if charts > 0}
			<button
				class="template"
				type="button"
				aria-label="Lay page {index + 1} out as a template"
				aria-haspopup="dialog"
				title="Lay out as a template"
				onclick={(event) => actions.pickTemplate(event, page.id)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3.5 3.5h9v9h-9zM3.5 6.5h9M8 6.5v6" />
				</svg>
			</button>
		{/if}
		<span class="flash" aria-hidden="true"></span>
	</div>
	<span class="number" aria-hidden="true">{index + 1}</span>
</li>

<style>
	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}

	.thumb-wrap {
		position: relative;
		transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.thumb {
		display: block;
		padding: 0;
		border: 0;
		border-radius: 2px;
		background: none;
		cursor: pointer;
	}

	.thumb:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 3px;
		box-shadow:
			0 0 0 3px var(--dock-solid),
			0 0 0 5px rgba(255, 255, 255, 0.6);
	}

	/* Lit after Add to PDF; animated from the script. */
	.flash {
		position: absolute;
		inset: -4px;
		border-radius: 5px;
		box-shadow:
			0 0 0 2px rgba(255, 255, 255, 0.9),
			0 0 18px 2px rgba(255, 255, 255, 0.3);
		opacity: 0;
		pointer-events: none;
	}

	.remove {
		position: absolute;
		top: -8px;
		left: -8px;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--accent);
		color: #ffffff;
		box-shadow:
			0 0 0 2px var(--dock-solid),
			0 1px 4px rgba(0, 0, 0, 0.45);
		cursor: pointer;
		opacity: 0;
		transform: scale(0.6);
		transition:
			opacity var(--ease-ui),
			transform 160ms cubic-bezier(0.16, 1, 0.3, 1),
			background var(--ease-ui);
	}

	/* Across from the ⊖: lay the page out as a template. Shown and hidden with it. */
	.template {
		position: absolute;
		top: -8px;
		right: -8px;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--fg-1);
		color: var(--dock-solid);
		box-shadow:
			0 0 0 2px var(--dock-solid),
			0 1px 4px rgba(0, 0, 0, 0.45);
		cursor: pointer;
		opacity: 0;
		transform: scale(0.6);
		transition:
			opacity var(--ease-ui),
			transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.template::before {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: 50%;
	}

	.template svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}

	/* A 28 px target around the 20 px badge. */
	.remove::before {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: 50%;
	}

	.remove svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	@media (hover: hover) {
		.cell:hover .thumb-wrap {
			transform: scale(1.06);
		}

		.cell:hover .remove,
		.cell:hover .template {
			opacity: 1;
			transform: none;
		}

		/* Under a pointer that has not moved since the page appeared there: as if not hovered. */
		.cell.is-quiet:hover .thumb-wrap {
			transform: none;
		}

		.cell.is-quiet:hover .remove,
		.cell.is-quiet:hover .template {
			opacity: 0;
			transform: scale(0.6);
			pointer-events: none;
		}

		.remove:hover {
			background: var(--accent-hover);
		}
	}

	.cell:focus-within .remove,
	.cell:focus-within .template {
		opacity: 1;
		transform: none;
	}

	/* No hover to reveal it on touch screens: the ⊖ is always there. */
	@media (hover: none) {
		.remove,
		.template {
			opacity: 1;
			transform: none;
		}
	}

	.remove:focus-visible,
	.template:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow:
			0 0 0 2px var(--dock-solid),
			0 0 0 4px rgba(255, 255, 255, 0.7);
	}

	.remove:active {
		background: var(--accent-press);
	}

	/* The number of the selected page (the one last added to or edited) is a pill. */
	.number {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		color: var(--fg-3);
		font:
			500 11px/18px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		text-align: center;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.selected .number {
		background: var(--fill-on);
		color: var(--fg-1);
		font-weight: 600;
	}

	@media (forced-colors: active) {
		/* Forced colours drop the pill's fill: keep the selected page marked. */
		.selected .number {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.thumb-wrap,
		.remove {
			transition: none;
		}
	}
</style>
