<script lang="ts">
	/**
	 * "Lay page N out as": the templates, each shown as what it would make of this
	 * very page, with the page's own charts (`TemplateTile`). A click on one lays the
	 * page out; the way back is the toast's Undo, which whoever opened this offers.
	 *
	 * A finder card asks one thing more: what to draw the close-up of. Its tile opens
	 * a list of the Messier objects on the page's wide sky, brightest first, with the
	 * card drawn beside it for the object under the pointer or the focus
	 * (`FinderObjects`); a click on an object lays the page out. The close-up's field
	 * is chosen there too.
	 *
	 * Under the tiles: the orientation of the pages to make, the language the template
	 * writes its words in (English or Russian; Russian to begin with in a browser set
	 * to it), and, with two charts or more, "Swap charts", which has them go in the
	 * other order. Each redraws everything.
	 *
	 * A native modal `<dialog>` put beside what opened it (`anchor`): the top layer,
	 * so no panel clips it, Escape and a press outside close it, and the focus goes
	 * back where it was.
	 */
	import { tick, untrack } from 'svelte';
	import { loadMessier } from '$lib/api/catalog';
	import type { MessierObject } from '$lib/api/catalog-types';
	import { chartsOf } from '$lib/document/blocks';
	import { LANGUAGE_NAMES } from '$lib/document/labels';
	import {
		CLOSE_UP_FIELD_DEG,
		CLOSE_UP_FIELDS,
		finderSky,
		TEMPLATE_LANGUAGES,
		TEMPLATES,
		type LaidPage,
		type TemplateInfo,
		type TemplateLanguage
	} from '$lib/document/templates';
	import { measuredLayout } from '$lib/document/text-fonts.svelte';
	import type { DocPage, PageOrientation, TextStyle } from '$lib/document/types';
	import { catalog } from '$lib/state/catalog.svelte';
	import EditorOrientation from '../EditorOrientation.svelte';
	import FinderObjects from './FinderObjects.svelte';
	import { closeUpOf, FinderChoice } from './finder.svelte';
	import type { PickerAnchor } from './pick';
	import TemplateTile from './TemplateTile.svelte';
	import { layFinder, previewOf, templateTiles, type Tile } from './tiles';

	interface Props {
		page: DocPage;
		/** 1-based. */
		number: number;
		/** How many more pages the document can take. */
		room: number;
		/** What opened it, in the window: the picker stands beside it (`side`) or under it. */
		anchor: PickerAnchor;
		placement?: 'side' | 'under';
		onapply: (template: TemplateInfo, laid: LaidPage[]) => void;
		onclose: () => void;
	}

	let { page, number, room, anchor, placement = 'side', onapply, onclose }: Props = $props();

	/** Clear of the window's edge, and of what opened it, px. */
	const EDGE_PX = 12;

	const id = $props.id();
	let dialogEl = $state<HTMLDialogElement>();
	let orientation = $state<PageOrientation>(untrack(() => page.orientation));
	let swap = $state(false);
	/** The language the templates write in: the browser's when it is one of theirs. */
	let language = $state<TemplateLanguage>(navigator.language.startsWith('ru') ? 'ru' : 'en');
	let place = $state<{ left: number; top: number } | null>(null);
	/** The tiles, or the objects a finder card's close-up may be of. */
	let step = $state<'templates' | 'objects'>('templates');
	let fovDeg = $state(CLOSE_UP_FIELD_DEG);
	/** Whether the Messier catalogue could not be had. */
	let failed = $state(false);
	/** True from the press on the backdrop to the click: a drag that ends there is no click. */
	let pressedOutside = false;

	const own = $derived(chartsOf(page));
	const height = (text: string, style: TextStyle, width: number) =>
		measuredLayout(text, style, width).height;

	/** The chart a finder card would be made of, in the order the charts are taken. */
	const sky = $derived(finderSky(swap ? [...own].reverse() : own));
	const finder = new FinderChoice(
		() => sky?.chart,
		() => catalog.messier
	);
	/** How the picker's controls have the templates laid out. */
	const laying = $derived({ orientation, swap, height, language });

	/** A finder card is shown with the brightest object on the sky, as an example. */
	const tiles = $derived(
		templateTiles(page, {
			...laying,
			room,
			failed,
			example: finder.objects[0] ? closeUpOf(finder.objects[0], fovDeg) : undefined
		})
	);

	function layCard(object: MessierObject | null): LaidPage[] {
		return layFinder(page, laying, object ? closeUpOf(object, fovDeg) : undefined);
	}

	const card = $derived(step === 'objects' ? layCard(finder.shown) : []);
	const cardPreview = $derived(card[0] ? previewOf(page, card[0]) : null);

	// The catalogue a finder card chooses from: asked for as the picker opens.
	$effect(() => {
		void loadMessier().then((ok) => (failed = !ok));
	});

	// Open on mount; the content is there first, so the box can be measured and placed.
	$effect(() => {
		const dialog = dialogEl;
		if (!dialog || dialog.open) return;
		// Unseen until it is placed, but not hidden: a hidden dialog takes no focus, and
		// Escape would go to whatever is behind it.
		dialog.showModal();
		if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
		position();
	});

	// The box changes size with the step, the orientation and what is listed: keep it in the window.
	$effect(() => {
		void step;
		void orientation;
		void tiles.length;
		void finder.listed.length;
		if (dialogEl?.open) void tick().then(position);
	});

	function position() {
		const dialog = dialogEl;
		if (!dialog) return;
		const { width, height: tall } = dialog.getBoundingClientRect();
		const fit = (value: number, size: number, limit: number) =>
			Math.max(EDGE_PX, Math.min(value, limit - size - EDGE_PX));
		const side = placement === 'side';
		place = {
			left: fit(side ? anchor.right + EDGE_PX : anchor.left, width, window.innerWidth),
			top: fit(side ? anchor.top - EDGE_PX : anchor.bottom + EDGE_PX / 2, tall, window.innerHeight)
		};
	}

	function choose(tile: Tile) {
		if (tile.blocked || tile.laid.length === 0) return;
		if (tile.info.id === 'finder') {
			step = 'objects';
			finder.shownNumber = null;
			void tick().then(() => dialogEl?.querySelector<HTMLElement>('[data-search]')?.focus());
			return;
		}
		onapply(tile.info, tile.laid);
		dialogEl?.close();
	}

	function chooseObject(object: MessierObject) {
		const laid = layCard(object);
		const info = TEMPLATES.find((template) => template.id === 'finder')!;
		if (laid.length === 0 || laid.length - 1 > room) return;
		onapply(info, laid);
		dialogEl?.close();
	}

	function back() {
		step = 'templates';
		finder.query = '';
		void tick().then(() => dialogEl?.querySelector<HTMLElement>('[data-finder]')?.focus());
	}

	/** Keys here are the picker's own. Escape among the objects goes back to the templates. */
	function handleKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key !== 'Escape' || step !== 'objects') return;
		// Stopped at the key: a browser may not let a dialog refuse to close twice in a row.
		event.preventDefault();
		back();
	}

	function handleCancel(event: Event) {
		// Escape among the objects goes back to the templates; among those it closes.
		if (step !== 'objects') return;
		event.preventDefault();
		back();
	}

	function handleClick(event: MouseEvent) {
		// The content fills the dialog box, so a click on the dialog itself is on the backdrop.
		if (pressedOutside && event.target === dialogEl) dialogEl?.close();
		pressedOutside = false;
	}
