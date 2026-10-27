<script lang="ts">
	/**
	 * One page at a small scale: a white sheet with its charts where they sit, each
	 * the vector preview (`itemPreviewUrl`) once it loads and the add-time `thumb`
	 * until then. Decorative: whatever holds it carries the name.
	 *
	 * Previews are fetched once a chart's frame has been still for a moment, so a
	 * drag in the editor does not ask for one per pointer move; meanwhile the last
	 * preview stays, scaled to the new frame. Off-screen pages wait until they
	 * scroll into view.
	 */
	import { PINHOLE_CORNER_RADIUS } from '$lib/constants';
	import { pageSize, PRINT_MM_PER_PREVIEW_PX } from '$lib/document/geometry';
	import { itemPreviewUrl } from '$lib/document/render';
	import type { DocPage } from '$lib/document/types';

	interface Props {
		page: DocPage;
		/** Screen px per mm. */
		scale: number;
	}

	let { page, scale }: Props = $props();

	/** A frame change waits this long for the next before its preview is fetched. */
	const SETTLE_MS = 350;

	/** The pinhole frame's rounded corner, in mm on the page. */
	const cornerMm = PINHOLE_CORNER_RADIUS * PRINT_MM_PER_PREVIEW_PX;

	const size = $derived(pageSize(page.orientation));

	let sheetEl = $state<HTMLDivElement>();
	let inView = $state(false);
	/** Loaded preview URLs by item id; a URL may be for an older size until the new one loads. */
	let previews = $state<Record<string, string>>({});
	const requests: Record<string, number> = {};
	let first = true;

	$effect(() => {
		const el = sheetEl;
		if (!el) return;
		if (typeof IntersectionObserver === 'undefined') {
			inView = true;
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					inView = true;
					observer.disconnect();
				}
			},
			{ rootMargin: '200px' }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!inView) return;
		// The preview depends on the frame's size; each change resets the timer below.
		const items = page.items.map((item) => ({ item, w: item.frame.w, h: item.frame.h }));
		const delay = first ? 0 : SETTLE_MS;
		first = false;
		let live = true;
		const timer = setTimeout(() => {
			for (const { item } of items) {
				const ticket = (requests[item.id] = (requests[item.id] ?? 0) + 1);
				itemPreviewUrl(item).then(
					(url) => {
						if (live && requests[item.id] === ticket) previews[item.id] = url;
					},
					// The backend is away: the thumb stays.
					() => {}
				);
			}
		}, delay);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	});

	/** The preview's URL was revoked (evicted from the cache): fall back and fetch again later. */
	function dropPreview(id: string) {
		delete previews[id];
	}
</script>

<div
	bind:this={sheetEl}
	class="sheet"
	style:width="{size.w * scale}px"
	style:height="{size.h * scale}px"
	aria-hidden="true"
>
	{#each page.items as item (item.id)}
		{@const src = previews[item.id] ?? item.thumb}
		{@const round = item.chart.view.projection === 'stereographic'}
		<div
			class="chart"
			style:left="{item.frame.x * scale}px"
			style:top="{item.frame.y * scale}px"
			style:width="{item.frame.w * scale}px"
			style:height="{item.frame.h * scale}px"
			style:--corner={round ? '50%' : `${cornerMm * scale}px`}
		>
			{#if src}
				<img {src} alt="" draggable="false" onerror={() => dropPreview(item.id)} />
			{/if}
		</div>
	{/each}
</div>

<style>
	.sheet {
		position: relative;
		display: block;
		overflow: hidden;
		border-radius: 2px;
		background: var(--paper);
		box-shadow: var(--paper-shadow);
	}

	.chart {
		position: absolute;
		pointer-events: none;
		user-select: none;
	}

	.chart img {
		display: block;
		width: 100%;
		height: 100%;
		max-width: none;
	}

	/*
	 * The sky's edge, which the preview draws a hairline in mm: far under a pixel at
	 * this scale. Drawn here at 1 px, so a white chart on white paper still shows.
	 */
	.chart::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--corner);
		box-shadow: inset 0 0 0 1px var(--paper-chart-edge);
	}

	/* Forced colours drop the paper fill: keep the sheet's edge. */
	@media (forced-colors: active) {
		.sheet {
			outline: 1px solid CanvasText;
		}
	}
</style>
