/**
 * A chart's vector preview: its SVG drawn by the backend from a RenderConfig, kept
 * as an object URL for as long as something may show it.
 */

import type { RenderConfig } from './wire/request';

/** Previews kept as object URLs; the least recently used one is revoked beyond this. */
export const PREVIEW_CACHE_LIMIT = 60;

// Insertion order is recency: a hit moves to the end, eviction takes the first.
const previews = new Map<string, Promise<string>>();
/**
 * Evicted URLs an image still shows. A page that becomes current in the editor
 * draws a new <img> with the URL its chart already had, which a revoked URL would
 * break; these are revoked once no image shows them.
 */
const retired = new Set<string>();

/**
 * An object URL of the SVG the backend draws from `config`, cached by the JSON of
 * it (so a chart moved on its page hits, and one resized does not). Rejects when
 * the backend fails; a failure is not cached, so the next call tries again.
 */
export function chartPreviewUrl(config: RenderConfig): Promise<string> {
	const body = JSON.stringify(config);
	const cached = previews.get(body);
	if (cached) {
		previews.delete(body);
		previews.set(body, cached);
		return cached;
	}
	const url = fetchPreview(body);
	previews.set(body, url);
	url.catch(() => {
		if (previews.get(body) === url) previews.delete(body);
	});
	for (const [key, evicted] of previews) {
		if (previews.size <= PREVIEW_CACHE_LIMIT) break;
		previews.delete(key);
		evicted.then(
			(href) => {
				retired.add(href);
				revokeUnshown();
			},
			() => {}
		);
	}
	return url;
}

/** Drop every cached preview and revoke its URL. */
export function clearPreviewCache(): void {
	for (const url of previews.values()) revokeWhenSettled(url);
	previews.clear();
	for (const href of retired) URL.revokeObjectURL(href);
	retired.clear();
}

/** Revoke the retired URLs that no image in the document shows any more. */
function revokeUnshown() {
	const shown = new Set(
		typeof document === 'undefined' ? [] : Array.from(document.images, (image) => image.src)
	);
	for (const href of retired) {
		if (shown.has(href)) continue;
		retired.delete(href);
		URL.revokeObjectURL(href);
	}
}

async function fetchPreview(body: string): Promise<string> {
	const response = await fetch('/api/export?format=svg', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body
	});
	if (!response.ok) throw new Error(`Chart preview failed: ${response.status}`);
	return URL.createObjectURL(await response.blob());
}

function revokeWhenSettled(url: Promise<string>) {
	url.then(
		(href) => URL.revokeObjectURL(href),
		() => {}
	);
}
