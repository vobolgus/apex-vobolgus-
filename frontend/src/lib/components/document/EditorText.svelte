<script module lang="ts">
	/** The side of a text a width handle is on. */
	export type TextSide = 'w' | 'e';
</script>

<script lang="ts">
	/**
	 * One text on a page in the editor: its lines drawn as the PDF sets them, and on
	 * the current page what moves it, sets its width and style, and edits it.
	 *
	 * Its width is the frame's; its height is the lines', so the frame's height is
	 * told to the store whenever the lines turn out taller or shorter (`onheight`).
	 *
	 * Selected (focused), it shows a toolbar: the font, the size, bold, italic, the
	 * alignment, and Delete. Enter or a double click turns it into a field to type in,
	 * set in the same face at the same width; while typing, a row under the toolbar
	 * inserts the fields that read the chart. Escape, or the focus leaving, keeps what
	 * was typed.
	 *
	 * The knob over it turns it about its centre (Shift holds it to the right angles),
	 * as does the toolbar's quarter turn. Turned, it is drawn turned; typed in, it
	 * stands upright for as long as the typing lasts.
	 *
	 * A table (`text.table`) is such a block whose words are read from its chart:
	 * nothing in it is typed. Its toolbar says what it lists (Messier objects, the
	 * brightest stars) and in how many rows, in place of bold, italic and alignment.
	 *
	 * On a page with two charts or more a text with fields says which one it reads:
	 * the nearest unless it is told a chart by its number, which the page shows on the
	 * charts meanwhile.
	 */
	import { tick } from 'svelte';
	import { rotatedBounds } from '$lib/document/geometry';
	import {
		anchoredFrame,
		FONT_FAMILY,
		hasFields,
		LINE_HEIGHT,
		MAX_TEXT_CHARS,
		stepTextSize,
		TEXT_ALIGNS,
		TEXT_FIELDS,
		type FieldName
	} from '$lib/document/text';
	import {
		MAX_TABLE_ROWS,
		MIN_TABLE_ROWS,
		lookOf,
		TABLE_LANGUAGES,
		TABLE_LOOK_NAMES,
		TABLE_LOOKS,
		TABLE_SOURCE_NAMES,
		TABLE_SOURCES,
		tableName
	} from '$lib/document/table';
	import { measuredLayout, shownLayout } from '$lib/document/text-fonts.svelte';
	import type { DocPage, Rect, TableSpec, TextStyle, TypesetBlock } from '$lib/document/types';
	import type { ItemState } from './EditorItem.svelte';
	import type { Size } from './editor-geometry';
	import TextLines from './TextLines.svelte';

	interface Props {
		text: TypesetBlock;
		/** What it shows: its words with the fields read from its chart. */
		shown: string;
		/** Its page: a table lists what is on a chart of it. */
		sheet: Pick<DocPage, 'blocks'>;
		/** The document: a block may read a chart on another page than its own. */
		pages?: readonly Pick<DocPage, 'blocks'>[];
		/** The charts on the other pages, to read one of them: each by its id, and what to call it. */
		others?: readonly { id: string; label: string }[];
		/** The id of the chart on another page it reads, if it reads one there. */
		readsOther?: string | null;
		/** 0-based position among the page's texts, for the accessible name. */
		index: number;
		count: number;
		/** The page, mm. */
		page: Size;
		/** Screen px per mm. */
		scale: number;
		/** Where to draw it, mm on its page; off the page while it is dragged to another. */
		frame: Rect;
		/** Degrees it is drawn turned, clockwise about its centre. */
		rotation?: number;
		/** It is being turned by its knob: the angle is read out. */
		turning?: boolean;
		/** On the current page: focusable, editable, with its toolbar. Elsewhere it can still be dragged. */
		interactive: boolean;
		mode?: ItemState;
		/** Another block is being carried: this one puts its frame and controls away. */
		quiet?: boolean;
		/** It is being typed in. */
		editing?: boolean;
		/** How many charts its page has: with two or more, the text says which it reads. */
		charts?: number;
		/** 0-based position on the page of the chart its fields read, null with none. */
		reads?: number | null;
		/** It was told that chart; else it reads it for being the nearest. */
		pinned?: boolean;
		/** Id of the element that explains the keys. */
		hintId?: string;
		/**
		 * Read chart `chart` of its page (0-based) whatever is nearer, the chart of
		 * another page with that id, or with null the nearest again.
		 */
		onbind?: (text: TypesetBlock, chart: number | string | null) => void;
		/** A table lists something else, or in more or fewer rows. */
		ontable?: (text: TypesetBlock, table: TableSpec) => void;
		onmovestart?: (event: PointerEvent, text: TypesetBlock) => void;
		onresizestart?: (event: PointerEvent, text: TypesetBlock, side: TextSide) => void;
		onrotatestart?: (event: PointerEvent, text: TypesetBlock) => void;
		/** A quarter turn clockwise. */
		onturn?: (text: TypesetBlock) => void;
		onkeydown?: (event: KeyboardEvent, text: TypesetBlock) => void;
		onstyle?: (text: TypesetBlock, style: TextStyle) => void;
		onremove?: (text: TypesetBlock) => void;
		/** Start typing in it. */
		onedit?: (text: TypesetBlock) => void;
		/** Typing is over: what it says now. */
		oncommit?: (text: TypesetBlock, value: string) => void;
		/** Its lines are this tall now, mm. */
		onheight?: (text: TypesetBlock, height: number) => void;
	}

	let {
		text,
		shown,
		sheet,
		pages,
		others = [],
		readsOther = null,
		index,
		count,
		page,
		scale,
		frame,
		rotation = 0,
		turning = false,
		interactive,
		mode = 'idle',
		quiet = false,
		editing = false,
		charts = 0,
		reads = null,
		pinned = false,
		hintId,
		onbind,
		ontable,
		onmovestart,
		onresizestart,
		onrotatestart,
		onturn,
		onkeydown,
		onstyle,
		onremove,
		onedit,
		oncommit,
		onheight
	}: Props = $props();

	const SIDES: readonly TextSide[] = ['w', 'e'];
	/** The knob that turns the text: its size, and how far its far edge stands off the text, px (as in the CSS). */
	const KNOB_PX = 16;
	const KNOB_REACH_PX = 24;
	/** Between the text (or its knob) and the toolbar, px. */
	const TOOLS_GAP_PX = 10;
	const ALIGN_ICONS = {
		left: 'M3 4.5h10M3 8h6.5M3 11.5h8.5',
		center: 'M3 4.5h10M4.75 8h6.5M3.75 11.5h8.5',
		right: 'M3 4.5h10M6.5 8H13M4.5 11.5H13'
	} as const;

	let bodyEl = $state<HTMLElement>();
	let inputEl = $state<HTMLTextAreaElement>();
	/** What the field holds while typing. */
	let draft = $state('');

	// Typing shows the words as they were typed, fields by their names.
	const layout = $derived(
		editing ? measuredLayout(draft, text.style, frame.w) : shownLayout(sheet, text, frame.w, pages)
	);
	const style = $derived(text.style);
	const table = $derived(text.kind === 'table' ? text.table : undefined);
	const name = $derived.by(() => {
		if (table) return `Table ${index + 1} of ${count}: ${tableName(table)}`;
		const words = shown.replace(/\s+/g, ' ').trim();
		const start = words.length > 60 ? `${words.slice(0, 60)}…` : words;
		return `Text ${index + 1} of ${count}: ${start}`;
	});
	const smaller = $derived(stepTextSize(style.size, -1));
	const larger = $derived(stepTextSize(style.size, 1));
	/** Which chart it reads is a question only with fields to read and two charts to choose from. */
	const chooses = $derived(
		(charts >= 2 || others.length > 0) &&
			(text.kind === 'table' || hasFields(editing ? draft : text.text))
	);
	/** Low on the page, the toolbar goes above the text: under it, it would leave the stage. */
	/** Typed in, it stands upright where it is. */
	const turn = $derived(editing ? 0 : rotation);
	/**
	 * Where it is drawn: as tall as its lines, from its own top-left corner, which
	 * stays put on the page as the lines come and go, whichever way it is turned.
	 */
	const box = $derived(
		turn === 0 ? { ...frame, h: layout.height } : anchoredFrame(frame, turn, frame.w, layout.height)
	);
	/** What it takes up on the page, turned: the toolbar stands clear of that. */
	const bounds = $derived(rotatedBounds(box, turn));
	const toolsAbove = $derived(bounds.y + bounds.h > page.h * 0.72);
	/**
	 * How far the text reaches up and down from its centre on the screen, px, the knob
	 * on its stalk included: the knob stands off the text's own top, which the turn
	 * may have pointing anywhere. The toolbar and the readout stand clear of both.
	 */
	const reach = $derived.by(() => {
		const half = (bounds.h * scale) / 2;
		const angle = (turn * Math.PI) / 180;
		const knob = interactive && !editing ? (box.h * scale) / 2 + KNOB_REACH_PX : 0;
		// Its middle, and half its width when it lies to the side of the stalk.
		const tip = knob * Math.cos(angle);
		const spread = (KNOB_PX / 2) * Math.abs(Math.sin(angle));
		return { up: Math.max(half, tip + spread), down: Math.max(half, -tip + spread) };
	});
	const offsetAbove = $derived(`calc(50% + ${reach.up + TOOLS_GAP_PX}px)`);
	const offsetBelow = $derived(`calc(50% + ${reach.down + TOOLS_GAP_PX}px)`);

	// The frame's height is the lines': kept up to date for whoever needs the box.
	$effect(() => {
		if (mode !== 'idle' || editing) return;
		const height = layout.height;
		if (Math.abs(height - text.frame.h) > 0.01) onheight?.(text, height);
	});

	// Typing begins: the field takes the words and the focus.
	let wasEditing = false;
	$effect(() => {
		if (editing === wasEditing) return;
		wasEditing = editing;
		if (!editing) return;
		draft = text.kind === 'text' ? text.text : '';
		void tick().then(() => {
			const input = inputEl;
			if (!input) return;
			input.focus({ preventScroll: true });
			input.select();
		});
	});

	/** As for a chart's tools: a pointer click counts only on the control it was pressed on. */
	let pressed: EventTarget | null = null;

	function pressedHere(event: MouseEvent): boolean {
		const here = event.detail === 0 || pressed === event.currentTarget;
		pressed = null;
		return here;
	}

	/** A press on a tool keeps the focus where it is: the toolbar stays, typing goes on. */
	function handleToolPointerDown(event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		pressed = event.currentTarget;
	}

	function handleBodyPointerDown(event: PointerEvent) {
		pressed = null;
		onmovestart?.(event, text);
	}

	function restyle(event: MouseEvent, patch: Partial<TextStyle>) {
		if (pressedHere(event)) onstyle?.(text, { ...style, ...patch });
	}

	function nextAlign() {
		return TEXT_ALIGNS[(TEXT_ALIGNS.indexOf(style.align) + 1) % TEXT_ALIGNS.length];
	}

	function insertField(event: MouseEvent, field: FieldName) {
		const input = inputEl;
		if (!pressedHere(event) || !input) return;
		input.setRangeText(`{${field}}`, input.selectionStart, input.selectionEnd, 'end');
		draft = input.value;
		input.focus({ preventScroll: true });
	}

	function bind(event: MouseEvent, chart: number | null) {
		if (pressedHere(event)) onbind?.(text, chart);
	}

	/** A chart on another page, chosen from the list; the focus goes back to the text. */
	function bindOther(event: Event) {
		const chosen = (event.currentTarget as HTMLSelectElement).value;
		if (chosen !== '') onbind?.(text, chosen);
		bodyEl?.focus({ preventScroll: true });
	}

	function retable(event: MouseEvent, patch: Partial<TableSpec>) {
		if (pressedHere(event) && table) ontable?.(text, { ...table, ...patch });
	}

	function commit() {
		if (editing) oncommit?.(text, draft);
	}

	/** Keys in the field are its own: none reaches the editor's shortcuts behind it. */
	function handleInputKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		const done =
			event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey));
		if (!done) return;
		event.preventDefault();
		// Back on the text, which the keys then move: the field's blur keeps what was typed.
		bodyEl?.focus({ preventScroll: true });
	}
