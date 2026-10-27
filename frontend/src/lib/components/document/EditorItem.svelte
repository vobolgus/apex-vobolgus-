<script module lang="ts">
	/** The toolbar's commands on a selected chart, also on the keys. */
	export type ChartAction = 'smaller' | 'larger' | 'prev' | 'next';
</script>

<script lang="ts">
	/**
	 * One chart on a page in the editor: its vector preview, and on the current page
	 * the handles that move, resize and remove it.
	 *
	 * Positioned in percent of the page, so it follows the page as the editor zooms.
	 * The preview is fetched for the chart's size in the document; while a resize
	 * drags, the old picture stretches to the new frame, and the new one replaces it
	 * only once it has loaded, so the chart never blinks empty.
	 *
	 * Selected (focused), it shows a small toolbar: smaller, larger, and to the page
	 * before or after, for whoever cannot drag (and the same as + − Page Up/Down).
	 */
	import { untrack } from 'svelte';
	import { stepSize, type ResizeAnchor } from '$lib/document/geometry';
	import { itemPreviewUrl } from '$lib/document/render';
	import type { DocItem, PageOrientation, Rect } from '$lib/document/types';
	import { sizeLabel, spokenSize, type Size } from './editor-geometry';

	/** What the chart is doing: dragged on a page, dragged off every page, resized, or easing back. */
	export type ItemState = 'idle' | 'moving' | 'detached' | 'resizing' | 'returning';

	interface Props {
		item: DocItem;
		/** 0-based position on its page, for the accessible name. */
		index: number;
		count: number;
		/** The page, mm. */
		page: Size;
		orientation: PageOrientation;
		/** 1-based numbers of the pages before and after this one, null where there is none. */
		prevPage?: number | null;
		nextPage?: number | null;
		/** Where to draw the chart, mm on its page; off the page while it is dragged to another. */
		frame: Rect;
		/** On the current page: focusable, draggable, resizable. */
		interactive: boolean;
		mode?: ItemState;
		/** Id of the element that explains the keys. */
		hintId?: string;
		onmovestart?: (event: PointerEvent, item: DocItem) => void;
		onresizestart?: (event: PointerEvent, item: DocItem, handle: ResizeAnchor) => void;
		onkeydown?: (event: KeyboardEvent, item: DocItem) => void;
		onremove?: (item: DocItem) => void;
		onaction?: (item: DocItem, action: ChartAction) => void;
	}

	let {
		item,
		index,
		count,
		page,
		orientation,
		prevPage = null,
		nextPage = null,
		frame,
		interactive,
		mode = 'idle',
		hintId,
		onmovestart,
		onresizestart,
		onkeydown,
		onremove,
		onaction
	}: Props = $props();

	const HANDLES: readonly ResizeAnchor[] = ['nw', 'ne', 'sw', 'se'];

	let src = $state<string | null>(null);
	let failed = $state(false);
	/** Bumped when a shown preview stops loading (its URL revoked): fetch it again. */
	let reload = $state(0);

	// The preview depends on the chart's size, not its place on the page.
	const sizeKey = $derived(`${item.frame.w}:${item.frame.h}`);

	$effect(() => {
		void sizeKey;
		void reload;
		const snapshot = untrack(() => $state.snapshot(item)) as DocItem;
		let live = true;
		itemPreviewUrl(snapshot)
			.then(preload)
			.then(
				(url) => {
					if (!live) return;
					src = url;
					failed = false;
				},
				() => {
					if (live) failed = true;
				}
			);
		return () => {
			live = false;
		};
	});

	/** Resolves once the picture has loaded, so swapping it in shows no empty frame. */
	function preload(url: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(url);
			image.onerror = () => reject(new Error('Chart preview did not load'));
			image.src = url;
		});
	}

	/** The <img> with a preview URL no longer loads: show the thumb and fetch again. */
	function handleImageError() {
		if (src === null) return;
		src = null;
		reload += 1;
	}

	const picture = $derived(src ?? item.thumb ?? null);
	const disc = $derived(item.chart.view.projection === 'stereographic');
	const name = $derived(
		`Chart ${index + 1} of ${count}, ${item.chart.view.projection}, ${spokenSize(item.frame)}`
	);
	const canShrink = $derived(stepSize(item.frame, item.chart.aspect, orientation, -1) !== null);
	const canGrow = $derived(stepSize(item.frame, item.chart.aspect, orientation, 1) !== null);

	/**
	 * The control a press began on. A tap that selects the chart reveals the ⊖ and the
	 * toolbar, and the click the tap ends in lands on whichever is now under the
	 * finger: a pointer click counts only on the control it was pressed on. (Keys and
	 * screen readers click with `detail` 0.)
	 */
	let pressed: EventTarget | null = null;

	function pressedHere(event: MouseEvent): boolean {
		const here = event.detail === 0 || pressed === event.currentTarget;
		pressed = null;
		return here;
	}

	function handleChartPointerDown(event: PointerEvent) {
		pressed = null;
		onmovestart?.(event, item);
	}

	function handleRemovePointerDown(event: PointerEvent) {
		event.stopPropagation();
		pressed = event.currentTarget;
	}

	/** A press on a tool keeps the focus on the chart: the toolbar stays, the keys still work. */
	function handleToolPointerDown(event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		pressed = event.currentTarget;
	}

	function act(event: MouseEvent, action: ChartAction) {
		if (pressedHere(event)) onaction?.(item, action);
	}
