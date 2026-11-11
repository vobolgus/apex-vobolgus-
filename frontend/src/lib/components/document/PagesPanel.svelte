<script lang="ts">
	/**
	 * The PDF document's pages, floating over the left of the chart area once
	 * there are any: a column of page thumbnails, ⊕ at the bottom to add a page,
	 * and a tab at the top right that slides the column away, leaving a slim tab
	 * with the page count at the window's edge.
	 *
	 * A thumbnail opens the page editor; hovering it lifts it a little and shows a
	 * red ⊖ that deletes the page (with an Undo through `notify`) and, across from it
	 * on a page with charts, a button that lays the page out as a template
	 * (`TemplatePicker`). Keyboard: Tab
	 * reaches every thumbnail and its ⊖, ↑/↓ (Home/End) move between thumbnails,
	 * Delete or Backspace deletes the focused page. Keys handled here stop
	 * propagating, so the window-level sky rotation does not act on them too.
	 */
	import { tick, untrack } from 'svelte';
	import { MAX_PAGES, type DocumentStore } from '$lib/document/document.svelte';
	import {
		PDF_FLIGHT_EASING,
		settleKeyframes,
		type Box,
		type Landing,
		type LandingTarget
	} from '$lib/document/flight';
	import { pageSize } from '$lib/document/geometry';
	import { chartCountLabel } from '$lib/document/labels';
	import type { LaidPage, TemplateInfo } from '$lib/document/templates';
	import { chartsOf } from '$lib/document/blocks';
	import type { DocPage } from '$lib/document/types';
	import { keepFocusOnMousePress } from '$lib/ui/focus';
	import PageThumbnail from './PageThumbnail.svelte';
	import TemplatePicker from './TemplatePicker.svelte';

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

	/**
	 * Every page is this wide, whichever way it is turned: a landscape page is drawn
	 * at a smaller scale and comes out lower, not wider. At one scale for both it was
	 * 124 px wide, and the panel jumped that much wider (and the chart beside it moved)
	 * the moment a landscape page was added, turned or scrolled to.
	 */
	const THUMB_WIDTH_PX = 88;

	/** Screen px per mm for a page: its width fills the column. */
	function scaleFor(page: DocPage): number {
		return THUMB_WIDTH_PX / pageSize(page.orientation).w;
	}
	/** Kept in step with the CSS below: the panel's inset, the tab's width, the slide. */
	const INSET_PX = 12;
	const TAB_WIDTH_PX = 22;
	const SLIDE_MS = 220;
	/** A pointer has moved once it is this far from where a page appeared under it, px. */
	const QUIET_MOVE_PX = 4;
	/** The deepest the list fades at an edge that pages run under, px. */
	const EDGE_FADE_PX = 20;
	/** The list's gap between pages, px, as in the CSS. */
	const LIST_GAP_PX = 12;
	/** A new page's entrance, and the panel's own when the first page brings it. */
	const GROW_MS = 260;
	const ENTRANCE_MS = 300;

	const id = $props.id();
	let listEl = $state<HTMLOListElement>();
	let panelWidth = $state(0);
	/** Polite live region: a page added from ⊕ has no other cue but the flash. */
	let announcement = $state('');

	const count = $derived(store.pages.length);
	const open = $derived(store.panelOpen);

	/** The page being laid out as a template, and where its picker stands. */
	let picking = $state<{
		pageId: string;
		anchor: { left: number; top: number; right: number; bottom: number };
	} | null>(null);
	const pickedPage = $derived(picking ? store.page(picking.pageId) : undefined);

	/** Open the template picker for a page, beside the panel at the height of its thumbnail. */
	function pickTemplate(event: MouseEvent, pageId: string) {
		const cell = (event.currentTarget as HTMLElement).closest('.thumb-wrap');
		const dock = (event.currentTarget as HTMLElement).closest('.dock');
		if (!cell || !dock) return;
		const { top, bottom, left } = cell.getBoundingClientRect();
		picking = { pageId, anchor: { left, top, bottom, right: dock.getBoundingClientRect().right } };
	}

	function applyTemplate(pageId: string, template: TemplateInfo, laid: LaidPage[]) {
		const number = store.pageIndex(pageId) + 1;
		const undo = store.layPage(pageId, laid);
		if (!undo) return;
		store.selectedPageId = pageId;
		const pages = laid.length > 1 ? `, on ${laid.length} pages` : '';
		notify(`Page ${number} laid out as “${template.name}”${pages}`, () => {
			if (undo()) announcement = `Page ${number} as it was`;
		});
	}

	$effect(() => {
		const next = count === 0 ? 0 : open ? INSET_PX + panelWidth + TAB_WIDTH_PX : TAB_WIDTH_PX;
		// Written only on a change, so the page's layout is not invalidated for nothing.
		if (footprint !== next) footprint = next;
	});

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

	/** Pages on their way out: a second ⊖ on one of them, mid-exit, is ignored. */
	const leaving: string[] = [];

	/**
	 * Delete a page. Where it can be shown, the page first closes up (`shrinkOut`), so
	 * the panel shortens instead of jumping; then it goes, with an Undo that brings it
	 * back the way new pages arrive.
	 */
	function deletePage(pageId: string) {
		const index = store.pageIndex(pageId);
		if (index < 0 || leaving.includes(pageId)) return;
		const hadFocus = listEl?.contains(document.activeElement) ?? false;
		const cell = cellFor(pageId);
		const exit = cell ? shrinkOut(cell) : null;
		if (!exit) {
			void removePage(pageId, index, hadFocus);
			return;
		}
		leaving.push(pageId);
		void exit.then(() => {
			leaving.splice(leaving.indexOf(pageId), 1);
			return removePage(pageId, index, hadFocus);
		});
	}

	async function removePage(pageId: string, index: number, hadFocus: boolean) {
		const undo = store.removePage(pageId);
		notify(`Page ${index + 1} deleted`, () => {
			if (!undo()) return;
			void focusRestored(pageId);
			void tick().then(() => {
				const restored = cellFor(pageId);
				if (restored && !reducedMotion()) growIn(restored);
			});
		});
		if (!hadFocus) return;
		// The focused button went with its page: give the focus to the page now in its place.
		await tick();
		const buttons = thumbButtons();
		const next = buttons[Math.min(index, buttons.length - 1)];
		if (next) next.focus();
		else onemptied?.();
	}

	/**
	 * After an undo, the restored page's thumbnail takes the focus when the focus
	 * was in the panel or went with the toast's Undo button; elsewhere it stays.
	 */
	async function focusRestored(pageId: string) {
		const before = document.activeElement;
		await tick();
		const lost = !before?.isConnected || document.activeElement === document.body;
		if (!lost && !listEl?.contains(before)) return;
		store.panelOpen = true;
		await tick();
		cellFor(pageId)?.querySelector<HTMLElement>('.thumb')?.focus();
	}

	/**
	 * A page that came to lie under a pointer which did not move: the one ⊕ just
	 * added, where ⊕ itself was a moment ago. Until the pointer does move it is not
	 * treated as hovered: no lift, no ⊖. Otherwise a click on ⊕ answers with a page
	 * that grows in, lifts and sprouts a delete button all at once, none of which the
	 * hand asked for.
	 */
	let quietPageId = $state<string | null>(null);

	/** Hold a page quiet until the pointer has moved a few px from where it is now. */
	function quietUntilPointerMoves(pageId: string, at: { x: number; y: number } | null) {
		quietPageId = pageId;
		let from = at;
		const onMove = (event: PointerEvent) => {
			from ??= { x: event.clientX, y: event.clientY };
			// A layout change alone can fire a move with the pointer where it was: not that.
			if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < QUIET_MOVE_PX) return;
			window.removeEventListener('pointermove', onMove);
			if (quietPageId === pageId) quietPageId = null;
		};
		window.addEventListener('pointermove', onMove);
	}

	/**
	 * ⊕: a page is added at the end and grows into the list, and that is all. The
	 * flash and the bump that `reveal` gives a page are for Add to PDF, when the eye
	 * is on the chart and has to be led to the panel; here it is already on the spot.
	 */
	async function addPage(event?: MouseEvent) {
		if (!store.canAddPage) return;
		const pageId = store.addPage();
		announce(`Page ${store.pageIndex(pageId) + 1} added`);
		// A click from the keyboard has no place of its own (detail 0): wait for the first move.
		quietUntilPointerMoves(
			pageId,
			event && event.detail > 0 ? { x: event.clientX, y: event.clientY } : null
		);
		await tick();
		const cell = cellFor(pageId);
		if (!cell) return;
		const reduce = reducedMotion();
		cell.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
		if (!reduce) growIn(cell);
	}

	function announce(message: string) {
		// Cleared first, so the same words twice are read twice.
		announcement = '';
		void tick().then(() => (announcement = message));
	}

	/**
	 * Fade the list at an edge only as far as pages run under it: by how much there
	 * is to scroll that way, up to `EDGE_FADE_PX`. So the fade grows in as the list
	 * starts to scroll instead of appearing, and is gone at either end.
	 */
	function updateEdgeFades(list: HTMLElement) {
		const above = list.scrollTop;
		const below = list.scrollHeight - list.clientHeight - list.scrollTop;
		list.style.setProperty('--fade-top', `${Math.max(0, Math.min(EDGE_FADE_PX, above))}px`);
		list.style.setProperty('--fade-bottom', `${Math.max(0, Math.min(EDGE_FADE_PX, below))}px`);
	}

	/**
	 * Keep the fades right as the list scrolls and as it, or what it holds, changes
	 * size. Reading `count` has this run again when a page is added or removed, so
	 * the new page is watched as well.
	 */
	function edgeFades(list: HTMLElement) {
		void count;
		const update = () => updateEdgeFades(list);
		update();
		list.addEventListener('scroll', update, { passive: true });
		// The list's own box (the window got shorter) and every page in it (one was turned,
		// or is growing in). jsdom has no ResizeObserver, and nothing to scroll either.
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
		observer?.observe(list);
		for (const cell of list.children) observer?.observe(cell);
		return () => {
			list.removeEventListener('scroll', update);
			observer?.disconnect();
		};
	}

	/** How far the panel is slid out of place just now, px (negative: to the left). */
	function slideOffset(inside: HTMLElement): number {
		const dock = inside.closest<HTMLElement>('.dock');
		if (!dock || typeof DOMMatrixReadOnly !== 'function') return 0;
		return new DOMMatrixReadOnly(getComputedStyle(dock).transform).m41;
	}

	/**
	 * Where a chart sits on its page's thumbnail once the panel is at rest, and how
	 * its corners are rounded there: the place the copy flying in on Add to PDF comes
	 * to a stop. Measured with the panel's slide taken out, so a panel still on its
	 * way in gives the place it is heading for.
	 */
	function chartTarget(cell: HTMLElement, itemId: string): LandingTarget | null {
		const chart = Array.from(cell.querySelectorAll<HTMLElement>('.chart')).find(
			(element) => element.dataset.itemId === itemId
		);
		if (!chart) return null;
		const rect = chart.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		return {
			box: new DOMRect(rect.x - slideOffset(chart), rect.y, rect.width, rect.height),
			corner: getComputedStyle(chart).borderTopLeftRadius
		};
	}

	/**
	 * Where every chart is on the thumbnails just now, by item id. The page takes
	 * this before an Add and hands it back in the `landing`, so the charts the Add
	 * moves can be played from where they were.
	 */
	export function chartBoxes(): Record<string, Box> {
		const boxes: Record<string, Box> = {};
		for (const chart of listEl?.querySelectorAll<HTMLElement>('.chart') ?? []) {
			const id = chart.dataset.itemId;
			if (id) boxes[id] = chart.getBoundingClientRect();
		}
		return boxes;
	}

	/**
	 * The charts already on a page make room for the one flying in: each that the
	 * Add moved is played from its old place to its new one, over the flight and on
	 * its curve, so they part as the copy arrives between them.
	 */
	function makeRoom(cell: HTMLElement, landing: Landing) {
		if (!landing.before) return;
		for (const chart of cell.querySelectorAll<HTMLElement>('.chart')) {
			const id = chart.dataset.itemId;
			const before = id && id !== landing.itemId ? landing.before[id] : undefined;
			if (!before || typeof chart.animate !== 'function') continue;
			const frames = settleKeyframes(before, chart.getBoundingClientRect());
			if (frames) chart.animate(frames, { duration: landing.ms, easing: PDF_FLIGHT_EASING });
		}
	}

	/**
	 * The margin a cell's height animation takes the list's gap back through: the one
	 * towards its neighbour. Null for a page alone in the list, which has no gap, and
	 * whose coming and going is the panel's own slide.
	 */
	function gapMargin(cell: HTMLElement): 'marginTop' | 'marginBottom' | null {
		if (cell.previousElementSibling) return 'marginTop';
		return cell.nextElementSibling ? 'marginBottom' : null;
	}

	/**
	 * A page that was just added (or brought back by Undo) makes its entrance: its
	 * cell grows from nothing, so the panel lengthens instead of jumping. In a list
	 * that already scrolls, where a growing cell would fight the scroll position, it
	 * fades and scales in instead.
	 */
	function growIn(cell: HTMLElement) {
		const margin = gapMargin(cell);
		if (!margin || typeof cell.animate !== 'function') return;
		const options = { duration: GROW_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
		const scrolls = listEl ? listEl.scrollHeight > listEl.clientHeight + 1 : false;
		if (scrolls) {
			cell.animate(
				[
					{ opacity: 0, transform: 'scale(0.9)' },
					{ opacity: 1, transform: 'none' }
				],
				options
			);
			return;
		}
		const height = cell.getBoundingClientRect().height;
		// The negative margin takes the list's gap back, so the panel starts from the height it had.
		cell.style.overflow = 'clip';
		const grow = cell.animate(
			[
				{ height: '0px', [margin]: `-${LIST_GAP_PX}px`, opacity: 0 },
				{ height: `${height}px`, [margin]: '0px', opacity: 1 }
			],
			options
		);
		const done = () => (cell.style.overflow = '');
		grow.onfinish = done;
		grow.oncancel = done;
	}

	/**
	 * A page being deleted makes its exit, the entrance run backwards: its cell closes
	 * up to nothing and the panel shortens with it. The last page takes the panel
	 * along, which slides away to the left as it came. Resolves when the page may be
	 * removed; null when there is nothing to show (less motion asked for, or no
	 * animations here) and it may go at once.
	 */
	function shrinkOut(cell: HTMLElement): Promise<unknown> | null {
		if (reducedMotion() || typeof cell.animate !== 'function') return null;
		const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
		const margin = gapMargin(cell);
		let exit: Animation;
		if (!margin) {
			const dock = cell.closest<HTMLElement>('.dock');
			if (!dock) return null;
			exit = dock.animate(
				[{ transform: 'none' }, { transform: 'translateX(calc(-100% - 12px))' }],
				{
					duration: ENTRANCE_MS,
					easing,
					fill: 'forwards'
				}
			);
		} else {
			const height = cell.getBoundingClientRect().height;
			cell.style.overflow = 'clip';
			// Nothing on a page that is going takes a click.
			cell.style.pointerEvents = 'none';
			exit = cell.animate(
				[
					{ height: `${height}px`, [margin]: '0px', opacity: 1 },
					{ height: '0px', [margin]: `-${LIST_GAP_PX}px`, opacity: 0 }
				],
				{ duration: GROW_MS, easing, fill: 'forwards' }
			);
		}
		// Cancelled (the panel went away under it) is as good as finished.
		return exit.finished.catch(() => undefined);
	}

	/**
	 * Show a page: open the panel if it was collapsed, scroll its thumbnail into
	 * view and flash it. The page calls this after Add to PDF.
	 *
	 * With a `landing` a copy of the chart is about to fly here. The thumbnail is
	 * then brought into view at once (the copy needs a target that stays put), a new
	 * page makes its entrance, and the flash waits for the copy to land. Returns
	 * where the copy lands, measured before anything here starts to move; null when
	 * there is no such chart to land on.
	 */
	export async function reveal(pageId: string, landing?: Landing): Promise<LandingTarget | null> {
		const opening = !store.panelOpen;
		store.panelOpen = true;
		await tick();
		const cell = cellFor(pageId);
		if (!cell) return null;
		const reduce = reducedMotion();
		cell.scrollIntoView?.({ block: 'nearest', behavior: reduce || landing ? 'auto' : 'smooth' });
		const target = landing ? chartTarget(cell, landing.itemId) : null;
		if (landing && !reduce) {
			// The first page arrives with the panel, which slides in with it (`growIn` leaves it be).
			if (landing.newPage) growIn(cell);
			else makeRoom(cell, landing);
		}
		// After the slide-in and the landing, so the flash is seen.
		const delay = reduce ? 0 : Math.max(opening ? SLIDE_MS : 0, landing?.ms ?? 0);
		const ring = cell.querySelector<HTMLElement>('.flash');
		ring?.animate?.(
			[{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
			{ duration: 1100, delay, easing: 'ease-out' }
		);
		if (reduce) return target;
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
		return target;
	}

	/**
	 * The panel's own entrance, when the first page brings it into being: it slides
	 * out from the left edge with that page already on it. Only once the page has
	 * settled (`animated`), so a document restored on load is simply there. Read
	 * untracked: the attachment must not run again when `animated` turns true.
	 */
	function slideIn(node: HTMLElement) {
		if (!untrack(() => animated) || reducedMotion() || typeof node.animate !== 'function') return;
		node.animate([{ transform: 'translateX(calc(-100% - 12px))' }, { transform: 'none' }], {
			duration: ENTRANCE_MS,
			easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
		});
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
	<div class="dock" class:collapsed={!open} {@attach slideIn}>
		<aside
			bind:offsetWidth={panelWidth}
			class="panel"
			id="{id}-panel"
			aria-label="PDF pages"
			inert={!open}
		>
			<ol bind:this={listEl} class="list" {@attach edgeFades}>
				{#each store.pages as page, index (page.id)}
					{@const selected = store.selectedPageId === page.id}
					<li
						class="cell"
						class:selected
						class:is-quiet={page.id === quietPageId}
						data-page-id={page.id}
					>
						<div class="thumb-wrap">
							<button
								class="thumb"
								type="button"
								aria-label="Page {index + 1}, {chartCountLabel(chartsOf(page).length)}"
								aria-current={selected ? 'true' : undefined}
								aria-keyshortcuts="Delete"
								onmousedown={keepFocusOnMousePress}
								onclick={() => onopen(page.id)}
								onkeydown={(event) => handleThumbKeydown(event, page.id)}
							>
								<PageThumbnail {page} scale={scaleFor(page)} {pendingItemId} pages={store.pages} />
							</button>
							<button
								class="remove"
								type="button"
								aria-label="Delete page {index + 1}"
								title="Delete page"
								onclick={() => deletePage(page.id)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.75 8h6.5" /></svg>
							</button>
							{#if chartsOf(page).length > 0}
								<button
									class="template"
									type="button"
									aria-label="Lay page {index + 1} out as a template"
									aria-haspopup="dialog"
									title="Lay out as a template"
									onclick={(event) => pickTemplate(event, page.id)}
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
				{/each}
			</ol>
			<div class="foot">
				<button
					class="add"
					type="button"
					aria-label="Add page"
					title={store.canAddPage ? 'Add page' : `A PDF document has at most ${MAX_PAGES} pages`}
					disabled={!store.canAddPage}
					onclick={addPage}
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
		<p class="sr-only" role="status">{announcement}</p>
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

		/* Forced colours drop the pill's fill: keep the selected page marked. */
		.selected .number {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
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