</script>

<dialog
	bind:this={dialogEl}
	class="picker"
	tabindex="-1"
	aria-labelledby="{id}-title"
	style:left={place ? `${place.left}px` : undefined}
	style:top={place ? `${place.top}px` : undefined}
	style:opacity={place ? undefined : 0}
	onkeydown={handleKeydown}
	onpointerdown={(event) => (pressedOutside = event.target === dialogEl)}
	onclick={handleClick}
	oncancel={handleCancel}
	{onclose}
>
	<div class="content">
		{#if step === 'templates'}
			<h2 id="{id}-title">Lay page {number} out as</h2>
			<ul class="tiles">
				{#each tiles as tile (tile.info.id)}
					<li>
						<TemplateTile {tile} {orientation} onchoose={choose} />
					</li>
				{/each}
			</ul>
		{:else}
			<div class="head">
				<button class="back" type="button" aria-label="Back to the templates" onclick={back}>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.75 4.5 6.25 8l3.5 3.5" /></svg>
				</button>
				<h2 id="{id}-title">Finder card of page {number}: a close-up of</h2>
			</div>
			<FinderObjects {finder} card={cardPreview} {orientation} {failed} onchoose={chooseObject} />
		{/if}
		<div class="foot">
			<EditorOrientation
				label="Orientation of the pages"
				value={orientation}
				onselect={(next) => (orientation = next)}
			/>
			<div class="fields" role="group" aria-label="Language of the text">
				{#each TEMPLATE_LANGUAGES as code (code)}
					<button
						class="chip"
						type="button"
						aria-pressed={language === code}
						title={LANGUAGE_NAMES[code]}
						onclick={() => (language = code)}
					>
						{code.toUpperCase()}
					</button>
				{/each}
			</div>
			{#if step === 'objects'}
				<div class="fields" role="group" aria-label="Field of the close-up">
					<span class="fields-label" aria-hidden="true">Field</span>
					{#each CLOSE_UP_FIELDS as field (field)}
						<button
							class="chip"
							type="button"
							aria-pressed={fovDeg === field}
							aria-label="{field} degrees"
							onclick={() => (fovDeg = field)}
						>
							{field}°
						</button>
					{/each}
				</div>
			{/if}
			{#if own.length >= 2}
				<button class="swap" type="button" aria-pressed={swap} onclick={() => (swap = !swap)}>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />
					</svg>
					Swap charts
				</button>
			{/if}
		</div>
	</div>
</dialog>

<style>
	.picker {
		position: fixed;
		inset: auto;
		box-sizing: border-box;
		width: max-content;
		max-width: calc(100vw - 24px);
		max-height: calc(100vh - 24px);
		margin: 0;
		padding: 0;
		overflow: auto;
		border: 1px solid var(--hairline);
		border-radius: 14px;
		background: var(--panel);
		color: var(--fg-2);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
	}

	.picker[open] {
		animation: picker-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	/* What is behind stays in sight: this is a choice about it, not a place of its own. */
	.picker::backdrop {
		background: transparent;
	}

	.picker:focus {
		outline: none;
	}

	@keyframes picker-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}

	.content {
		padding: 14px 14px 12px;
	}

	h2 {
		margin: 0 2px 10px;
		color: var(--fg-1);
		font:
			500 13px/18px Inter,
			system-ui,
			sans-serif;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: -4px 0 6px -4px;
	}

	.head h2 {
		margin: 0;
	}

	.back {
		display: grid;
		flex: none;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-2);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.back svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		max-width: 584px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (hover: hover) {
		.swap:hover,
		.back:hover,
		.chip:hover {
			background: var(--fill-hover);
		}

		.back:hover {
			color: var(--fg-1);
		}
	}

	.swap:active,
	.back:active,
	.chip:active {
		background: var(--fill-press);
	}

	.swap:focus-visible,
	.back:focus-visible,
	.chip:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: var(--ring);
	}

	/* Four groups at the most; on a narrow screen the last goes under the others whole. */
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px 12px;
		margin-top: 8px;
		padding-top: 10px;
		border-top: 1px solid var(--hairline);
	}

	.fields {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.fields-label {
		margin-right: 6px;
		color: var(--fg-3);
		font:
			400 12px/1 Inter,
			system-ui,
			sans-serif;
	}

	.chip,
	.swap {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 10px 0 8px;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-2);
		font:
			400 12px/1 Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.chip {
		padding: 0 8px;
	}

	.chip[aria-pressed='true'],
	.swap[aria-pressed='true'] {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.swap svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (prefers-reduced-motion: reduce) {
		.picker[open] {
			animation: none;
		}
	}
</style>