</script>

{#snippet preview()}
	{#if picture}
		<img src={picture} alt="" draggable="false" onerror={handleImageError} />
	{:else}
		<span class="placeholder" class:is-disc={disc} class:is-failed={failed}></span>
	{/if}
{/snippet}

<div
	class="item"
	class:is-interactive={interactive}
	class:is-disc={disc}
	data-item-id={item.id}
	data-state={mode}
	style:left="{(frame.x / page.w) * 100}%"
	style:top="{(frame.y / page.h) * 100}%"
	style:width="{(frame.w / page.w) * 100}%"
	style:height="{(frame.h / page.h) * 100}%"
>
	{#if interactive}
		<div
			class="chart"
			role="button"
			tabindex="0"
			aria-roledescription="chart"
			aria-label={name}
			aria-describedby={hintId}
			aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown = - PageUp PageDown Delete"
			onpointerdown={handleChartPointerDown}
			onkeydown={(event) => onkeydown?.(event, item)}
		>
			{@render preview()}
		</div>
		{#each HANDLES as handle (handle)}
			<!-- Pointer only: the keys and the toolbar move, resize and remove the chart. -->
			<span
				class="handle"
				data-handle={handle}
				aria-hidden="true"
				onpointerdown={(event) => onresizestart?.(event, item, handle)}
			>
				<svg viewBox="0 0 24 24">
					<path class="halo" d="M9 19V9h10" />
					<path class="bracket" d="M9 19V9h10" />
				</svg>
			</span>
		{/each}
		<button
			class="remove"
			type="button"
			tabindex="-1"
			aria-label="Remove chart {index + 1}"
			title="Remove chart"
			onpointerdown={handleRemovePointerDown}
			onclick={(event) => {
				if (pressedHere(event)) onremove?.(item);
			}}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8h7" /></svg>
		</button>
		<div class="tools" role="group" aria-label="Chart {index + 1}">
			<button
				class="tool"
				type="button"
				tabindex="-1"
				aria-label="Make chart {index + 1} smaller"
				title="Smaller · −"
				disabled={!canShrink}
				onpointerdown={handleToolPointerDown}
				onclick={(event) => act(event, 'smaller')}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M9.25 3.25v3.5h3.5M6.75 12.75v-3.5h-3.5M9.25 6.75l3.5-3.5M6.75 9.25l-3.5 3.5" />
				</svg>
			</button>
			<button
				class="tool"
				type="button"
				tabindex="-1"
				aria-label="Make chart {index + 1} larger"
				title="Larger · +"
				disabled={!canGrow}
				onpointerdown={handleToolPointerDown}
				onclick={(event) => act(event, 'larger')}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path
						d="M9.25 3.25h3.5v3.5M6.75 12.75h-3.5v-3.5M12.75 3.25l-3.5 3.5M3.25 12.75l3.5-3.5"
					/>
				</svg>
			</button>
			{#if prevPage !== null || nextPage !== null}
				<span class="tool-divider" aria-hidden="true"></span>
			{/if}
			{#if prevPage !== null}
				<button
					class="tool"
					type="button"
					tabindex="-1"
					aria-label="Move chart {index + 1} to page {prevPage}"
					title="To page {prevPage} · Page Up"
					onpointerdown={handleToolPointerDown}
					onclick={(event) => act(event, 'prev')}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.75 4.5 6.25 8l3.5 3.5" /></svg>
				</button>
			{/if}
			{#if nextPage !== null}
				<button
					class="tool"
					type="button"
					tabindex="-1"
					aria-label="Move chart {index + 1} to page {nextPage}"
					title="To page {nextPage} · Page Down"
					onpointerdown={handleToolPointerDown}
					onclick={(event) => act(event, 'next')}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.25 4.5 9.75 8l-3.5 3.5" /></svg>
				</button>
			{/if}
		</div>
		{#if mode === 'resizing'}
			<span class="readout" aria-hidden="true">{sizeLabel(frame)}</span>
		{/if}
	{:else}
		<div class="chart">{@render preview()}</div>
	{/if}
</div>

<style>
	.item {
		position: absolute;
		box-sizing: border-box;
		/* Charts drawn later sit on top, as they print. */
		z-index: 1;
	}

	.item.is-interactive:focus-within,
	.item:not([data-state='idle']) {
		z-index: 3;
	}

	.item[data-state='returning'] {
		transition:
			left 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
			top 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	/* Off every page: let go here and it goes back, so it looks lifted off the paper. */
	.item[data-state='detached'] {
		opacity: 0.6;
		filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.35));
	}

	.chart {
		position: absolute;
		inset: 0;
		border-radius: 1px;
		user-select: none;
		-webkit-user-select: none;
	}

	/*
	 * The sky's edge. The preview strokes it one preview px wide in mm, a third of a
	 * screen px here, which leaves a white chart on white paper all but edgeless;
	 * drawn at 1 px as the panel's thumbnails do, over the picture.
	 */
	.chart::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px var(--paper-chart-edge);
		pointer-events: none;
	}

	.is-disc .chart::before {
		border-radius: 50%;
	}

	.is-interactive .chart {
		cursor: grab;
		touch-action: none;
		-webkit-tap-highlight-color: transparent;
	}

	.item[data-state='moving'] .chart,
	.item[data-state='detached'] .chart {
		cursor: grabbing;
	}

	/* The frame's outline: on hover it reads as movable, while selected it shows the frame. */
	.is-interactive .chart::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px var(--paper-edge);
		opacity: 0;
		transition: opacity var(--ease-ui);
		pointer-events: none;
	}

	.is-interactive:focus-within .chart::after,
	.item:not([data-state='idle']) .chart::after {
		opacity: 1;
	}

	/* A dark ring with a white gap: the app's light ring would vanish on white paper. */
	.chart:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: var(--ring-paper);
	}

	img,
	.placeholder {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* `fill`: during a resize the old picture stretches to the new frame until the new one loads. */
	img {
		object-fit: fill;
		-webkit-user-drag: none;
	}

	.placeholder {
		box-sizing: border-box;
		border: 1px solid var(--paper-chart-edge);
		border-radius: 2px;
		background: var(--paper-chart);
		animation: placeholder-pulse 1.4s ease-in-out infinite alternate;
	}

	.placeholder.is-disc {
		border-radius: 50%;
	}

	.placeholder.is-failed {
		animation: none;
		background:
			repeating-linear-gradient(-45deg, transparent 0 6px, rgba(10, 10, 11, 0.05) 6px 7px),
			var(--paper-chart);
	}

	@keyframes placeholder-pulse {
		to {
			background: var(--paper-chart-pulse);
		}
	}

	/*
	 * Corner brackets, the pinhole frame's resize handles in ink for paper. Hidden,
	 * they take no presses either (nor does the ⊖): on a touch screen nothing shows
	 * them before the chart is selected, and an unseen control must not act.
	 */
	.handle {
		position: absolute;
		z-index: 2;
		width: 24px;
		height: 24px;
		margin: -12px;
		opacity: 0;
		pointer-events: none;
		touch-action: none;
		transition: opacity var(--ease-ui);
		-webkit-tap-highlight-color: transparent;
	}

	.handle[data-handle='nw'] {
		top: 0;
		left: 0;
		cursor: nwse-resize;
	}

	.handle[data-handle='ne'] {
		top: 0;
		right: 0;
		cursor: nesw-resize;
	}

	.handle[data-handle='sw'] {
		bottom: 0;
		left: 0;
		cursor: nesw-resize;
	}

	.handle[data-handle='se'] {
		right: 0;
		bottom: 0;
		cursor: nwse-resize;
	}

	.handle svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.handle[data-handle='ne'] svg {
		transform: scaleX(-1);
	}

	.handle[data-handle='sw'] svg {
		transform: scaleY(-1);
	}

	.handle[data-handle='se'] svg {
		transform: scale(-1);
	}

	.halo {
		stroke: #ffffff;
		stroke-width: 5;
	}

	.bracket {
		stroke: var(--ink);
		stroke-width: 2;
	}

	/* Inset clear of the corner handle's box, with a 28 px target around the 20 px badge. */
	.remove {
		position: absolute;
		z-index: 2;
		top: 16px;
		left: 16px;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--accent);
		box-shadow:
			0 0 0 1.5px #ffffff,
			0 1px 3px rgba(0, 0, 0, 0.35);
		color: #ffffff;
		opacity: 0;
		pointer-events: none;
		cursor: pointer;
		transition:
			opacity var(--ease-ui),
			background var(--ease-ui),
			transform var(--ease-ui);
	}

	.remove::before {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: 50%;
	}

	.remove svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	@media (hover: hover) {
		.is-interactive:hover .handle,
		.is-interactive:hover .remove,
		.is-interactive:hover .chart::after {
			opacity: 1;
		}

		.is-interactive:hover .handle,
		.is-interactive:hover .remove {
			pointer-events: auto;
		}

		.remove:hover {
			background: var(--accent-hover);
			transform: scale(1.08);
		}
	}

	.is-interactive:focus-within .handle,
	.is-interactive:focus-within .remove,
	.item[data-state='resizing'] .handle {
		opacity: 1;
		pointer-events: auto;
	}

	/* Mid-drag the chart is all that matters; the minus would only get in the way. */
	.item:not([data-state='idle']) .remove {
		opacity: 0;
		pointer-events: none;
	}

	.remove:active {
		background: var(--accent-press);
	}

	.remove:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		opacity: 1;
		box-shadow: var(--ring-paper);
	}

	/* No hover on touch screens: bigger targets for the fingers once the chart is selected. */
	@media (pointer: coarse) {
		.handle {
			width: 40px;
			height: 40px;
			margin: -20px;
		}

		.handle svg {
			margin: 8px;
			width: 24px;
			height: 24px;
		}

		.remove {
			top: 20px;
			left: 20px;
			width: 28px;
			height: 28px;
		}

		.tool {
			width: 36px;
			height: 36px;
		}
	}

	/* Over the chart's foot, in the dark of the size readout: the chart's own controls. */
	.tools {
		position: absolute;
		z-index: 4;
		left: 50%;
		bottom: 8px;
		display: none;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		background: rgba(24, 24, 27, 0.92);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		transform: translateX(-50%);
	}

	.item.is-interactive[data-state='idle']:focus-within .tools {
		display: flex;
	}

	.tool {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: #eceef1;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.tool svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (hover: hover) {
		.tool:not(:disabled):hover {
			background: rgba(255, 255, 255, 0.1);
		}
	}

	.tool:not(:disabled):active {
		background: rgba(255, 255, 255, 0.16);
	}

	.tool:disabled {
		color: rgba(236, 238, 241, 0.4);
		cursor: default;
	}

	.tool:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7);
	}

	.tool-divider {
		width: 1px;
		height: 16px;
		margin: 0 2px;
		background: rgba(255, 255, 255, 0.14);
	}

	/* The pinhole frame's size readout. */
	.readout {
		position: absolute;
		z-index: 4;
		left: 50%;
		bottom: -36px;
		display: flex;
		align-items: center;
		height: 24px;
		padding: 0 10px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		background: rgba(24, 24, 27, 0.92);
		color: #eceef1;
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transform: translateX(-50%);
		pointer-events: none;
	}

	@media (forced-colors: active) {
		.is-interactive .chart::after {
			box-shadow: none;
			outline: 1px solid CanvasText;
		}

		.remove,
		.tools {
			border: 1px solid ButtonText;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.item[data-state='returning'] {
			transition: none;
		}

		.placeholder {
			animation: none;
		}

		.handle,
		.remove,
		.is-interactive .chart::after {
			transition: none;
		}
	}
</style>
