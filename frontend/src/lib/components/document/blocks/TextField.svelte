<script lang="ts">
	/**
	 * The field a text is typed in, laid exactly over the lines it replaces, in their
	 * face and size, so the words stay where they were. Keys in it are its own: none
	 * reaches the editor's shortcuts behind it. Escape, or ⌘/Ctrl Enter, is done.
	 */
	import { FONT_FAMILY, LINE_HEIGHT, MAX_TEXT_CHARS } from '$lib/document/text';
	import type { TextStyle } from '$lib/document/types';
	import type { Typing } from './typing.svelte';

	interface Props {
		typing: Typing;
		style: TextStyle;
		/** The type's size on the screen, px. */
		size: number;
		/** 1-based, as the text is named. */
		number: number;
		/** The focus left the field: keep what was typed. */
		onblur: () => void;
		/** Done typing: back on the text, which the keys then move (the blur keeps what was typed). */
		ondone: () => void;
	}

	let { typing, style, size, number, onblur, ondone }: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		const done =
			event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey));
		if (!done) return;
		event.preventDefault();
		ondone();
	}
</script>

<textarea
	bind:this={typing.input}
	bind:value={typing.draft}
	class="input"
	aria-label="Text {number}"
	maxlength={MAX_TEXT_CHARS}
	spellcheck="false"
	autocapitalize="sentences"
	style:font-family="'{FONT_FAMILY[style.font]}', {style.font === 'serif' ? 'serif' : 'sans-serif'}"
	style:font-size="{size}px"
	style:line-height={LINE_HEIGHT}
	style:font-weight={style.bold ? 700 : 400}
	style:font-style={style.italic ? 'italic' : 'normal'}
	style:text-align={style.align}
	onkeydown={handleKeydown}
	onpointerdown={(event) => event.stopPropagation()}
	{onblur}></textarea>

<style>
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
</style>
