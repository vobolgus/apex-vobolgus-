<script lang="ts">
	/** A text's own row of tools: the type's, with bold, italic and the alignment. */
	import { TEXT_ALIGNS } from '$lib/document/text';
	import type { TextBlock, TextStyle } from '$lib/document/types';
	import type { BlockActions } from '../editor/actions';
	import { ALIGN_ICONS } from './icons';
	import Tool from './Tool.svelte';
	import TypeRow from './TypeRow.svelte';

	interface Props {
		text: TextBlock;
		/** 1-based, as the text is named. */
		number: number;
		blocks: BlockActions;
	}

	let { text, number, blocks }: Props = $props();

	const style = $derived(text.style);

	function restyle(patch: Partial<TextStyle>) {
		blocks.restyle(text, { ...style, ...patch });
	}

	function nextAlign() {
		return TEXT_ALIGNS[(TEXT_ALIGNS.indexOf(style.align) + 1) % TEXT_ALIGNS.length];
	}
</script>

<TypeRow block={text} {number} {blocks}>
	<Tool
		label="Bold"
		title="Bold"
		pressed={style.bold}
		letter
		onpress={() => restyle({ bold: !style.bold })}
	>
		<b>B</b>
	</Tool>
	<Tool
		label="Italic"
		title="Italic"
		pressed={style.italic}
		letter
		onpress={() => restyle({ italic: !style.italic })}
	>
		<i>I</i>
	</Tool>
	<Tool
		label="Aligned {style.align}. Change"
		title="Alignment"
		icon={ALIGN_ICONS[style.align]}
		onpress={() => restyle({ align: nextAlign() })}
	/>
</TypeRow>
