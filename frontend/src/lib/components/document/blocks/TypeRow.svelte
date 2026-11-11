<script lang="ts">
	/**
	 * The first row of a text's or a table's toolbar: the font, the size of the type,
	 * a quarter turn and Remove. What only a text has (bold, italic, the alignment)
	 * stands between the size and the turn (`children`).
	 */
	import type { Snippet } from 'svelte';
	import { stepTextSize } from '$lib/document/text';
	import type { TextStyle, TypesetBlock } from '$lib/document/types';
	import type { BlockActions } from '../editor/actions';
	import { ICONS } from './icons';
	import Tool from './Tool.svelte';

	interface Props {
		block: TypesetBlock;
		/** 1-based, as the block is named. */
		number: number;
		blocks: BlockActions;
		children?: Snippet;
	}

	let { block, number, blocks, children }: Props = $props();

	const style = $derived(block.style);
	const serif = $derived(style.font === 'serif');
	const smaller = $derived(stepTextSize(style.size, -1));
	const larger = $derived(stepTextSize(style.size, 1));

	function restyle(patch: Partial<TextStyle>) {
		blocks.restyle(block, { ...style, ...patch });
	}
</script>

<div class="row">
	<Tool
		label="Font: {serif ? 'serif' : 'sans serif'}. Change"
		title="Font"
		wide
		onpress={() => restyle({ font: serif ? 'sans' : 'serif' })}
	>
		{serif ? 'Serif' : 'Sans'}
	</Tool>
	<span class="tool-divider" aria-hidden="true"></span>
	<Tool
		label="Smaller type"
		title="Smaller · −"
		disabled={smaller === null}
		icon={ICONS.minus}
		onpress={() => smaller !== null && restyle({ size: smaller })}
	/>
	<span class="size" aria-label="{style.size} points">{style.size}</span>
	<Tool
		label="Larger type"
		title="Larger · +"
		disabled={larger === null}
		icon={ICONS.plus}
		onpress={() => larger !== null && restyle({ size: larger })}
	/>
	<span class="tool-divider" aria-hidden="true"></span>
	{@render children?.()}
	<Tool
		label="Turn a quarter clockwise"
		title="Turn · R"
		icon={ICONS.turn}
		onpress={() => blocks.turn(block)}
	/>
	<span class="tool-divider" aria-hidden="true"></span>
	<Tool
		label="Remove text {number}"
		title="Remove · Delete"
		icon={ICONS.bin}
		onpress={() => blocks.remove(block)}
	/>
</div>
