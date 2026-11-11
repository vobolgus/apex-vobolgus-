/**
 * A chart's picture in the editor: its vector preview, fetched for the chart's size
 * in the document. While a resize drags, the old picture stretches to the new frame,
 * and the new one replaces it only once it has loaded, so the chart never blinks
 * empty. Until the first has loaded, the chart's thumbnail stands in for it.
 *
 * Made during the component's init: it fetches from an effect of its own.
 */

import { untrack } from 'svelte';
import { chartPreviewUrl } from '$lib/document/render';
import type { ChartBlock } from '$lib/document/types';

export class ChartPreview {
	readonly #chart: () => ChartBlock;
	/** The URL of the preview shown, once one has loaded. */
	src = $state<string | null>(null);
	/** The preview could not be had. */
	failed = $state(false);
	/** Bumped when a shown preview stops loading (its URL revoked): fetch it again. */
	#reload = $state(0);
	/** The preview depends on the chart's size, not its place on the page. */
	readonly #size = $derived.by(() => `${this.#chart().frame.w}:${this.#chart().frame.h}`);

	constructor(chart: () => ChartBlock) {
		this.#chart = chart;
		$effect(() => {
			void this.#size;
			void this.#reload;
			const snapshot = untrack(() => $state.snapshot(this.#chart())) as ChartBlock;
			let live = true;
			chartPreviewUrl(snapshot)
				.then(preload)
				.then(
					(url) => {
						if (!live) return;
						this.src = url;
						this.failed = false;
					},
					() => {
						if (live) this.failed = true;
					}
				);
			return () => {
				live = false;
			};
		});
	}

	/** What to show: the preview, else the thumbnail; null with neither. */
	get picture(): string | null {
		return this.src ?? this.#chart().thumb ?? null;
	}

	/** The <img> with a preview URL no longer loads: show the thumb and fetch again. */
	lost = (): void => {
		if (this.src === null) return;
		this.src = null;
		this.#reload += 1;
	};
}

/** Resolves once the picture has loaded, so swapping it in shows no empty frame. */
function preload(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(url);
		image.onerror = () => reject(new Error('Chart preview did not load'));
		image.src = url;
	});
}
