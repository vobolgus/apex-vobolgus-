<script lang="ts">
	/**
	 * A text's lines, drawn as the PDF sets them: one SVG `<text>` a line at its
	 * baseline, in the same font. Fills its box, which has the layout's proportions.
	 * Decorative: whatever holds it carries the words.
	 */
	import { alignAnchor, FONT_FAMILY, type TextLayout } from '$lib/document/text';
	import type { TextStyle } from '$lib/document/types';

	interface Props {
		layout: TextLayout;
		style: TextStyle;
		/** The column's width, mm. */
		width: number;
	}

	let { layout, style, width }: Props = $props();

	/**
	 * User units per mm. A font size of a few units (mm) is under the smallest size
	 * some browsers will set type in; ten times that is not.
	 */
	const K = 10;

	const anchor = $derived(alignAnchor(style.align, width));
</script>

<svg
	viewBox="0 0 {width * K} {layout.height * K}"
	preserveAspectRatio="xMinYMin meet"
	font-family="'{FONT_FAMILY[style.font]}', {style.font === 'serif' ? 'serif' : 'sans-serif'}"
	font-size={layout.size * K}
	font-weight={style.bold ? 700 : 400}
	font-style={style.italic ? 'italic' : 'normal'}
	text-anchor={anchor.anchor}
	aria-hidden="true"
>
	{#each layout.lines as line, index (index)}
		{#if line.text !== ''}
			<text x={anchor.x * K} y={line.baseline * K}>{line.text}</text>
		{/if}
	{/each}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
		fill: var(--ink);
		pointer-events: none;
		user-select: none;
		-webkit-user-select: none;
	}

	/* The spaces that begin a paragraph, or come in a row, are the text's own. */
	text {
		white-space: pre;
	}
</style>
