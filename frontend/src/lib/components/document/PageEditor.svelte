<script lang="ts">
	/**
	 * The page editor: the previous, current and next page side by side over the
	 * dimmed app, a strip of every page below, ⊗ at the top right.
	 *
	 * A native modal `<dialog>`, like the About dialog: the top layer, the app behind
	 * it inert, the focus back where it was on close. It is open while `pageId` is set
	 * and calls `onclose` when it closes itself (Escape, ⊗, the backdrop); it moves
	 * between pages on its own and mirrors the current one in `store.selectedPageId`.
	 *
	 * A chart is carried by the pointer, free of the paper, and let go it settles on
	 * the page its centre is over or nearest to, snapped with `snapMove` (Shift held
	 * shows the lines it would snap to); out of reach of every page it goes back.
	 * Charts on the current page resize by their corners (`snapResize`, aspect locked).
	 * The store is written once, on release. From the keyboard a chart nudges by 1 mm
	 * (Shift: 10), + and − step its size, Page Up/Down move it to the page before or
	 * after, and Delete removes it; ←/→ elsewhere change the page. A selected chart's
	 * toolbar does the same without a drag.
	 *
	 * A page also holds text ("Add text" by its name). A text moves like a chart, from
	 * page to page too; its sides set its width and its height follows its lines; the
	 * knob over it turns it about its centre, Shift holding it to the right angles (R
	 * and the toolbar turn it by quarters). Enter
	 * or a double click types in it (Escape keeps what was typed), + and − step the
	 * type's size, and its toolbar sets the font, bold, italic and the alignment. Its
	 * fields read the chart nearest to it; on a page with several, the toolbar tells it
	 * another by number.
	 *
	 * The button by a page's name beside it lays the page out as a template
	 * (`TemplatePicker`): its charts placed again with a title and captions around
	 * them, on as many pages as that takes.
	 *
	 * A table ("Add a table") is a text that is not typed: it lists what is on its
	 * chart, the Messier objects or the brightest stars, in as many rows as its
	 * toolbar says. It is moved, made wider, turned and removed as a text is.
	 *
	 * ⌘C / Ctrl+C copies the selected chart or text, ⌘X cuts it, and ⌘V puts a copy
	 * on the page being shown, at its own size: where it was copied from if that is
	 * free, else in the nearest free place, and on a page with no room for it over
	 * what is there, under the pointer. Words copied anywhere else are pasted as a new
	 * text.
	 *
	 * ⌘Z / Ctrl+Z is the toast's Undo, as on the page behind (which the modal keeps
	 * from these keys): a chart or a text removed here, or a page deleted in the panel.
	 *
	 * The component is the dialog and its layout. What goes on in it is its
	 * controllers' (`editor/`): the stage says which pages are shown and where, the
	 * drag carries, resizes and turns, and the block, page and clipboard operations
	 * do the rest. The pages get the three they may ask things of as one `actions`.
	 */
	import { isBlank } from '$lib/document/blocks';
	import { MAX_PAGES, type DocumentStore } from '$lib/document/document.svelte';
	import { plural } from '$lib/document/labels';
	import { isModShortcut } from '$lib/shortcuts';
	import { Announcer } from '$lib/ui/announcer.svelte';
	import type { EditorActions } from './editor/actions';
	import { BlockOperations } from './editor/block-operations.svelte';
	import { ClipboardController } from './editor/clipboard.svelte';
	import type { EditorContext } from './editor/context.svelte';
	import { DragController } from './editor/drag.svelte';
	import { EditorFocus } from './editor/focus';
	import { PageOperations } from './editor/page-operations.svelte';
	import { EDITOR_LAYOUT } from './editor/screen-geometry';
	import { EditorStage } from './editor/stage.svelte';
	import EditorPage from './EditorPage.svelte';
	import EditorStrip from './EditorStrip.svelte';
	import TemplatePicker from './templates/TemplatePicker.svelte';

	interface Props {
		store: DocumentStore;
		/** The page to open on; null keeps the editor closed. */
		pageId: string | null;
		/** The editor closed itself (Escape, ⊗, the backdrop); clear `pageId`. */
		onclose: () => void;
		/** Show a toast, with an Undo button when `undo` is given. */
		notify: (message: string, undo?: () => void) => void;
		/** ⌘Z / Ctrl+Z: run the toast's Undo, if it has one. */
		undo: () => void;
		/** ⌘ is the command modifier (Apple), not Ctrl. */
		apple: boolean;
	}

	let { store, pageId, onclose, notify, undo, apple }: Props = $props();

	const id = $props.id();
	const hintId = `${id}-hint`;
	const textHintId = `${id}-text-hint`;

	let dialogEl = $state<HTMLDialogElement>();
	/** Pages slide once the stage has its size; before that they would slide in from the fallback. */
	let animated = $state(false);
	/** The strip's height, px: the toast, lodged in the dialog, sits above it. */
	let stripHeight = $state(0);
	/** True from the press on the backdrop to the click: a drag that ends there is no click. */
	let pressedOnBackdrop = false;

	const open = $derived(pageId !== null);

	// The controllers: each does one thing, and they share the document, the stage and the focus.
	const focus = new EditorFocus(() => dialogEl);
	const voice = new Announcer();
	const stage = new EditorStage({
		get store() {
			return store;
		},
		get pageId() {
			return pageId;
		},
		focus,
		announce: voice.say,
		isDragging: () => drag.active
	});
	const editor: EditorContext = {
		get store() {
			return store;
		},
		get isOpen() {
			return open;
		},
		stage,
		focus,
		announce: voice.say,
		notify: (message, undoIt) => notify(message, undoIt)
	};
	const drag = new DragController(editor);
	const blocks = new BlockOperations(editor, drag);
	const pages = new PageOperations(editor, drag, blocks);
	const clipboard = new ClipboardController(editor, drag, blocks);
	/** What the pages, and the charts and texts on them, may ask for. */
	const actions: EditorActions = { pages, pointer: drag, blocks };

	const current = $derived(stage.current);
	const summary = $derived(
		`${plural(stage.pages.length, 'page')} · ${plural(store.chartCount, 'chart')} · A4`
	);

	// Open and close with the prop. The content renders first, so the stage can be measured.
	$effect(() => {
		const dialog = dialogEl;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// The dialog itself takes the focus: on ⊗, Safari would ring it on every open. Tab reaches ⊗.
			dialog.focus({ preventScroll: true });
			measureStage();
			// Two frames: the first paints at the measured size, the next may animate.
			requestAnimationFrame(() => requestAnimationFrame(() => (animated = dialog.open)));
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	// The current page is the selected one; a document emptied under the editor closes it.
	$effect(() => {
		if (!open) return;
		if (current) store.selectedPageId = current.id;
		else if (dialogEl?.open) closeEditor();
		else onclose();
	});

	$effect(() => {
		const el = stage.element;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => measureStage());
		observer.observe(el);
		return () => observer.disconnect();
	});

	// Keys with the focus lost to the body (its element removed) still belong to the editor.
	$effect(() => {
		if (!open) return;
		const onKeydown = (event: KeyboardEvent) => {
			// Not while the template picker is over the editor: its keys are its own.
			if (pages.picking) return;
			if (event.target === document.body || event.target === document.documentElement) {
				handleKeydown(event);
			}
		};
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
	});

	// The strip grows a scrollbar with more pages, which shrinks the stage: measured with it.
	function measureStage() {
		if (!stage.element) return;
		stage.measure();
		stripHeight = dialogEl?.querySelector<HTMLElement>('[data-strip]')?.offsetHeight ?? 0;
	}

	function closeEditor() {
		dialogEl?.close();
	}

	function handleClose() {
		drag.reset();
		blocks.editingId = null;
		animated = false;
		store.flush();
		if (pageId !== null) onclose();
	}

	function handleCancel(event: Event) {
		// Escape mid-drag (or a platform's back gesture) drops the drag, not the editor;
		// while a text is typed in, it ends the typing.
		if (drag.active) {
			event.preventDefault();
			drag.cancel();
		} else if (blocks.editingId !== null) {
			event.preventDefault();
			focus.block(blocks.editingId);
		}
	}

	function handleBackdropPointerDown(event: PointerEvent) {
		pressedOnBackdrop = event.target === dialogEl;
	}

	function handleBackdropClick(event: MouseEvent) {
		// The content fills the dialog box, so a click on the dialog itself is on the backdrop.
		if (pressedOnBackdrop && event.target === dialogEl) closeEditor();
		pressedOnBackdrop = false;
	}

	/** Keys on the dialog. They go no further: the generator's shortcuts are behind the modal. */
	function handleKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			if (drag.active) drag.cancel();
			else closeEditor();
			return;
		}
		// By the key's place, not its character: Ctrl+Z on a Russian layout types "я".
		if (isModShortcut(event, 'KeyZ', apple)) {
			event.preventDefault();
			if (!event.repeat && !drag.active) undo();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey || drag.active) return;
		const target = event.target as Element | null;
		// Delete on the page itself (no chart selected) deletes it, if it is empty.
		if (event.key === 'Delete' || event.key === 'Backspace') {
			if (current && isBlank(current) && target?.matches?.('[data-paper]')) {
				event.preventDefault();
				if (!event.repeat) pages.remove(current.id);
			}
			return;
		}
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		// A focused chart takes the arrows itself; a text field would want them too.
		if (target?.closest?.('[data-item-id], input, textarea, select')) return;
		event.preventDefault();
		stage.step(event.key === 'ArrowLeft' ? -1 : 1, Boolean(target?.closest?.('[data-strip]')));
	}
