<script lang="ts">
	/**
	 * The editor's strip of mini pages: every page of the document at a glance,
	 * the current one lit, a click to jump to any of them and ⊕ to add one.
	 *
	 * Scrolls sideways when the pages do not fit, also under a plain mouse wheel,
	 * and keeps the current page in view.
	 */
	import { pageSize } from '$lib/document/geometry';
	import type { DocPage } from '$lib/document/types';

	interface Props {
		pages: readonly DocPage[];
		currentId: string;
		onselect: (pageId: string) => void;
		onadd: () => void;
	}

	let { pages, currentId, onselect, onadd }: Props = $props();

	/** Height of a portrait mini page, px; a landscape one is this wide. */
	const MINI_PX = 40;

	let scrollerEl = $state<HTMLDivElement>();

	function chartWord(count: number): string {
		return count === 1 ? '1 chart' : `${count} charts`;
	}

	function miniSize(page: DocPage) {
		const { w, h } = pageSize(page.orientation);
		const k = MINI_PX / Math.max(w, h);
		return { w: w * k, h: h * k, mmW: w, mmH: h };
	}

	// Keep the current page in view as it changes (arrow keys, the side pages).
	$effect(() => {
		void currentId;
		void pages.length;
		const el = scrollerEl?.querySelector<HTMLElement>('[aria-current="page"]');
		const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
		el?.scrollIntoView?.({
			block: 'nearest',
			inline: 'nearest',
			behavior: reduce ? 'auto' : 'smooth'
		});
	});

	// A plain mouse wheel scrolls the strip sideways; a trackpad's own sideways swipe passes.
	$effect(() => {
		const el = scrollerEl;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
			if (el.scrollWidth <= el.clientWidth) return;
			event.preventDefault();
			el.scrollLeft += event.deltaY;
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});
</script>

<nav class="strip" aria-label="All pages" data-strip>
	<div class="scroller" bind:this={scrollerEl}>
		<ol class="track">
			{#each pages as page, index (page.id)}
				{@const mini = miniSize(page)}
				<li>
					<button
						class="mini"
						type="button"
						aria-current={page.id === currentId ? 'page' : undefined}
						aria-label="Go to page {index + 1}, {chartWord(page.items.length)}"
						title="Page {index + 1}"
						onclick={() => onselect(page.id)}
					>
						<span class="sheet-box">
							<svg
								class="sheet"
								width={mini.w}
								height={mini.h}
								viewBox="0 0 {mini.mmW} {mini.mmH}"
								aria-hidden="true"
							>
								<rect class="sheet-paper" width={mini.mmW} height={mini.mmH} />
								{#each page.items as item (item.id)}
									{#if item.chart.view.projection === 'stereographic'}
										<ellipse
											class="sheet-chart"
											cx={item.frame.x + item.frame.w / 2}
											cy={item.frame.y + item.frame.h / 2}
											rx={item.frame.w / 2}
											ry={item.frame.h / 2}
										/>
									{:else}
										<rect
											class="sheet-chart"
											x={item.frame.x}
											y={item.frame.y}
											width={item.frame.w}
											height={item.frame.h}
											rx="3"
										/>
									{/if}
								{/each}
							</svg>
						</span>
						<span class="number" aria-hidden="true">{index + 1}</span>
					</button>
				</li>
			{/each}
			<li>
				<button class="add" type="button" aria-label="Add page" title="Add page" onclick={onadd}>
					<span class="add-box">
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<circle cx="8" cy="8" r="6.25" />
							<path d="M8 5.25v5.5M5.25 8h5.5" />
						</svg>
					</span>
					<span class="number" aria-hidden="true">Add</span>
				</button>
			</li>
		</ol>
	</div>
</nav>

<style>
	.strip {
		min-width: 0;
		border-top: 1px solid var(--hairline);
	}

	.scroller {
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
	}

	/* Centred while it fits, scrolling from the first page once it does not. */
	.track {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		width: max-content;
		margin: 0 auto;
		padding: 10px 16px 8px;
		list-style: none;
	}

	.mini,
	.add {
		display: grid;
		justify-items: center;
		gap: 4px;
		width: 52px;
		padding: 6px 0 4px;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-3);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.sheet-box,
	.add-box {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
	}

	.sheet {
		display: block;
		border-radius: 1.5px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
		transition: transform var(--ease-ui);
	}

	.sheet-paper {
		fill: var(--paper);
	}

	.sheet-chart {
		fill: var(--paper-chart-mini);
	}

	.number {
		font: var(--font-cap);
		font-variant-numeric: tabular-nums;
	}

	@media (hover: hover) {
		.mini:hover,
		.add:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}

		.mini:not([aria-current]):hover .sheet {
			transform: translateY(-1px);
		}
	}

	.mini:active,
	.add:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	/* The current page: lit like the dock's selected option, its number in full white. */
	.mini[aria-current] {
		background: var(--fill-on);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
		color: var(--fg-1);
	}

	.mini:focus-visible,
	.add:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.add-box svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	@media (forced-colors: active) {
		.mini[aria-current] {
			outline: 2px solid Highlight;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mini,
		.add,
		.sheet {
			transition: none;
		}
	}
</style>
