<script lang="ts">
	/**
	 * A table's own rows of tools: the type's, then what it lists (Messier objects, the
	 * brightest stars) and how (the names alone, or a row an object), then in how many
	 * rows and in which language. Nothing in it is typed.
	 */
	import {
		lookOf,
		MAX_TABLE_ROWS,
		MIN_TABLE_ROWS,
		TABLE_LANGUAGES,
		TABLE_LOOK_NAMES,
		TABLE_LOOKS,
		TABLE_SOURCE_NAMES,
		TABLE_SOURCES
	} from '$lib/document/table';
	import { LANGUAGE_NAMES } from '$lib/document/labels';
	import type { TableBlock, TableSpec } from '$lib/document/types';
	import type { BlockActions } from '../editor/actions';
	import Chip from './Chip.svelte';
	import { ICONS } from './icons';
	import Tool from './Tool.svelte';
	import TypeRow from './TypeRow.svelte';

	interface Props {
		table: TableBlock;
		/** 1-based, as the table is named. */
		number: number;
		blocks: BlockActions;
	}

	let { table, number, blocks }: Props = $props();

	const spec = $derived(table.table);

	function retable(patch: Partial<TableSpec>) {
		blocks.setTable(table, { ...spec, ...patch });
	}
</script>

<TypeRow block={table} {number} {blocks} />
<div class="row fields is-table" role="group" aria-label="What the table lists">
	{#each TABLE_SOURCES as source (source)}
		<Chip pressed={spec.source === source} onpress={() => retable({ source })}>
			{TABLE_SOURCE_NAMES[source]}
		</Chip>
	{/each}
	<span class="tool-divider" aria-hidden="true"></span>
	{#each TABLE_LOOKS as look (look)}
		<Chip
			pressed={lookOf(spec) === look}
			title={look === 'names'
				? 'The names alone, three to a row'
				: 'A row an object, with what is known of it'}
			onpress={() => retable({ look })}
		>
			{TABLE_LOOK_NAMES[look]}
		</Chip>
	{/each}
</div>
<div class="row fields is-table" role="group" aria-label="Rows of the table">
	<Tool
		label="Fewer rows"
		title="Fewer rows"
		disabled={spec.rows <= MIN_TABLE_ROWS}
		icon={ICONS.minus}
		onpress={() => retable({ rows: spec.rows - 1 })}
	/>
	<span class="size is-rows" aria-label="{spec.rows} rows">{spec.rows} rows</span>
	<Tool
		label="More rows"
		title="More rows"
		disabled={spec.rows >= MAX_TABLE_ROWS}
		icon={ICONS.plus}
		onpress={() => retable({ rows: spec.rows + 1 })}
	/>
	<span class="tool-divider" aria-hidden="true"></span>
	{#each TABLE_LANGUAGES as language (language)}
		<Chip
			pressed={(spec.language ?? 'en') === language}
			label={LANGUAGE_NAMES[language]}
			title="Its words in {LANGUAGE_NAMES[language]}"
			onpress={() => retable({ language })}
		>
			{language.toUpperCase()}
		</Chip>
	{/each}
</div>
