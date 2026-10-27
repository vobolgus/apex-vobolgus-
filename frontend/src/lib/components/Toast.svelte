<script lang="ts">
	/**
	 * The page's toast: bottom centre, just above the dock, with an Undo when the
	 * action has one. It reads `store` (the page's `ToastStore`).
	 *
	 * A modal dialog makes everything outside it inert, so a toast raised from the
	 * page editor would sit under the backdrop with a dead Undo. The host is a
	 * manual popover instead: it lives in the top layer, and while a modal is open
	 * it moves into that dialog (and back when it closes), so it stays on top and
	 * stays live. Browsers without popovers get a fixed, high z-index box. A dialog
	 * with its own bar at the bottom sets `--toast-bottom`, so the toast clears it.
	 *
	 * Undo shows and announces its shortcut, ⌘Z / Ctrl+Z, which works from wherever
	 * the focus is: the button itself is many Tab stops away from what was deleted.
	 */
	import { tick, untrack } from 'svelte';
	import { ariaKeys, keyLabel, spokenKeys } from '$lib/shortcuts';
	import type { ToastItem, ToastStore } from '$lib/ui/toast.svelte';

	interface Props {
		store: ToastStore;
		/** Whether a modal dialog is open; the toast re-homes itself when this changes. */
		modal?: boolean;
		/** ⌘ on Apple platforms, Ctrl elsewhere, for the Undo shortcut. */
		apple?: boolean;
	}

	let { store, modal = false, apple = true }: Props = $props();

	const UNDO_KEYS = ['mod', 'Z'] as const;

	let host = $state<HTMLDivElement>();
	/** Where the host lives without a modal: its place in the page. */
	let home: ParentNode | null = null;
	/** The dialog the host was moved into, and the listener that brings it back. */
	let lodging: { dialog: HTMLDialogElement; onclose: () => void } | null = null;
	/**
	 * What is on screen. It trails `store.current` by a task, so the live region is
	 * in place (in the dialog, if one is open) before its text changes.
	 */
	let shown = $state<ToastItem | null>(null);

	/** The last open modal dialog in document order (one at a time in this app). */
	function topModal(): HTMLDialogElement | null {
		const open = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
		for (let i = open.length - 1; i >= 0; i--) {
			try {
				if (open[i].matches(':modal')) return open[i];
			} catch {
				// No :modal support (jsdom): no dialog is treated as modal.
			}
		}
		return null;
	}

	function supportsPopover(el: HTMLElement): boolean {
		return typeof el.showPopover === 'function';
	}

	/** Lift the host to the top of the top layer (showing a popover again re-stacks it). */
	function raise(el: HTMLElement) {
		if (!supportsPopover(el) || !el.isConnected) return;
		if (el.matches(':popover-open')) el.hidePopover();
		el.showPopover();
	}

	function leaveLodging() {
		if (!lodging) return;
		lodging.dialog.removeEventListener('close', lodging.onclose);
		lodging = null;
	}

	/** Put the host in the topmost modal dialog, or back home when there is none. */
	function place() {
		const el = host;
		if (!el || !home) return;
		const dialog = topModal();
		const parent: ParentNode = dialog ?? home;
		if (el.parentNode !== parent) {
			leaveLodging();
			parent.appendChild(el);
			if (dialog) {
				const onclose = () => {
					leaveLodging();
					place();
				};
				dialog.addEventListener('close', onclose);
				lodging = { dialog, onclose };
			}
		}
		raise(el);
	}

	$effect(() => {
		const el = host;
		if (!el) return;
		home = el.parentNode;
		// Shown from the start, empty: the live region exists before the first message.
		raise(el);
		return () => {
			leaveLodging();
			if (supportsPopover(el) && el.matches(':popover-open')) el.hidePopover();
		};
	});

	// A modal opened or closed: follow it once its dialog is in the top layer.
	$effect(() => {
		void modal;
		void tick().then(() => untrack(place));
	});

	$effect(() => {
		const next = store.current;
		if (!next) {
			shown = null;
			return;
		}
		untrack(place);
		const timer = setTimeout(() => (shown = next));
		return () => clearTimeout(timer);
	});

	function handleFocusOut(event: FocusEvent) {
		const toastEl = event.currentTarget as HTMLElement;
		if (!toastEl.contains(event.relatedTarget as Node | null)) store.resume();
	}
</script>

<div bind:this={host} class="toast-host" popover="manual">
	<div class="toast-region" role="status">
		{#if shown}
			{#key shown.id}
				<!-- Hover and focus pause the timeout; the toast itself is not interactive. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="toast"
					onpointerenter={() => store.pause()}
					onpointerleave={() => store.resume()}
					onfocusin={() => store.pause()}
					onfocusout={handleFocusOut}
				>
					<span class="message">{shown.message}</span>
					{#if shown.undo}
						<span class="divider" aria-hidden="true"></span>
						<button
							class="undo"
							type="button"
							aria-label="Undo"
							aria-keyshortcuts={ariaKeys(UNDO_KEYS, apple)}
							onclick={() => store.undo()}
						>
							Undo
							<kbd class="keys" aria-hidden="true"
								>{UNDO_KEYS.map((key) => keyLabel(key, apple)).join(apple ? '' : '+')}</kbd
							>
						</button>
						<span class="sr-only">, or press {spokenKeys(UNDO_KEYS, apple)}</span>
					{/if}
				</div>
			{/key}
		{/if}
	</div>
</div>

<style>
	/* Undo the popover UA box (inset 0, margin auto, border, Canvas colours). */
	.toast-host {
		position: fixed;
		inset: auto 0 var(--toast-bottom, calc(16px + var(--h-dock) + 12px)) 0;
		z-index: 1000;
		width: auto;
		height: auto;
		margin: 0;
		padding: 0 16px;
		border: 0;
		overflow: visible;
		background: transparent;
		color: inherit;
		pointer-events: none;
	}

	.toast-region {
		display: flex;
		justify-content: center;
	}

	.toast {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: min(440px, 100%);
		min-height: 40px;
		padding: 4px 4px 4px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-pop);
		background: var(--pop);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
		color: var(--fg-1);
		font: var(--font-ui);
		pointer-events: auto;
		animation: toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	/* Without an Undo the text sits centred in the pill. */
	.toast:not(:has(.undo)) {
		padding-right: 14px;
	}

	.message {
		min-width: 0;
		padding: 4px 0;
	}

	.divider {
		flex-shrink: 0;
		width: 1px;
		height: 16px;
		margin: 0 4px 0 8px;
		background: var(--hairline);
	}

	.undo {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 8px;
		height: var(--h-row);
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-row);
		background: transparent;
		color: var(--fg-1);
		font: var(--font-ui);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--ease-ui);
	}

	@media (hover: hover) {
		.undo:hover {
			background: var(--fill-hover);
		}
	}

	.undo:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background: var(--fill-hover);
		box-shadow: var(--ring);
	}

	.undo:active {
		background: var(--fill-press);
	}

	/* The shortcut, as the export menu prints its keys. */
	.keys {
		color: var(--fg-3);
		font: var(--font-cap);
		font-family: inherit;
		font-variant-numeric: tabular-nums;
	}

	/* A phone has no ⌘Z to press. */
	@media (hover: none) and (pointer: coarse) {
		.keys {
			display: none;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation-name: toast-fade;
		}

		@keyframes toast-fade {
			from {
				opacity: 0;
			}
		}
	}

	@media (forced-colors: active) {
		.toast {
			border-color: CanvasText;
		}
	}
</style>
