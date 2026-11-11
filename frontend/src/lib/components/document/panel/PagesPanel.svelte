<script lang="ts">
	/**
	 * The PDF document's pages, floating over the left of the chart area once
	 * there are any: a column of pages (`PageCell`), ⊕ at the bottom to add a page,
	 * and a tab at the top right that slides the column away, leaving a slim tab
	 * with the page count at the window's edge.
	 *
	 * A page opens the editor; its ⊖ deletes it (with an Undo through `notify`), and
	 * on a page with charts a button across from it lays the page out as a template
	 * (`TemplatePicker`). What goes on in the list, from the keys to the motion of a
	 * page coming and going, is its controller's (`PagesList`).
	 */
	import { untrack } from 'svelte';
	import { MAX_PAGES, type DocumentStore } from '$lib/document/document.svelte';
	import type { Box, Landing, LandingTarget } from '$lib/document/flight';
	import type { LaidPage, TemplateInfo } from '$lib/document/templates';
	import type { TemplatePick } from '../editor/page-operations.svelte';
	import TemplatePicker from '../TemplatePicker.svelte';
	import { slideIn } from './list-motion';
	import PageCell from './PageCell.svelte';
	import { PagesList, type PageCellActions } from './pages-list.svelte';

	interface Props {
		store: DocumentStore;
		/** A thumbnail was clicked: open the editor on that page. */
		onopen: (pageId: string) => void;
		/** Show a toast, with an Undo when `undo` is given. */
		notify: (message: string, undo?: () => void) => void;
		/** The last page was deleted from the keyboard: the panel is gone, so the focus needs a home. */
		onemptied?: () => void;
		/** Out: how far the panel reaches into the chart area from its left edge, px (0 with no pages). */
		footprint?: number;
		/** A chart still flying to its page (Add to PDF): its place there stays empty until it lands. */
		pendingItemId?: string | null;
		/** The page has settled after its load: a panel that appears from here on slides in. */
		animated?: boolean;
	}

	let {
		store,
		onopen,
		notify,
		onemptied,
		footprint = $bindable(0),
		pendingItemId = null,
		animated = false
	}: Props = $props();

	/** Kept in step with the CSS below: the panel's inset, the tab's width. */
	const INSET_PX = 12;
	const TAB_WIDTH_PX = 22;

	const id = $props.id();
	let panelWidth = $state(0);

	const count = $derived(store.pages.length);
	const open = $derived(store.panelOpen);

	const list = new PagesList({
		get store() {
			return store;
		},
		notify: (message, undo) => notify(message, undo),
		emptied: () => onemptied?.()
	});

	/** The page being laid out as a template, and where its picker stands. */
	let picking = $state<TemplatePick | null>(null);
	const pickedPage = $derived(picking ? store.page(picking.pageId) : undefined);

	const cell: PageCellActions = {
		open: (pageId) => onopen(pageId),
		keydown: list.keydown,
		remove: list.remove,
		pickTemplate
	};

	/** Open the template picker for a page, beside the panel at the height of its thumbnail. */
	function pickTemplate(event: MouseEvent, pageId: string) {
		const thumb = (event.currentTarget as HTMLElement).closest('.thumb-wrap');
		const dock = (event.currentTarget as HTMLElement).closest('.dock');
		if (!thumb || !dock) return;
		const { top, bottom, left } = thumb.getBoundingClientRect();
		picking = { pageId, anchor: { left, top, bottom, right: dock.getBoundingClientRect().right } };
	}

	function applyTemplate(pageId: string, template: TemplateInfo, laid: LaidPage[]) {
		const number = store.pageIndex(pageId) + 1;
		const undo = store.layPage(pageId, laid);
		if (!undo) return;
		store.selectedPageId = pageId;
		const pages = laid.length > 1 ? `, on ${laid.length} pages` : '';
		notify(`Page ${number} laid out as “${template.name}”${pages}`, () => {
			if (undo()) list.announcement = `Page ${number} as it was`;
		});
	}

	$effect(() => {
		const next = count === 0 ? 0 : open ? INSET_PX + panelWidth + TAB_WIDTH_PX : TAB_WIDTH_PX;
		// Written only on a change, so the page's layout is not invalidated for nothing.
		if (footprint !== next) footprint = next;
	});

	/** Show a page after Add to PDF, and say where the chart flying there lands (`PagesList.reveal`). */
	export function reveal(pageId: string, landing?: Landing): Promise<LandingTarget | null> {
		return list.reveal(pageId, landing);
	}

	/** Where every chart is on the thumbnails just now, by item id (`PagesList.chartBoxes`). */
	export function chartBoxes(): Record<string, Box> {
		return list.chartBoxes();
	}

	/**
	 * The panel's own entrance, when the first page brings it into being: it slides
	 * out from the left edge with that page already on it. Only once the page has
	 * settled (`animated`), so a document restored on load is simply there. Read
	 * untracked: the attachment must not run again when `animated` turns true.
	 */
	function entrance(dock: HTMLElement) {
		if (untrack(() => animated)) slideIn(dock);
	}
</script>