</script>

<div
	class="text"
	class:is-interactive={interactive}
	class:is-quiet={quiet}
	class:is-editing={editing}
	data-item-id={text.id}
	data-kind="text"
	data-state={mode}
	style:left="{(box.x / page.w) * 100}%"
	style:top="{(box.y / page.h) * 100}%"
	style:width="{(box.w / page.w) * 100}%"
	style:height="{(box.h / page.h) * 100}%"
>
	{#if interactive}
		<div class="turn" style:rotate="{turn}deg">
			<div
				bind:this={bodyEl}
				class="body"
				role="button"
				tabindex="0"
				aria-roledescription={table ? 'table' : 'text'}
				aria-label={name}
				aria-describedby={hintId}
				aria-keyshortcuts="Enter ArrowLeft ArrowRight ArrowUp ArrowDown = - R PageUp PageDown Delete"
				onpointerdown={handleBodyPointerDown}
				ondblclick={() => {
					if (!table) onedit?.(text);
				}}
				onkeydown={(event) => onkeydown?.(event, text)}
			>
				<TextLines {layout} {style} width={frame.w} />
			</div>
			{#if editing}
				<textarea
					bind:this={inputEl}
					bind:value={draft}
					class="input"
					aria-label="Text {index + 1}"
					maxlength={MAX_TEXT_CHARS}
					spellcheck="false"
					autocapitalize="sentences"
					style:font-family="'{FONT_FAMILY[style.font]}', {style.font === 'serif'
						? 'serif'
						: 'sans-serif'}"
					style:font-size="{layout.size * scale}px"
					style:line-height={LINE_HEIGHT}
					style:font-weight={style.bold ? 700 : 400}
					style:font-style={style.italic ? 'italic' : 'normal'}
					style:text-align={style.align}
					onkeydown={handleInputKeydown}
					onpointerdown={(event) => event.stopPropagation()}
					onblur={commit}></textarea>
			{:else}
				{#each SIDES as side (side)}
					<!-- Pointer only: the width is the text's own to keep from the keyboard. -->
					<span
						class="handle"
						data-handle={side}
						aria-hidden="true"
						onpointerdown={(event) => onresizestart?.(event, text, side)}
					></span>
				{/each}
				<!-- Pointer only: the toolbar turns it by quarters, as R does. -->
				<span
					class="knob"
					aria-hidden="true"
					onpointerdown={(event) => onrotatestart?.(event, text)}
				>
					<svg viewBox="0 0 16 16">
						<path d="M12.5 8a4.5 4.5 0 1 1-1.6-3.45M12.75 2.5v2.75H10" />
					</svg>
				</span>
			{/if}
		</div>
		{#if turning}
			<span class="readout" aria-hidden="true" style:top={offsetBelow}>{Math.round(rotation)}°</span
			>
		{/if}
		<div
			class="tools"
			role="group"
			aria-label="Text {index + 1}"
			style:top={toolsAbove ? 'auto' : offsetBelow}
			style:bottom={toolsAbove ? offsetAbove : 'auto'}
		>
			<div class="row">
				<button
					class="tool is-wide"
					type="button"
					tabindex="-1"
					aria-label="Font: {style.font === 'serif' ? 'serif' : 'sans serif'}. Change"
					title="Font"
					onpointerdown={handleToolPointerDown}
					onclick={(event) => restyle(event, { font: style.font === 'serif' ? 'sans' : 'serif' })}
				>
					{style.font === 'serif' ? 'Serif' : 'Sans'}
				</button>
				<span class="tool-divider" aria-hidden="true"></span>
				<button
					class="tool"
					type="button"
					tabindex="-1"
					aria-label="Smaller type"
					title="Smaller · −"
					disabled={smaller === null}
					onpointerdown={handleToolPointerDown}
					onclick={(event) => smaller !== null && restyle(event, { size: smaller })}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8h7" /></svg>
				</button>
				<span class="size" aria-label="{style.size} points">{style.size}</span>
				<button
					class="tool"
					type="button"
					tabindex="-1"
					aria-label="Larger type"
					title="Larger · +"
					disabled={larger === null}
					onpointerdown={handleToolPointerDown}
					onclick={(event) => larger !== null && restyle(event, { size: larger })}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8h7M8 4.5v7" /></svg>
				</button>
				<span class="tool-divider" aria-hidden="true"></span>
				{#if !table}
					<button
						class="tool is-letter"
						type="button"
						tabindex="-1"
						aria-label="Bold"
						aria-pressed={style.bold}
						title="Bold"
						onpointerdown={handleToolPointerDown}
						onclick={(event) => restyle(event, { bold: !style.bold })}
					>
						<b>B</b>
					</button>
					<button
						class="tool is-letter"
						type="button"
						tabindex="-1"
						aria-label="Italic"
						aria-pressed={style.italic}
						title="Italic"
						onpointerdown={handleToolPointerDown}
						onclick={(event) => restyle(event, { italic: !style.italic })}
					>
						<i>I</i>
					</button>
					<button
						class="tool"
						type="button"
						tabindex="-1"
						aria-label="Aligned {style.align}. Change"
						title="Alignment"
						onpointerdown={handleToolPointerDown}
						onclick={(event) => restyle(event, { align: nextAlign() })}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d={ALIGN_ICONS[style.align]} /></svg>
					</button>
				{/if}
				<button
					class="tool"
					type="button"
					tabindex="-1"
					aria-label="Turn a quarter clockwise"
					title="Turn · R"
					onpointerdown={handleToolPointerDown}
					onclick={(event) => {
						if (pressedHere(event)) onturn?.(text);
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M12.5 8a4.5 4.5 0 1 1-1.6-3.45M12.75 2.5v2.75H10" />
					</svg>
				</button>
				<span class="tool-divider" aria-hidden="true"></span>
				<button
					class="tool"
					type="button"
					tabindex="-1"
					aria-label="Remove text {index + 1}"
					title="Remove · Delete"
					onpointerdown={handleToolPointerDown}
					onclick={(event) => {
						if (pressedHere(event)) onremove?.(text);
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.75 7v3.5M9.25 7v3.5" />
					</svg>
				</button>
			</div>
			{#if table}
				<div class="row fields is-table" role="group" aria-label="What the table lists">
					{#each TABLE_SOURCES as source (source)}
						<button
							class="field"
							type="button"
							tabindex="-1"
							aria-pressed={table.source === source}
							onpointerdown={handleToolPointerDown}
							onclick={(event) => retable(event, { source })}
						>
							{TABLE_SOURCE_NAMES[source]}
						</button>
					{/each}
					<span class="tool-divider" aria-hidden="true"></span>
					{#each TABLE_LOOKS as look (look)}
						<button
							class="field"
							type="button"
							tabindex="-1"
							aria-pressed={lookOf(table) === look}
							title={look === 'names'
								? 'The names alone, three to a row'
								: 'A row an object, with what is known of it'}
							onpointerdown={handleToolPointerDown}
							onclick={(event) => retable(event, { look })}
						>
							{TABLE_LOOK_NAMES[look]}
						</button>
					{/each}
				</div>
				<div class="row fields is-table" role="group" aria-label="Rows of the table">
					<button
						class="tool"
						type="button"
						tabindex="-1"
						aria-label="Fewer rows"
						title="Fewer rows"
						disabled={table.rows <= MIN_TABLE_ROWS}
						onpointerdown={handleToolPointerDown}
						onclick={(event) => retable(event, { rows: table.rows - 1 })}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8h7" /></svg>
					</button>
					<span class="size is-rows" aria-label="{table.rows} rows">{table.rows} rows</span>
					<button
						class="tool"
						type="button"
						tabindex="-1"
						aria-label="More rows"
						title="More rows"
						disabled={table.rows >= MAX_TABLE_ROWS}
						onpointerdown={handleToolPointerDown}
						onclick={(event) => retable(event, { rows: table.rows + 1 })}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8h7M8 4.5v7" /></svg>
					</button>
					<span class="tool-divider" aria-hidden="true"></span>
					{#each TABLE_LANGUAGES as language (language)}
						<button
							class="field"
							type="button"
							tabindex="-1"
							aria-pressed={(table.language ?? 'en') === language}
							aria-label={language === 'ru' ? 'Russian' : 'English'}
							title={language === 'ru' ? 'Its words in Russian' : 'Its words in English'}
							onpointerdown={handleToolPointerDown}
							onclick={(event) => retable(event, { language })}
						>
							{language.toUpperCase()}
						</button>
					{/each}
				</div>
			{/if}
			{#if chooses}
				<div class="row fields" role="group" aria-label="The chart the fields read">
					<span class="row-label" aria-hidden="true">Reads</span>
					<button
						class="field"
						type="button"
						tabindex="-1"
						aria-pressed={!pinned && readsOther === null}
						aria-label="Read the nearest chart{reads !== null ? `, now chart ${reads + 1}` : ''}"
						title="The chart nearest to the text"
						onpointerdown={handleToolPointerDown}
						onclick={(event) => bind(event, null)}
					>
						Nearest{!pinned && reads !== null ? ` · ${reads + 1}` : ''}
					</button>
					{#each { length: charts }, chart (chart)}
						<button
							class="field is-number"
							type="button"
							tabindex="-1"
							aria-pressed={pinned && reads === chart}
							aria-label="Read chart {chart + 1}"
							title="Chart {chart + 1}"
							onpointerdown={handleToolPointerDown}
							onclick={(event) => bind(event, chart)}
						>
							{chart + 1}
						</button>
					{/each}
					{#if others.length > 0}
						<!-- Charts of the other pages: a table on a page of its own reads its sky from there. -->
						<select
							class="field other"
							class:is-chosen={readsOther !== null}
							tabindex="-1"
							aria-label="Read a chart on another page"
							value={readsOther ?? ''}
							onpointerdown={(event) => event.stopPropagation()}
							onchange={bindOther}
						>
							<option value="" disabled>Other page…</option>
							{#each others as other (other.id)}
								<option value={other.id}>{other.label}</option>
							{/each}
						</select>
					{/if}
				</div>
			{/if}
			{#if editing}
				<div class="row fields" role="group" aria-label="Insert a field of the chart">
					{#each TEXT_FIELDS as field (field.name)}
						<button
							class="field"
							type="button"
							tabindex="-1"
							title={`{${field.name}}${field.precise ? ` · {${field.name}:1} or :2 for decimals` : ''}`}
							onpointerdown={handleToolPointerDown}
							onclick={(event) => insertField(event, field.name)}
						>
							{field.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<!-- A neighbour's text: not focusable, but it can be grabbed and dropped on another page. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="turn" style:rotate="{turn}deg">
			<div class="body is-grabbable" onpointerdown={handleBodyPointerDown}>
				<TextLines {layout} {style} width={frame.w} />
			</div>
		</div>
	{/if}
</div>

<style>
	.text {
		--lift: 0 8px 20px rgba(0, 0, 0, 0.3);
		position: absolute;
		box-sizing: border-box;
		/* Text is drawn over the charts, as it prints. */
		z-index: 1;
	}

	.text.is-interactive:focus-within,
	.text:not([data-state='idle']) {
		z-index: 3;
	}

	.text[data-state='returning'] {
		transition:
			left 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
			top 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	/*
	 * In the hand, or made wider or narrower: on a layer of its own. Painted on the
	 * paper's, every frame of it leaves the paper to repaint what it gave up, and in
	 * Safari, with the page zoomed to anything but a whole number of pixels, the edge
	 * of each such repaint is left behind as a hairline down the page.
	 */
	.text[data-state='moving'],
	.text[data-state='detached'],
	.text[data-state='resizing'] {
		will-change: transform;
	}

	/* In the hand it is a slip of paper: off the page its words would lie on the dark. */
	.text[data-state='moving'] .body,
	.text[data-state='detached'] .body {
		background: var(--paper);
		box-shadow: var(--lift);
		cursor: grabbing;
	}

	.text[data-state='settling'] .body,
	.text[data-state='returning'] .body {
		background: var(--paper);
		animation: land 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}

	@keyframes land {
		from {
			box-shadow: var(--lift);
		}

		to {
			box-shadow: 0 0 0 rgba(0, 0, 0, 0);
		}
	}

	.text[data-state='detached'] {
		opacity: 0.6;
	}

	/* What turns: the words, the field, the handles. The toolbar stays upright. */
	.turn {
		position: absolute;
		inset: 0;
	}

	.body {
		position: absolute;
		inset: 0;
		border-radius: 1px;
		user-select: none;
		-webkit-user-select: none;
	}

	.body.is-grabbable,
	.is-interactive .body {
		cursor: grab;
		touch-action: none;
		-webkit-tap-highlight-color: transparent;
	}

	/* The frame: a little clear of the letters, shown on hover and while selected. */
	.is-interactive .body::after {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 2px;
		box-shadow: inset 0 0 0 1px var(--paper-edge);
		opacity: 0;
		transition: opacity var(--ease-ui);
		pointer-events: none;
	}

	.is-interactive:focus-within .body::after,
	.text[data-state='resizing'] .body::after {
		opacity: 1;
	}

	.body:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 5px;
		box-shadow: var(--ring-paper);
	}

	/* The field lies exactly over the lines it replaces, in their face and size. */
	.is-editing .body :global(svg) {
		visibility: hidden;
	}

	.input {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 0;
		border-radius: 0;
		outline: none;
		background: transparent;
		color: var(--ink);
		caret-color: var(--accent);
		font-kerning: normal;
		letter-spacing: 0;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		resize: none;
		appearance: none;
	}

	/* Round knobs on the two sides: the width is all a text's frame has to set. */
	.handle {
		position: absolute;
		z-index: 2;
		top: 50%;
		width: 20px;
		height: 28px;
		margin-top: -14px;
		opacity: 0;
		pointer-events: none;
		cursor: ew-resize;
		touch-action: none;
		transition: opacity var(--ease-ui);
		-webkit-tap-highlight-color: transparent;
	}

	.handle::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 8px;
		height: 8px;
		margin: -5px;
		border: 1px solid var(--ink);
		border-radius: 50%;
		background: #ffffff;
	}

	.handle[data-handle='w'] {
		left: -13px;
	}

	/* The knob that turns it, on a stalk over the middle of its top. */
	.knob {
		position: absolute;
		z-index: 2;
		bottom: 100%;
		left: 50%;
		width: 24px;
		height: 24px;
		margin-left: -12px;
		opacity: 0;
		pointer-events: none;
		cursor: grab;
		touch-action: none;
		transition: opacity var(--ease-ui);
		-webkit-tap-highlight-color: transparent;
	}

	/* The stalk: just enough to say what the knob belongs to. */
	.knob::before {
		content: '';
		position: absolute;
		bottom: 3px;
		left: 50%;
		width: 1px;
		height: 5px;
		margin-left: -0.5px;
		background: var(--paper-edge);
	}

	/* A turning arrow, in the ink of the other handles; on white, so it reads over a chart too. */
	.knob svg {
		position: absolute;
		top: 0;
		left: 50%;
		box-sizing: border-box;
		width: 16px;
		height: 16px;
		margin-left: -8px;
		padding: 1px;
		border-radius: 50%;
		background: #ffffff;
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.text[data-state='resizing'] .knob {
		cursor: grabbing;
	}

	/* The angle while it is turned, where the toolbar is otherwise. */
	.readout {
		position: absolute;
		z-index: 4;
		left: 50%;
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

	.handle[data-handle='e'] {
		right: -13px;
	}

	@media (hover: hover) {
		.is-interactive:hover .handle,
		.is-interactive:hover .knob,
		.is-interactive:hover .body::after {
			opacity: 1;
		}

		.is-interactive:hover .handle,
		.is-interactive:hover .knob {
			pointer-events: auto;
		}
	}

	.is-interactive:focus-within .handle,
	.is-interactive:focus-within .knob,
	.text[data-state='resizing'] .knob,
	.text[data-state='resizing'] .handle {
		opacity: 1;
		pointer-events: auto;
	}

	/* Carried, a text is its words on their slip; while one is carried, the others go quiet. */
	.text:not([data-state='idle'], [data-state='resizing']) .handle,
	.text:not([data-state='idle'], [data-state='resizing']) .knob,
	.text:not([data-state='idle'], [data-state='resizing']) .body::after,
	.text.is-quiet .handle,
	.text.is-quiet .knob,
	.text.is-quiet .body::after {
		opacity: 0;
		pointer-events: none;
		transition: none;
	}

	@media (pointer: coarse) {
		.handle {
			width: 36px;
			height: 40px;
			margin-top: -20px;
		}

		.handle[data-handle='w'] {
			left: -21px;
		}

		.handle[data-handle='e'] {
			right: -21px;
		}

		.tool {
			width: 36px;
			height: 36px;
		}
	}

	/* Under the text (over it, low on the page): the text's own controls, in the dark of a chart's. */
	.tools {
		position: absolute;
		z-index: 4;
		left: 50%;
		display: none;
		flex-direction: column;
		gap: 2px;
		padding: 2px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		background: rgba(24, 24, 27, 0.92);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		transform: translateX(-50%);
	}

	.text.is-interactive[data-state='idle']:focus-within .tools {
		display: flex;
	}

	.text.is-interactive.is-quiet[data-state='idle']:focus-within .tools {
		display: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.tool {
		display: grid;
		flex: none;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: #eceef1;
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.tool.is-wide {
		width: auto;
		min-width: 44px;
		padding: 0 8px;
	}

	.tool.is-letter {
		font:
			400 14px/1 'PT Serif',
			Georgia,
			serif;
	}

	.tool[aria-pressed='true'],
	.field[aria-pressed='true'] {
		background: rgba(255, 255, 255, 0.18);
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
		.tool:not(:disabled):hover,
		.field:hover {
			background: rgba(255, 255, 255, 0.1);
		}
	}

	.tool:not(:disabled):active,
	.field:active {
		background: rgba(255, 255, 255, 0.16);
	}

	.tool:disabled {
		color: rgba(236, 238, 241, 0.4);
		cursor: default;
	}

	.tool:focus-visible,
	.field:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7);
	}

	.size {
		min-width: 20px;
		color: #eceef1;
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.size.is-rows {
		min-width: 52px;
	}

	/* The list of the other pages' charts: a chip like its neighbours, the browser's own list behind it. */
	.field.other {
		max-width: 132px;
		appearance: none;
		text-overflow: ellipsis;
	}

	.field.other.is-chosen {
		background: rgba(255, 255, 255, 0.18);
	}

	.field.other option {
		color: initial;
	}

	.tool-divider {
		flex: none;
		width: 1px;
		height: 16px;
		margin: 0 2px;
		background: rgba(255, 255, 255, 0.14);
	}

	/* What a table lists and its rows, on one line. */
	.fields.is-table {
		flex-wrap: nowrap;
		max-width: none;
	}

	.fields {
		flex-wrap: wrap;
		max-width: 296px;
		padding-top: 2px;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.field {
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #eceef1;
		font:
			400 12px/1 Inter,
			system-ui,
			sans-serif;
		white-space: nowrap;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	.field.is-number {
		min-width: 24px;
		padding: 0 6px;
		font-variant-numeric: tabular-nums;
	}

	.row-label {
		padding: 0 4px 0 8px;
		color: rgba(236, 238, 241, 0.6);
		font:
			400 12px/1 Inter,
			system-ui,
			sans-serif;
	}

	@media (forced-colors: active) {
		.is-interactive .body::after {
			box-shadow: none;
			outline: 1px solid CanvasText;
		}

		.tools {
			border: 1px solid ButtonText;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.text[data-state='returning'] {
			transition: none;
		}

		.handle,
		.knob,
		.is-interactive .body::after {
			transition: none;
		}
	}
</style>
