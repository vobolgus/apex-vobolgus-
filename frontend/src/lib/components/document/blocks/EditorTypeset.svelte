<script lang="ts">
	/**
	 * One text or table on a page in the editor: its lines drawn as the PDF sets them,
	 * in the frame every block has, and on the current page its toolbar under it (over
	 * it, low on the page) and its angle while its knob turns it.
	 *
	 * Its width is the frame's; its height is the lines', so the frame's height is
	 * told to the store whenever the lines turn out taller or shorter (`setHeight`).
	 *
	 * Selected, it shows its toolbar: the font, the size, bold, italic, the alignment
	 * and Delete for a text; for a table, what it lists and in how many rows in place
	 * of bold, italic and alignment, for nothing in it is typed. Enter or a double click
	 * turns a text into a field to type in (`TextField`), set in the same face at the
	 * same width; while typing, a row under the toolbar inserts the fields that read
	 * the chart. Escape, or the focus leaving, keeps what was typed.
	 *
	 * Turned, it is drawn turned; typed in, it stands upright for as long as the typing
	 * lasts. On a page with two charts or more, or with charts on other pages, a block
	 * that reads a chart says which (`ReadsRow`).
	 */
	import { tableName } from '$lib/document/labels';
	import { shownText } from '$lib/document/text';
	import type { DocPage, Rect, TypesetBlock } from '$lib/document/types';
	import type { EditorActions } from '../editor/actions';
	import type { BlockState } from '../editor/drag-view';
	import type { Size } from '../editor/screen-geometry';
	import TextLines from '../TextLines.svelte';
	import { measuredLayout, shownLayout } from '../typeset.svelte';
	import BlockFrame from './BlockFrame.svelte';
	import BlockToolbar from './BlockToolbar.svelte';
	import FieldsRow from './FieldsRow.svelte';
	import ReadsRow from './ReadsRow.svelte';
	import Readout from './Readout.svelte';
	import TableToolbar from './TableToolbar.svelte';
	import TextField from './TextField.svelte';
	import TextToolbar from './TextToolbar.svelte';
	import { typePlacement } from './type-placement';
	import { Typing } from './typing.svelte';

	interface Props {
		block: TypesetBlock;
		/** Its page: a text's fields and a table's rows read a chart of it. */
		sheet: DocPage;
		/** The document: a block may read a chart on another page than its own. */
		pages: readonly DocPage[];
		/** 0-based position among the page's texts and tables, for the accessible name. */
		index: number;
		count: number;
		/** The page, mm. */
		page: Size;
		/** Screen px per mm. */
		scale: number;
		/** Where to draw it, mm on its page; off the page while it is dragged to another. */
		frame: Rect;
		/** Degrees it is drawn turned, clockwise about its centre. */
		rotation: number;
		/** It is being turned by its knob: the angle is read out. */
		turning: boolean;
		/** On the current page: focusable, editable, with its toolbar. Elsewhere it can still be dragged. */
		interactive: boolean;
		mode: BlockState;
		/** Another block is being carried: this one puts its frame and controls away. */
		quiet: boolean;
		/** It is being typed in. */
		editing: boolean;
		/** Id of the element that explains the keys. */
		hintId?: string;
		/** What the block asks of the editor: to be carried, made wider, turned, typed in, set, removed. */
		actions: EditorActions;
	}

	let {
		block,
		sheet,
		pages,
		index,
		count,
		page,
		scale,
		frame,
		rotation,
		turning,
		interactive,
		mode,
		quiet,
		editing,
		hintId,
		actions
	}: Props = $props();

	let body = $state<HTMLElement>();
	const words = $derived(block.kind === 'text' ? block.text : '');
	const typing = new Typing(
		() => editing,
		() => words
	);

	// Typing shows the words as they were typed, fields by their names.
	const layout = $derived(
		editing
			? measuredLayout(typing.draft, block.style, frame.w)
			: shownLayout(sheet, block, frame.w, pages)
	);
	const name = $derived.by(() => {
		if (block.kind === 'table') return `Table ${index + 1} of ${count}: ${tableName(block.table)}`;
		const shown = shownText(sheet, block, pages).replace(/\s+/g, ' ').trim();
		const start = shown.length > 60 ? `${shown.slice(0, 60)}…` : shown;
		return `Text ${index + 1} of ${count}: ${start}`;
	});
	/** Typed in, it stands upright where it is. */
	const turn = $derived(editing ? 0 : rotation);
	const placement = $derived(
		typePlacement(frame, layout.height, turn, page, scale, interactive && !editing)
	);

	// The frame's height is the lines': kept up to date for whoever needs the box.
	$effect(() => {
		if (mode !== 'idle' || editing) return;
		const height = layout.height;
		if (Math.abs(height - block.frame.h) > 0.01) actions.blocks.setHeight(block, height);
	});

	/** Back on the block, which the keys then move. */
	function refocus() {
		body?.focus({ preventScroll: true });
	}

	function commit() {
		if (editing && block.kind === 'text') actions.blocks.commitText(block, typing.draft);
	}
</script>

{#snippet field()}
	<TextField
		{typing}
		style={block.style}
		size={layout.size * scale}
		number={index + 1}
		onblur={commit}
		ondone={refocus}
	/>
{/snippet}

<BlockFrame
	{block}
	{page}
	box={placement.box}
	{mode}
	{interactive}
	{quiet}
	{name}
	{hintId}
	{turn}
	{editing}
	bind:body
	{actions}
	{field}
>
	<TextLines {layout} style={block.style} width={frame.w} />

	{#snippet upright()}
		{#if turning}
			<Readout top={placement.below}>{Math.round(rotation)}°</Readout>
		{/if}
		<BlockToolbar
			label="Text {index + 1}"
			top={placement.toolsAbove ? 'auto' : placement.below}
			bottom={placement.toolsAbove ? placement.above : 'auto'}
		>
			{#if block.kind === 'table'}
				<TableToolbar table={block} number={index + 1} blocks={actions.blocks} />
			{:else}
				<TextToolbar text={block} number={index + 1} blocks={actions.blocks} />
			{/if}
			<ReadsRow
				{block}
				page={sheet}
				{pages}
				words={editing ? typing.draft : words}
				blocks={actions.blocks}
				onpicked={refocus}
			/>
			{#if editing}
				<FieldsRow {typing} />
			{/if}
		</BlockToolbar>
	{/snippet}
</BlockFrame>
