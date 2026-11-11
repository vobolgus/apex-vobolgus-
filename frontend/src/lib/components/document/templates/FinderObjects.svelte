<script lang="ts">
	/**
	 * A finder card's second step: the Messier objects on its wide sky, brightest
	 * first, to find by number, name, kind or constellation, and the card drawn beside
	 * them for the object under the pointer (or the focus). A click on an object, or
	 * Enter in the search with something found, chooses it. ↓ and ↑ go from the
	 * search through the objects.
	 */
	import { pageSize } from '$lib/document/geometry';
	import type { DocPage, PageOrientation } from '$lib/document/types';
	import type { MessierEntry } from '$lib/api/wire/payload';
	import PageThumbnail from '../PageThumbnail.svelte';
	import { objectName, type FinderChoice } from './finder.svelte';

	interface Props {
		finder: FinderChoice;
		/** The card as it would be for the object shown, to draw. */
		card: DocPage | null;
		/** The orientation of the card's page. */
		orientation: PageOrientation;
		/** The Messier catalogue could not be had. */
		failed: boolean;
		onchoose: (object: MessierEntry) => void;
	}

	let { finder, card, orientation, failed, onchoose }: Props = $props();

	/** The card drawn beside the list of objects, px wide. */
	const CARD_PX = 176;

	let objectsEl = $state<HTMLElement>();

	function handleKeydown(event: KeyboardEvent) {
		const rows = Array.from(objectsEl?.querySelectorAll<HTMLElement>('[data-object]') ?? []);
		const search = objectsEl?.querySelector<HTMLElement>('[data-search]');
		const at = rows.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			rows[Math.min(at + 1, rows.length - 1)]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (at <= 0) search?.focus();
			else rows[at - 1].focus();
		} else if (event.key === 'Enter' && document.activeElement === search && finder.listed[0]) {
			event.preventDefault();
			onchoose(finder.listed[0]);
		}
	}
</script>

<div class="finder">
	<div class="card" aria-hidden="true">
		{#if card}
			<PageThumbnail page={card} scale={CARD_PX / pageSize(orientation).w} />
		{/if}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div bind:this={objectsEl} class="objects" onkeydown={handleKeydown}>
		<input
			class="search"
			type="search"
			data-search
			aria-label="Find an object"
			placeholder="Find an object: M 42, Orion, cluster…"
			autocomplete="off"
			spellcheck="false"
			bind:value={finder.query}
		/>
		{#if finder.listed.length > 0}
			<ul class="list" aria-label="Objects on this sky">
				{#each finder.listed as object (object.m)}
					<li>
						<button
							class="object"
							class:is-shown={object.m === finder.shown?.m}
							type="button"
							data-object
							onpointerenter={() => (finder.shownNumber = object.m)}
							onfocus={() => (finder.shownNumber = object.m)}
							onclick={() => onchoose(object)}
						>
							<span class="object-name">{objectName(object)}</span>
							<span class="object-note">
								{object.kind} · {object.constellation} · {object.mag.toFixed(1)}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="none">
				{#if failed}
					Couldn’t load the Messier catalogue.
				{:else if !finder.loaded}
					Loading the Messier catalogue…
				{:else if finder.objects.length === 0}
					No Messier object is on this chart.
				{:else}
					Nothing on this chart matches.
				{/if}
			</p>
		{/if}
	</div>
</div>

<style>
	/* The card for the object in hand on the left, the objects to choose from on the right. */
	.finder {
		display: flex;
		gap: 14px;
		width: min(584px, calc(100vw - 54px));
	}

	.card {
		display: grid;
		flex: none;
		place-items: center;
		width: 190px;
		min-height: 260px;
	}

	.objects {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.search {
		box-sizing: border-box;
		width: 100%;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-1);
		font:
			400 12px/1 Inter,
			system-ui,
			sans-serif;
	}

	.search::placeholder {
		color: var(--fg-3);
	}

	.search:focus-visible {
		outline: 2px solid transparent;
		box-shadow: var(--ring);
	}

	.list {
		height: 248px;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	.object {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		box-sizing: border-box;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.object.is-shown {
		background: var(--fill-hover);
	}

	.object-name {
		overflow: hidden;
		color: var(--fg-1);
		font:
			400 12px/16px Inter,
			system-ui,
			sans-serif;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.object-note {
		flex: none;
		color: var(--fg-3);
		font:
			400 11px/16px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
	}

	.none {
		margin: 12px 2px;
		color: var(--fg-3);
		font:
			400 12px/16px Inter,
			system-ui,
			sans-serif;
	}

	.object:active {
		background: var(--fill-press);
	}

	.object:focus-visible {
		outline: 2px solid var(--fg-1);
		outline-offset: -2px;
	}

	@media (max-width: 560px) {
		.card {
			display: none;
		}
	}
</style>
