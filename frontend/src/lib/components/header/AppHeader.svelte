<script lang="ts">
	/**
	 * The page's header: the name on the left; on the right About, Add to PDF and the
	 * export button. On a phone the buttons keep their icons alone, the labels kept
	 * for screen readers, and on the narrowest the byline goes.
	 */
	import type { ExportController } from './export.svelte';
	import ExportControl from './ExportControl.svelte';

	/** What the header's buttons ask of the page. */
	interface HeaderActions {
		/** Open the About dialog. */
		about(): void;
		/** Add the chart to the PDF document. */
		addToPdf(): void;
	}

	interface Props {
		exporter: ExportController;
		actions: HeaderActions;
		/** ⌘ on Apple platforms, Ctrl elsewhere, for the shortcuts. */
		apple: boolean;
	}

	let { exporter, actions, apple }: Props = $props();

	let addButton = $state<HTMLButtonElement | null>(null);

	/** Put the focus on Add to PDF: the last page was deleted, and the pages panel with it. */
	export function focusAdd() {
		addButton?.focus();
	}
</script>

<header class="ray-header">
	<div class="ray-bottom">
		<div class="ray-left">
			<img src="/icon-constellation.png" alt="Apex icon" class="ray-logo" />
			<span class="ray-textline">
				<span class="ray-brand">Skycharts</span>
				<span class="ray-meta-word">by Vobolgus</span>
			</span>
		</div>
		<div class="ray-right">
			<button
				class="tool-btn"
				type="button"
				aria-haspopup="dialog"
				aria-keyshortcuts="Shift+?"
				title="About · ?"
				onclick={() => actions.about()}
			>
				<svg class="tool-icon tool-icon-info" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6.25" />
					<path d="M8 7.5v3.5M8 5.1v.01" />
				</svg>
				<svg class="tool-icon tool-icon-help" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6.25" />
					<path d="M6.4 6.3a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1.1v.3M8 11.3v.01" />
				</svg>
				<span class="tool-label">About</span>
			</button>
			<button
				bind:this={addButton}
				class="add-btn"
				type="button"
				title="Add the chart to the PDF document"
				onclick={() => actions.addToPdf()}
			>
				<svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M8 3.25v9.5M3.25 8h9.5" />
				</svg>
				<span class="tool-label">Add to PDF</span>
			</button>
			<ExportControl {exporter} {apple} />
		</div>
	</div>
</header>

<style>
	.ray-header {
		height: 56px;
		padding: 0 10px;
		display: flex;
		align-items: center;
		background: #101114;
		border-bottom: none;
		z-index: 5;
	}

	.ray-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-width: 0;
		width: 100%;
	}

	.ray-left {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.ray-logo {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		object-fit: cover;
	}

	.ray-textline {
		display: inline-flex;
		align-items: baseline;
		gap: 14px;
		line-height: 1;
		white-space: nowrap;
	}

	.ray-brand {
		font-size: 0.98rem;
		font-weight: 400;
		color: #eceef1;
		letter-spacing: 0;
		line-height: 1;
		font-family:
			Inter,
			system-ui,
			-apple-system,
			Segoe UI,
			Roboto,
			Arial,
			sans-serif;
	}

	.ray-meta-word {
		font-size: 0.74rem;
		font-weight: 400;
		color: #8f939a;
		line-height: 1;
	}

	.ray-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* ray.so's transparent button: no border, a fill on hover. */
	.tool-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--fg-2);
		font: var(--font-ui);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.tool-btn:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	/* The ring is a box-shadow, which forced colors drop; the transparent outline then shows. */
	.tool-btn:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background: var(--fill-hover);
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	/* After :focus-visible: a key or click press shows on a focused button too. */
	.tool-btn:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	/* ray.so's secondary button: a faint fill and a hairline edge, brighter under the pointer. */
	.add-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px 0 10px;
		border: 0;
		border-radius: var(--r-ctl);
		background: var(--fill-hover);
		box-shadow: inset 0 0 0 1px var(--hairline-strong);
		color: var(--fg-2);
		font: var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	@media (hover: hover) {
		.add-btn:hover {
			background: var(--fill-press);
			color: var(--fg-1);
		}
	}

	.add-btn:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		background: var(--fill-press);
		color: var(--fg-1);
		box-shadow:
			inset 0 0 0 1px var(--hairline-strong),
			var(--ring);
	}

	.add-btn:active {
		background: var(--fill-on);
		color: var(--fg-1);
	}

	.tool-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* "ⓘ About" with a label; the bare "?" stands in for it on a phone. */
	.tool-icon-help {
		display: none;
	}

	@media (max-width: 743px) {
		/* "?" alone, a 32 px square; the label stays for screen readers. */
		.tool-btn,
		.add-btn {
			width: 32px;
			height: 32px;
			padding: 0;
			justify-content: center;
		}

		.tool-icon-info {
			display: none;
		}

		.tool-icon-help {
			display: block;
		}

		.tool-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* The byline is the first thing to go when the header runs out of room. */
	@media (max-width: 360px) {
		.ray-meta-word {
			display: none;
		}
	}
</style>
