/**
 * Lazy loader for flubber's path interpolator.
 *
 * Flubber is only needed for the projection morph, so it is imported after
 * mount. The export shape differs between bundles (named vs. default), hence
 * the probing below. Returns `null` when unavailable — the renderer then falls
 * back to a hard switch instead of a morph.
 */

import type { MorphInterpolatorFactory } from '$lib/renderer/types';

export async function loadFlubberInterpolator(): Promise<MorphInterpolatorFactory | null> {
	try {
		const module = await import('flubber');
		const maybeDefault = module.default as unknown;
		const interpolate =
			module.interpolate ??
			(typeof maybeDefault === 'function'
				? (maybeDefault as MorphInterpolatorFactory)
				: (maybeDefault as { interpolate?: MorphInterpolatorFactory } | undefined)?.interpolate);
		if (!interpolate) {
			console.warn('Flubber loaded without interpolate export; using hard switch fallback');
			return null;
		}
		return interpolate;
	} catch (error) {
		console.warn('Flubber lazy import failed; using hard switch fallback', error);
		return null;
	}
}