{#if count > 0}
	<div class="dock" class:collapsed={!open} {@attach entrance}>
		<aside
			bind:offsetWidth={panelWidth}
			class="panel"
			id="{id}-panel"
			aria-label="PDF pages"
			inert={!open}
		>
			<ol bind:this={list.element} class="list" {@attach list.edgeFades}>
				{#each store.pages as page, index (page.id)}
					<PageCell
						{page}
						{index}
						selected={store.selectedPageId === page.id}
						quiet={page.id === list.quietPageId}
						pages={store.pages}
						{pendingItemId}
						actions={cell}
					/>
				{/each}
			</ol>
			<div class="foot">
				<button
					class="add"
					type="button"
					aria-label="Add page"
					title={store.canAddPage ? 'Add page' : `A PDF document has at most ${MAX_PAGES} pages`}
					disabled={!store.canAddPage}
					onclick={list.add}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="6.25" />
						<path d="M8 5.25v5.5M5.25 8h5.5" />
					</svg>
				</button>
			</div>
		</aside>
		<button
			class="tab"
			type="button"
			aria-label="PDF pages, {count}"
			aria-expanded={open}
			aria-controls="{id}-panel"
			title={open ? 'Hide pages' : 'Show pages'}
			onclick={() => (store.panelOpen = !open)}
		>
			<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M9.75 4.5 6.25 8l3.5 3.5" />
			</svg>
			{#if !open}
				<span class="count" aria-hidden="true">{count}</span>
			{/if}
		</button>
		<p class="sr-only" role="status">{list.announcement}</p>
	</div>
{/if}

{#if picking && pickedPage}
	{@const pageId = picking.pageId}
	<TemplatePicker
		page={pickedPage}
		number={store.pageIndex(pageId) + 1}
		room={MAX_PAGES - store.pageCount}
		anchor={picking.anchor}
		onapply={(template, laid) => applyTemplate(pageId, template, laid)}
		onclose={() => (picking = null)}
	/>
{/if}

<style>
	/*
	 * The column between the chart area's top and bottom insets; it lets pointer
	 * events through to the chart wherever the panel is shorter than it.
	 */
	.dock {
		position: absolute;
		top: 12px;
		bottom: 12px;
		left: 12px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		pointer-events: none;
		transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
	}

	/* Slid out past the left edge: only the tab is left, against the window's edge. */
	.dock.collapsed {
		transform: translateX(calc(-100% - 12px));
	}

	.panel {
		display: flex;
		flex-direction: column;
		max-height: 100%;
		min-height: 0;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-dock);
		background: var(--dock-solid);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		pointer-events: auto;
		transition: visibility 0s;
	}

	/* Hidden once the slide is over, which also takes it out of the tab order. */
	.dock.collapsed .panel {
		visibility: hidden;
		transition: visibility 0s linear 220ms;
	}

	/*
	 * The list scrolls with no scrollbar of its own: the system's bar, a grey strip
	 * down the side of a panel this small, was the one thing in it not drawn here.
	 * What says "there is more" is the fade at the edge the pages run under, and
	 * only at that edge (`--fade-top`, `--fade-bottom`, set by the script from the
	 * scroll position): at rest at the top there is nothing above to fade, and a
	 * fade there dimmed the top page's ⊖. The wheel, a swipe and the arrow keys
	 * between thumbnails all still scroll.
	 *
	 * The padding leaves room for the hover lift and the ⊖, which would otherwise be
	 * clipped by the scroller. It must hold all of both, the ⊖'s 28 px target scaled
	 * with the lifted thumbnail included (15.4 px to the thumbnail's left): anything
	 * past the padding grows the list's scrollable width on hover. Above the first
	 * page it is deeper still: the ⊖ rides 8 px above its thumbnail and the lift
	 * takes it 4 px higher, and with 14 px it sat hard under the panel's edge.
	 */
	.list {
		display: flex;
		flex: 0 1 auto;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		min-height: 0;
		margin: 0;
		padding: 22px 18px 12px;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		/* A thumbnail scrolled into view keeps the padding above and below it. */
		scroll-padding: 22px 0 12px;
		/* Pages scrolled past an edge fade out there instead of being cut. */
		mask-image: linear-gradient(
			transparent,
			#000 var(--fade-top, 0px),
			#000 calc(100% - var(--fade-bottom, 0px)),
			transparent
		);
		list-style: none;
		scrollbar-width: none;
	}

	.list::-webkit-scrollbar {
		display: none;
	}

	.foot {
		flex-shrink: 0;
		padding: 6px;
		border-top: 1px solid var(--hairline);
	}

	.add,
	.tab {
		border: 0;
		background: transparent;
		color: var(--fg-2);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.add {
		display: grid;
		place-items: center;
		width: 100%;
		height: var(--h-ctl);
		padding: 0;
		border-radius: var(--r-ctl);
	}

	.add svg,
	.chevron {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/*
	 * Joined to the panel's right edge: the same fill, no left border, one px over
	 * the panel's border so the two read as one shape.
	 */
	.tab {
		position: absolute;
		top: 12px;
		left: calc(100% - 1px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		width: 22px;
		min-height: 40px;
		padding: 8px 0;
		border: 1px solid var(--hairline-strong);
		border-left: 0;
		border-radius: 0 var(--r-ctl) var(--r-ctl) 0;
		background: var(--dock-solid);
		box-shadow: 6px 6px 14px -6px rgba(0, 0, 0, 0.6);
		pointer-events: auto;
	}

	.chevron {
		transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
	}

	.collapsed .chevron {
		transform: rotate(180deg);
	}

	.count {
		color: var(--fg-1);
		font:
			600 11px/14px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
	}

	@media (hover: hover) {
		.add:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}

		.tab:hover {
			color: var(--fg-1);
		}
	}

	.add:focus-visible,
	.tab:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.add:active {
		background: var(--fill-press);
	}

	.add:disabled {
		color: var(--fg-icon-off);
		background: transparent;
		cursor: default;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.tab:active {
		color: var(--fg-1);
	}

	@media (forced-colors: active) {
		.panel,
		.tab {
			border-color: CanvasText;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dock,
		.chevron {
			transition: none;
		}

		.dock.collapsed .panel {
			transition: none;
		}
	}
</style>
