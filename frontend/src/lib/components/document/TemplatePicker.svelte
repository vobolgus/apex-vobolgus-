<script lang="ts">
	/**
	 * "Lay page N out as": the templates, each shown as what it would make of this
	 * very page, with the page's own charts. A click on one lays the page out; the
	 * way back is the toast's Undo, which whoever opened this offers.
	 *
	 * A finder card asks one thing more: what to draw the close-up of. Its tile opens
	 * a list of the Messier objects on the page's wide sky, brightest first, with the
	 * card drawn beside it for the object under the pointer (or the focus); a click on
	 * an object lays the page out. The close-up's field is chosen there too.
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
	import { pageSize } from '$lib/document/geometry';
	import { plural } from '$lib/document/labels';
	import {
		CLOSE_UP_FIELD_DEG,
		CLOSE_UP_FIELDS,
		finderSky,
		isOnChart,
		layTemplate,
		TEMPLATE_LANGUAGES,
		TEMPLATES,
		type CloseUp,
		type LaidPage,
		type TemplateInfo,
		type TemplateLanguage
	} from '$lib/document/templates';
	import { measuredLayout } from '$lib/document/text-fonts.svelte';
	import type { DocItem, DocPage, PageOrientation, TextStyle } from '$lib/document/types';
	import { catalog, type MessierObject } from '$lib/stores.svelte';
	import EditorOrientation from './EditorOrientation.svelte';
	import PageThumbnail from './PageThumbnail.svelte';

	interface Props {
		page: DocPage;
		/** 1-based. */
		number: number;
		/** How many more pages the document can take. */
		room: number;
		/** What opened it, in the window: the picker stands beside it (`side`) or under it. */
		anchor: { left: number; top: number; right: number; bottom: number };
		placement?: 'side' | 'under';
		onapply: (template: TemplateInfo, laid: LaidPage[]) => void;
		onclose: () => void;
	}

	let { page, number, room, anchor, placement = 'side', onapply, onclose }: Props = $props();

	/** A tile's sheet is this wide, px, whichever way the page is turned. */
	const TILE_PX = 92;
	/** The finder card drawn beside the list of objects. */
	const CARD_PX = 176;
	/** Clear of the window's edge, and of what opened it, px. */
	const EDGE_PX = 12;
	/** What a language's button says, and its name for the tooltip. */
	const LANGUAGE_NAMES: Record<TemplateLanguage, string> = { en: 'English', ru: 'Russian' };

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
	/** What the list is narrowed to, as typed. */
	let query = $state('');
	/** The object the card is drawn for: the one under the pointer or the focus. */
	let shownNumber = $state<number | null>(null);
	/** Whether the Messier catalogue could not be had. */
	let failed = $state(false);
	/** True from the press on the backdrop to the click: a drag that ends there is no click. */
	let pressedOutside = false;

	const charts = $derived(page.items.length);
	const scale = $derived(TILE_PX / pageSize(orientation).w);
	const height = (text: string, style: TextStyle, width: number) =>
		measuredLayout(text, style, width).height;

	// === A finder card's close-up ===

	/** The chart a finder card would be made of, in the order the charts are taken. */
	const sky = $derived(finderSky(swap ? [...page.items].reverse() : page.items));
	/** The Messier objects on that sky, brightest first. */
	const objects = $derived(
		sky
			? catalog.messier
					.filter((object) => isOnChart(sky.chart, object.ra_deg, object.dec_deg))
					.sort((a, b) => a.mag - b.mag || a.m - b.m)
			: []
	);
	const listed = $derived.by(() => {
		const words = query.trim().toLowerCase().replace(/\s+/g, ' ');
		if (words === '') return objects;
		return objects.filter((object) => objectWords(object).includes(words));
	});
	const shownObject = $derived(
		listed.find((object) => object.m === shownNumber) ?? listed[0] ?? null
	);

	function objectName(object: MessierObject): string {
		return object.name ? `M ${object.m} · ${object.name}` : `M ${object.m}`;
	}

	/** What a search may match: "m 42", "m42", the name, the kind, the constellation. */
	function objectWords(object: MessierObject): string {
		const { m, name, kind, constellation } = object;
		return `m ${m} m${m} ${name} ${kind} ${constellation}`.toLowerCase();
	}

	function closeUpOf(object: MessierObject): CloseUp {
		return { name: objectName(object), raDeg: object.ra_deg, decDeg: object.dec_deg, fovDeg };
	}

	function layFinder(object: MessierObject | null): LaidPage[] {
		const closeUp = object ? closeUpOf(object) : undefined;
		return layTemplate('finder', page, { orientation, swap, height, closeUp, language });
	}

	// === The tiles ===

	interface Tile {
		info: TemplateInfo;
		laid: LaidPage[];
		/** The first page it makes, to draw. */
		preview: DocPage | null;
		/** Why it cannot be chosen, or null when it can. */
		blocked: string | null;
		note: string;
	}

	const tiles = $derived(
		TEMPLATES.map((info): Tile => {
			const finder = info.id === 'finder';
			// A finder card is shown with the brightest object on the sky, as an example.
			const laid =
				charts < info.minCharts
					? []
					: finder
						? layFinder(objects[0] ?? null)
						: layTemplate(info.id, page, { orientation, swap, height, language });
			const blocked =
				charts < info.minCharts
					? `Needs ${plural(info.minCharts, 'chart')}`
					: laid.length - 1 > room
						? `No room for ${plural(laid.length, 'page')}`
						: finder && failed
							? 'No catalogue to choose from'
							: null;
			const pages = laid.length > 1 ? ` · ${laid.length} pages` : '';
			return {
				info,
				laid,
				preview: laid[0] ? previewOf(laid[0]) : null,
				blocked,
				note: blocked ?? `${info.note}${pages}`
			};
		})
	);

	/** A laid page as a page to draw: the page's own charts in their new frames, and the text. */
	function previewOf(laid: LaidPage): DocPage {
		const own = (page.texts ?? []).filter((text) => text.role === undefined);
		return {
			id: `${page.id}-preview`,
			orientation: laid.orientation,
			items: laid.charts.flatMap(({ id: chartId, frame, chart, marks }): DocItem[] => {
				if (chart) return [{ id: chartId, chart, frame }];
				const item = page.items.find((it) => it.id === chartId);
				if (!item) return [];
				// Ringed where the template rings it, and nowhere else, as the page will be.
				const shown = { ...item.chart };
				if (marks?.length) shown.marks = marks;
				else delete shown.marks;
				return [{ ...item, chart: shown, frame }];
			}),
			texts: [...own, ...laid.texts.map((text, i) => ({ ...text, id: `preview-text-${i}` }))]
		};
	}

	const card = $derived(step === 'objects' ? layFinder(shownObject) : []);
	const cardPreview = $derived(card[0] ? previewOf(card[0]) : null);

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
		void listed.length;
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
			shownNumber = null;
			void tick().then(() => dialogEl?.querySelector<HTMLElement>('[data-search]')?.focus());
			return;
		}
		onapply(tile.info, tile.laid);
		dialogEl?.close();
	}

	function chooseObject(object: MessierObject) {
		const laid = layFinder(object);
		const info = TEMPLATES.find((template) => template.id === 'finder')!;
		if (laid.length === 0 || laid.length - 1 > room) return;
		onapply(info, laid);
		dialogEl?.close();
	}

	function back() {
		step = 'templates';
		query = '';
		void tick().then(() => dialogEl?.querySelector<HTMLElement>('[data-finder]')?.focus());
	}

	/** In the list: ↓ and ↑ go from the search field through the objects, Enter takes the first found. */
	function handleListKeydown(event: KeyboardEvent) {
		const rows = Array.from(dialogEl?.querySelectorAll<HTMLElement>('[data-object]') ?? []);
		const search = dialogEl?.querySelector<HTMLElement>('[data-search]');
		const at = rows.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			rows[Math.min(at + 1, rows.length - 1)]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (at <= 0) search?.focus();
			else rows[at - 1].focus();
		} else if (event.key === 'Enter' && document.activeElement === search && listed[0]) {
			event.preventDefault();
			chooseObject(listed[0]);
		}
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
					{@const finder = tile.info.id === 'finder'}
					<li>
						<button
							class="tile"
							type="button"
							disabled={tile.blocked !== null}
							aria-label="{tile.info.name}: {tile.note}"
							aria-haspopup={finder ? 'listbox' : undefined}
							data-finder={finder ? '' : undefined}
							onclick={() => choose(tile)}
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
			<div class="finder">
				<div class="card" aria-hidden="true">
					{#if cardPreview}
						<PageThumbnail page={cardPreview} scale={CARD_PX / pageSize(orientation).w} />
					{/if}
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="objects" onkeydown={handleListKeydown}>
					<input
						class="search"
						type="search"
						data-search
						aria-label="Find an object"
						placeholder="Find an object: M 42, Orion, cluster…"
						autocomplete="off"
						spellcheck="false"
						bind:value={query}
					/>
					{#if listed.length > 0}
						<ul class="list" aria-label="Objects on this sky">
							{#each listed as object (object.m)}
								<li>
									<button
										class="object"
										class:is-shown={object.m === shownObject?.m}
										type="button"
										data-object
										onpointerenter={() => (shownNumber = object.m)}
										onfocus={() => (shownNumber = object.m)}
										onclick={() => chooseObject(object)}
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
							{:else if catalog.messier.length === 0}
								Loading the Messier catalogue…
							{:else if objects.length === 0}
								No Messier object is on this chart.
							{:else}
								Nothing on this chart matches.
							{/if}
						</p>
					{/if}
				</div>
			</div>
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
			{#if charts >= 2}
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

	@media (hover: hover) {
		.tile:not(:disabled):hover,
		.swap:hover,
		.back:hover,
		.chip:hover {
			background: var(--fill-hover);
		}

		.back:hover {
			color: var(--fg-1);
		}
	}

	.tile:not(:disabled):active,
	.swap:active,
	.back:active,
	.chip:active,
	.object:active {
		background: var(--fill-press);
	}

	.tile:disabled {
		cursor: default;
	}

	.tile:disabled .name {
		color: var(--fg-3);
	}

	.tile:focus-visible,
	.swap:focus-visible,
	.back:focus-visible,
	.chip:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: var(--ring);
	}

	.object:focus-visible {
		outline: 2px solid var(--fg-1);
		outline-offset: -2px;
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

	@media (max-width: 560px) {
		.card {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.picker[open] {
			animation: none;
		}
	}
</style>
