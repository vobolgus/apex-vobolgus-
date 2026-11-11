<script lang="ts">
	/** While a text is typed in: the fields of the chart it reads, to put in where the caret is. */
	import { TEXT_FIELDS } from '$lib/document/text';
	import Chip from './Chip.svelte';
	import type { Typing } from './typing.svelte';

	interface Props {
		typing: Typing;
	}

	let { typing }: Props = $props();
</script>

<div class="row fields" role="group" aria-label="Insert a field of the chart">
	{#each TEXT_FIELDS as field (field.name)}
		<Chip
			title={`{${field.name}}${field.precise ? ` · {${field.name}:1} or :2 for decimals` : ''}`}
			onpress={() => typing.insert(field.name)}
		>
			{field.label}
		</Chip>
	{/each}
</div>
