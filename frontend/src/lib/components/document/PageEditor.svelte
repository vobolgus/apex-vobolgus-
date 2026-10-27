<script lang="ts">
	/**
	 * STUB, replaced by the real page editor at merge. It keeps the contract: a
	 * native modal `<dialog>` that is open while `pageId` is non-null and calls
	 * `onclose` when it closes itself (Escape).
	 */
	import type { DocumentStore } from '$lib/document/document.svelte';

	interface Props {
		store: DocumentStore;
		pageId: string | null;
		onclose: () => void;
		notify: (message: string, undo?: () => void) => void;
	}

	// `notify` is the real editor's (chart removal with an Undo); the stub has nothing to remove.
	// eslint-disable-next-line svelte/no-unused-props
	const props: Props = $props();

	let dialogEl = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialogEl) return;
		if (props.pageId !== null) props.store.selectedPageId = props.pageId;
		if (props.pageId !== null && !dialogEl.open) dialogEl.showModal();
		else if (props.pageId === null && dialogEl.open) dialogEl.close();
	});
</script>

<dialog
	bind:this={dialogEl}
	class="page-editor"
	aria-label="Page editor"
	onclose={() => props.onclose()}
></dialog>

<style>
	.page-editor {
		padding: 0;
		border: 0;
		background: transparent;
	}

	.page-editor::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}
</style>
