<script lang="ts">
	/**
	 * About and the shortcut list, after ray.so's InfoDialog: one modal with the
	 * description on the left and every shortcut on the right.
	 *
	 * A native modal `<dialog>`: it sits in the top layer above the chart and the
	 * dock, makes the page behind it inert, closes on Escape and gives the focus
	 * back to where it was. A click on the backdrop closes it too.
	 */
	import { SHORTCUTS, keyLabel, spokenKeys } from '$lib/shortcuts';

	interface Props {
		/** Open state; the dialog clears it when it closes itself (Escape, ×, backdrop). */
		open: boolean;
		/** Apple platform: ⌘ ⇧ ⌃ on the keycaps instead of Ctrl and Shift. */
		apple: boolean;
	}

	let { open = $bindable(), apple }: Props = $props();

	const REPO_URL = 'https://github.com/vobolgus/apex-vobolgus-';
	const AUTHOR_URL = 'https://github.com/vobolgus';

	const id = $props.id();
	let dialogEl = $state<HTMLDialogElement>();
	/** The press began on the backdrop: a text selection dragged out onto it is no click on it. */
	let pressedOnBackdrop = false;

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) dialogEl.showModal();
		else if (!open && dialogEl.open) dialogEl.close();
	});

	function handlePointerDown(event: PointerEvent) {
		pressedOnBackdrop = event.target === dialogEl;
	}

	function handleClick(event: MouseEvent) {
		// The dialog box has no padding, so a click on the dialog itself is a click on the backdrop.
		if (pressedOnBackdrop && event.target === dialogEl) open = false;
		pressedOnBackdrop = false;
	}
</script>

<!-- Escape is the keyboard way out, handled natively; the backdrop click only mirrors it for the pointer. -->
<dialog
	bind:this={dialogEl}
	class="about"
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onpointerdown={handlePointerDown}
	onclick={handleClick}
>
	<div class="content">
		<!-- First in the dialog, so showModal() puts the focus here and not on a link in the text. -->
		<button class="close" type="button" aria-label="Close" onclick={() => (open = false)}>
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
			</svg>
		</button>

		<section class="column">
			<h2 id="{id}-title">About</h2>
			<p>
				Skycharts is a tool for making charts of the night sky from the Hipparcos star catalogue.
			</p>
			<p>
				Drag the sky to turn it and pinch to zoom. Stereo shows the whole sky in one disc; Pinhole
				frames part of it like a camera, and the frame resizes by its corners and edges.
			</p>
			<p>
				Open Layers to add constellation lines and boundaries, the celestial equator, the ecliptic
				and the galactic equator.
			</p>
			<p>
				When you’re ready, click Export Image in the top-right corner to save the chart as a PNG,
				SVG or PDF.
			</p>

			<h3>Contribute</h3>
			<p>
				The project is open source and
				<a href={REPO_URL} target="_blank" rel="noopener noreferrer">available on GitHub</a>.
			</p>

			<footer class="footer">
				<a class="made-by" href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
					<img src="/icon-constellation.png" alt="" />
					<span>Made by Vobolgus</span>
				</a>
				<a class="social" href={REPO_URL} target="_blank" rel="noopener noreferrer">
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path
							d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
						/>
					</svg>
					<span class="sr-only">GitHub</span>
				</a>
			</footer>
		</section>

		<div class="divider" aria-hidden="true"></div>

		<section class="column" aria-labelledby="{id}-shortcuts">
			<h2 id="{id}-shortcuts">Shortcuts</h2>
			<dl class="shortcuts">
				{#each SHORTCUTS as shortcut (shortcut.action)}
					<div class="shortcut">
						<dt>{shortcut.action}</dt>
						<dd>
							<span class="sr-only">{spokenKeys(shortcut.keys, apple)}</span>
							<span class="keys" aria-hidden="true">
								{#each shortcut.keys as key, index (index)}
									<kbd>{keyLabel(key, apple)}</kbd>
								{/each}
							</span>
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	</div>
</dialog>

<style>
	.about {
		width: min(768px, calc(100vw - 32px));
		max-width: none;
		max-height: calc(100dvh - 32px);
		margin: auto;
		padding: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--hairline);
		border-radius: var(--r-pop);
		background: var(--panel);
		color: var(--fg-2);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
	}

	.about[open] {
		animation: about-in 150ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.about::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}

	.about[open]::backdrop {
		animation: backdrop-in 150ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.about:focus {
		outline: none;
	}

	@keyframes about-in {
		from {
			opacity: 0;
			transform: translateY(-1%) scale(0.98);
		}
	}

	@keyframes backdrop-in {
		from {
			opacity: 0;
		}
	}

	.content {
		position: relative;
		display: flex;
		gap: 32px;
		padding: 24px;
	}

	.column {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.divider {
		flex-shrink: 0;
		width: 1px;
		background: var(--hairline);
	}

	h2,
	h3 {
		margin: 0;
		color: var(--fg-1);
		font:
			500 16px/20px Inter,
			system-ui,
			sans-serif;
	}

	h3 {
		margin-top: 4px;
	}

	p {
		margin: 0;
		font:
			400 13px/21px Inter,
			system-ui,
			sans-serif;
	}

	a {
		color: var(--fg-1);
		text-decoration: underline;
		text-underline-offset: 2px;
		border-radius: 2px;
	}

	a:focus-visible,
	.close:focus-visible {
		outline: none;
		box-shadow: var(--ring);
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: auto;
		padding-top: 8px;
	}

	.made-by {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--fg-1);
		font: var(--font-ui);
		text-decoration: none;
	}

	.made-by img {
		width: 16px;
		height: 16px;
		border-radius: 4px;
	}

	@media (hover: hover) {
		.made-by:hover span {
			text-decoration: underline;
			text-underline-offset: 2px;
		}

		.social:hover {
			color: var(--fg-1);
		}

		.close:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.social {
		display: inline-flex;
		color: var(--fg-3);
		transition: color var(--ease-ui);
	}

	.social svg {
		width: 16px;
		height: 16px;
		fill: currentColor;
	}

	.shortcuts {
		display: grid;
		gap: 12px;
		margin: 0;
	}

	.shortcut {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	dt {
		font:
			400 13px/16px Inter,
			system-ui,
			sans-serif;
	}

	dd {
		margin: 0;
	}

	.keys {
		display: flex;
		flex-shrink: 0;
		gap: 4px;
	}

	/* --fg-2 on the keycap, not ray.so's dimmer text: 12 px glyphs need 4.5:1. */
	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 28px;
		height: 28px;
		padding: 0 8px;
		border-radius: 6px;
		background: var(--fill-on);
		color: var(--fg-2);
		font:
			500 12px/1 Inter,
			system-ui,
			sans-serif;
		letter-spacing: 0.1px;
	}

	.close {
		position: absolute;
		top: 16px;
		right: 16px;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
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
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* One column on narrow screens; the shortcuts go under the description. */
	@media (max-width: 640px) {
		.content {
			flex-direction: column;
			gap: 24px;
		}

		.divider {
			width: auto;
			height: 1px;
		}

		.footer {
			margin-top: 4px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.about[open],
		.about[open]::backdrop {
			animation: none;
		}
	}
</style>
