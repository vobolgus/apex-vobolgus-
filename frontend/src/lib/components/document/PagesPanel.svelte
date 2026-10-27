<script lang="ts">
	/**
	 * The PDF document's pages, floating over the left of the chart area once
	 * there are any: a column of page thumbnails, ⊕ at the bottom to add a page,
	 * and a tab at the top right that slides the column away, leaving a slim tab
	 * with the page count at the window's edge.
	 *
	 * A thumbnail opens the page editor; hovering it lifts it a little and shows a
	 * red ⊖ that deletes the page (with an Undo through `notify`). Keyboard: Tab
	 * reaches every thumbnail and its ⊖, ↑/↓ (Home/End) move between thumbnails,
	 * Delete or Backspace deletes the focused page. Keys handled here stop
	 * propagating, so the window-level sky rotation does not act on them too.
	 */
	import { tick } from 'svelte';
	import type { DocumentStore } from '$lib/document/document.svelte';
	import { A4_WIDTH_MM } from '$lib/document/geometry';
	import PageThumbnail from './PageThumbnail.svelte';

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
	}

	let { store, onopen, notify, onemptied, footprint = $bindable(0) }: Props = $props();

	/** A portrait page is this wide; a landscape one, at the same scale, is wider. */
	const THUMB_WIDTH_PX = 88;
	const SCALE = THUMB_WIDTH_PX / A4_WIDTH_MM;
	/** Kept in step with the CSS below: the panel's inset, the tab's width, the slide. */
	const INSET_PX = 12;
	const TAB_WIDTH_PX = 22;
	const SLIDE_MS = 220;

	const id = $props.id();
	let listEl = $state<HTMLOListElement>();
	let panelWidth = $state(0);

	const count = $derived(store.pages.length);
	const open = $derived(store.panelOpen);

	$effect(() => {
		const next = count === 0 ? 0 : open ? INSET_PX + panelWidth + TAB_WIDTH_PX : TAB_WIDTH_PX;
		// Written only on a change, so the page's layout is not invalidated for nothing.
		if (footprint !== next) footprint = next;
	});

	function chartsLabel(n: number): string {
		if (n === 0) return 'no charts';
		return n === 1 ? '1 chart' : `${n} charts`;
	}

	function thumbButtons(): HTMLButtonElement[] {
		return listEl ? Array.from(listEl.querySelectorAll<HTMLButtonElement>('.thumb')) : [];
	}

	function cellFor(pageId: string): HTMLElement | undefined {
		const cells = listEl?.querySelectorAll<HTMLElement>('[data-page-id]') ?? [];
		return Array.from(cells).find((cell) => cell.dataset.pageId === pageId);
	}

	function reducedMotion(): boolean {
		return (
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	async function deletePage(pageId: string) {
		const index = store.pageIndex(pageId);
		if (index < 0) return;
		const hadFocus = listEl?.contains(document.activeElement) ?? false;
		const undo = store.removePage(pageId);
		notify(`Page ${index + 1} deleted`, undo);
		if (!hadFocus) return;
		// The focused button went with its page: give the focus to the page now in its place.
		await tick();
		const buttons = thumbButtons();
		const next = buttons[Math.min(index, buttons.length - 1)];
		if (next) next.focus();
		else onemptied?.();
	}

	async function addPage() {
		const pageId = store.addPage();
		await reveal(pageId);
	}

	/**
	 * Show a page: open the panel if it was collapsed, scroll its thumbnail into
	 * view and flash it. The page calls this after Add to PDF.
	 */
	export async function reveal(pageId: string): Promise<void> {
		const opening = !store.panelOpen;
		store.panelOpen = true;
		await tick();
		const cell = cellFor(pageId);
		if (!cell) return;
		const reduce = reducedMotion();
		cell.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
		// After the slide-in, so the flash is seen.
		const delay = opening && !reduce ? SLIDE_MS : 0;
		const ring = cell.querySelector<HTMLElement>('.flash');
		ring?.animate?.(
			[{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
			{ duration: 1100, delay, easing: 'ease-out' }
		);
		if (reduce) return;
		cell
			.querySelector<HTMLElement>('.thumb-wrap')
			?.animate?.(
				[
					{ transform: 'scale(1)' },
					{ transform: 'scale(1.08)', offset: 0.35 },
					{ transform: 'scale(1)' }
				],
				{ duration: 560, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
			);
	}

	function handleThumbKeydown(event: KeyboardEvent, pageId: string) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const buttons = thumbButtons();
		const current = buttons.indexOf(event.currentTarget as HTMLButtonElement);
		let next: number;
		switch (event.key) {
			case 'ArrowDown':
				next = Math.min(current + 1, buttons.length - 1);
				break;
			case 'ArrowUp':
				next = Math.max(current - 1, 0);
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = buttons.length - 1;
				break;
			case 'Delete':
			case 'Backspace':
				event.preventDefault();
				event.stopPropagation();
				void deletePage(pageId);
				return;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
		buttons[next]?.focus();
		buttons[next]?.scrollIntoView?.({ block: 'nearest' });
	}
</script>

{#if count > 0}
	<div class="dock" class:collapsed={!open}>
		<aside
			bind:offsetWidth={panelWidth}
			class="panel"
			id="{id}-panel"
			aria-label="PDF pages"
			inert={!open}
		>
			<ol bind:this={listEl} class="list">
				{#each store.pages as page, index (page.id)}
					{@const selected = store.selectedPageId === page.id}
					<li class="cell" class:selected data-page-id={page.id}>
						<div class="thumb-wrap">
							<button
								class="thumb"
								type="button"
								aria-label="Page {index + 1}, {chartsLabel(page.items.length)}"
								aria-current={selected ? 'true' : undefined}
								aria-keyshortcuts="Delete"
								onclick={() => onopen(page.id)}
								onkeydown={(event) => handleThumbKeydown(event, page.id)}
							>
								<PageThumbnail {page} scale={SCALE} />
							</button>
							<button
								class="remove"
								type="button"
								aria-label="Delete page {index + 1}"
								title="Delete page"
								onclick={() => void deletePage(page.id)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.75 8h6.5" /></svg>
							</button>
							<span class="flash" aria-hidden="true"></span>
						</div>
						<span class="number" aria-hidden="true">{index + 1}</span>
					</li>
				{/each}
			</ol>
			<div class="foot">
				<button class="add" type="button" aria-label="Add page" title="Add page" onclick={addPage}>
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
	</div>
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
	 * The scrollbar sits on the left, as sketched (rtl puts it there; each cell
	 * turns back to ltr). The padding leaves room for the hover lift and the ⊖,
	 * which would otherwise be clipped by the scroller.
	 */
	.list {
		display: flex;
		flex: 0 1 auto;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		min-height: 0;
		margin: 0;
		padding: 14px 14px 12px;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		/* A thumbnail scrolled into view keeps the padding above and below it. */
		scroll-padding: 14px 0 12px;
		/* Pages scrolled past the edge fade out instead of being cut. */
		mask-image: linear-gradient(transparent, #000 8px, #000 calc(100% - 8px), transparent);
		list-style: none;
		direction: rtl;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
	}

	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		direction: ltr;
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

		.cell:hover .remove {
			opacity: 1;
			transform: none;
		}

		.remove:hover {
			background: var(--accent-hover);
		}
	}

	.cell:focus-within .remove {
		opacity: 1;
		transform: none;
	}

	/* No hover to reveal it on touch screens: the ⊖ is always there. */
	@media (hover: none) {
		.remove {
			opacity: 1;
			transform: none;
		}
	}

	.remove:focus-visible {
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
		.chevron,
		.thumb-wrap,
		.remove {
			transition: none;
		}

		.dock.collapsed .panel {
			transition: none;
		}
	}
</style>
