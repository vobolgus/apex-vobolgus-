<script lang="ts">
	/**
	 * A template in the picker: what it would make of the page, drawn small, its name
	 * and what it does, or why it cannot be chosen. A finder card's asks one thing more,
	 * the object of its close-up, and says so with an ellipsis.
	 */
	import { pageSize } from '$lib/document/geometry';
	import type { PageOrientation } from '$lib/document/types';
	import PageThumbnail from '../PageThumbnail.svelte';
	import type { Tile } from './tiles';

	interface Props {
		tile: Tile;
		/** The orientation of the pages it makes. */
		orientation: PageOrientation;
		onchoose: (tile: Tile) => void;
	}

	let { tile, orientation, onchoose }: Props = $props();

	/** A tile's sheet is this wide, px, whichever way the page is turned. */
	const TILE_PX = 92;

	const scale = $derived(TILE_PX / pageSize(orientation).w);
	const finder = $derived(tile.info.id === 'finder');
</script>

<button
	class="tile"
	type="button"
	disabled={tile.blocked !== null}
	aria-label="{tile.info.name}: {tile.note}"
	aria-haspopup={finder ? 'listbox' : undefined}
	data-finder={finder ? '' : undefined}
	onclick={() => onchoose(tile)}
>
	<span class="sheet">
		{#if tile.preview}
			<PageThumbnail page={tile.preview} {scale} />
		{:else}
			<span
				class="blank"
				style:width="{TILE_PX}px"
				style:height="{pageSize(orientation).h * scale}px"
			></span>
		{/if}
	</span>
	<span class="name">{tile.info.name}{finder && !tile.blocked ? '…' : ''}</span>
	<span class="note">{tile.note}</span>
</button>

<style>
	.tile {
		display: grid;
		justify-items: center;
		gap: 2px;
		width: 112px;
		padding: 10px 6px 8px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: inherit;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.sheet {
		display: grid;
		place-items: center;
		margin-bottom: 6px;
		pointer-events: none;
	}

	.blank {
		display: block;
		box-sizing: border-box;
		border: 1px dashed var(--hairline);
		border-radius: 2px;
	}

	.name {
		color: var(--fg-1);
		font:
			500 12px/16px Inter,
			system-ui,
			sans-serif;
	}

	.note {
		color: var(--fg-3);
		font:
			400 11px/14px Inter,
			system-ui,
			sans-serif;
		text-align: center;
	}

	@media (hover: hover) {
		.tile:not(:disabled):hover {
			background: var(--fill-hover);
		}
	}

	.tile:not(:disabled):active {
		background: var(--fill-press);
	}

	.tile:disabled {
		cursor: default;
	}

	.tile:disabled .name {
		color: var(--fg-3);
	}

	.tile:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: var(--ring);
	}
</style>