</script>

<!-- Escape is handled here (it also cancels a drag); the backdrop click only mirrors it for the pointer. -->
<dialog
	bind:this={dialogEl}
	class="editor"
	class:is-animated={animated}
	tabindex="-1"
	style:--strip-h={stripHeight > 0 ? `${stripHeight}px` : undefined}
	aria-labelledby="{id}-title"
	aria-describedby="{id}-summary"
	onkeydown={handleKeydown}
	oncancel={handleCancel}
	onclose={handleClose}
	onpointerdown={handleBackdropPointerDown}
	onclick={handleBackdropClick}
	onclickcapture={(event) => drag.swallowClick(event)}
	oncopy={(event) => clipboard.copy(event)}
	oncut={(event) => clipboard.copy(event)}
	onpaste={(event) => clipboard.paste(event)}
	onpointermove={(event) => (clipboard.pointer = { x: event.clientX, y: event.clientY })}
>
	{#if open && current}
		<div class="content">
			<header class="bar">
				<!-- First in the dialog: the first stop for Tab. -->
				<button
					class="close"
					type="button"
					aria-label="Close"
					title="Close · Esc"
					onclick={closeEditor}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="6.25" />
						<path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />
					</svg>
				</button>
				<div class="title">
					<h2 id="{id}-title">PDF document</h2>
					<p class="summary" id="{id}-summary">{summary}</p>
				</div>
			</header>

			<div class="stage" class:is-carrying={drag.carrying} bind:this={stage.element}>
				{#each stage.slots as slot (slot.page.id)}
					<EditorPage
						page={slot.page}
						number={slot.number}
						prevPage={slot.role === 'current' && stage.prev ? slot.number - 1 : null}
						nextPage={slot.role === 'current' && stage.next ? slot.number + 1 : null}
						role={slot.role}
						box={slot.box}
						labelHeight={EDITOR_LAYOUT.labelHeight}
						narrow={stage.layout.narrow}
						drag={drag.pageDrag(slot.page)}
						returningId={drag.returningId}
						settlingId={drag.settlingId}
						carrying={drag.carrying}
						editingId={blocks.editingId}
						pages={stage.pages}
						{hintId}
						{textHintId}
						{actions}
					/>
				{/each}
			</div>

			<EditorStrip
				pages={stage.pages}
				currentId={current.id}
				canAdd={store.canAddPage}
				onselect={(selected) => stage.show(selected)}
				onadd={() => pages.add()}
			/>

			<p class="sr-only" id={hintId}>
				Drag to move it, holding Shift to see the lines it will snap to, or use the arrow keys, with
				Shift for 10 millimetres; Page Up and Page Down move it to the page before or after. Drag a
				corner to resize it, or press plus or minus. Delete removes it. Copy, cut and paste work on
				it as on words.
			</p>
			<p class="sr-only" id={textHintId}>
				Press Enter to type in it, Escape when done. Drag to move it, or use the arrow keys, with
				Shift for 10 millimetres; Page Up and Page Down move it to the page before or after. Drag a
				side to set its width; plus and minus change the size of the type. R turns it a quarter
				clockwise, Shift R back; the knob over it turns it freely, to a right angle with Shift held.
				Delete removes it. Copy, cut and paste work on it as on words.
			</p>
			<p class="sr-only" aria-live="polite">{voice.message}</p>
		</div>
	{/if}
</dialog>

{#if pages.picking && pages.pickedPage}
	{@const pageId = pages.picking.pageId}
	<TemplatePicker
		page={pages.pickedPage}
		number={store.pageIndex(pageId) + 1}
		room={MAX_PAGES - store.pageCount}
		anchor={pages.picking.anchor}
		placement="under"
		onapply={(template, laid) => pages.applyTemplate(pageId, template, laid)}
		onclose={() => (pages.picking = null)}
	/>
{/if}

<style>
	/* The paper and ink tokens are the app's (tokens.css), shared with the pages panel. */
	.editor {
		/* The dialog's distance from the window's edge. */
		--editor-inset: 12px;
		/*
		 * The toast lodges in the dialog while it is open (Toast.svelte): above the
		 * strip of mini pages, which would otherwise sit under it.
		 */
		--toast-bottom: calc(var(--editor-inset) + var(--strip-h, 88px) + 12px);

		position: fixed;
		inset: 0;
		box-sizing: border-box;
		width: auto;
		height: auto;
		max-width: none;
		max-height: none;
		margin: var(--editor-inset);
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--hairline);
		border-radius: 16px;
		background: var(--panel);
		color: var(--fg-2);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
	}

	.editor[open] {
		animation: editor-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.editor::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}

	.editor[open]::backdrop {
		animation: backdrop-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.editor:focus {
		outline: none;
	}

	@keyframes editor-in {
		from {
			opacity: 0;
			transform: scale(0.985);
		}
	}

	@keyframes backdrop-in {
		from {
			opacity: 0;
		}
	}

	.content {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		height: 100%;
	}

	.bar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'title close';
		align-items: center;
		gap: 16px;
		height: 56px;
		padding: 0 12px 0 20px;
	}

	.title {
		grid-area: title;
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-width: 0;
	}

	h2 {
		margin: 0;
		color: var(--fg-1);
		font:
			500 15px/20px Inter,
			system-ui,
			sans-serif;
		white-space: nowrap;
	}

	.summary {
		margin: 0;
		overflow: hidden;
		color: var(--fg-3);
		font:
			400 12px/16px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.close {
		grid-area: close;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--fg-2);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.close svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	@media (hover: hover) {
		.close:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.close:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.close:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.stage {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	/*
	 * A chart in the hand is not held to the stage either: carried over the bar above
	 * or the strip below, it stays whole and on top of them.
	 */
	.stage.is-carrying {
		z-index: 1;
		overflow: visible;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* A phone: the whole screen, no frame of dimmed app around it. */
	@media (max-width: 743px) {
		.editor {
			--editor-inset: 0px;
			border: 0;
			border-radius: 0;
		}

		.bar {
			height: 52px;
			padding: 0 8px 0 16px;
		}
	}

	@media (max-width: 360px) {
		.summary {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.editor[open],
		.editor[open]::backdrop {
			animation: none;
		}
	}
</style>
