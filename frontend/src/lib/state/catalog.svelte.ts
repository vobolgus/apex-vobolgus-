/**
 * What the chart is drawn from: the catalogue as the backend sent it, and the stars
 * again as unit vectors, which is how the renderer and the thumbnails take them.
 * One for the page; the loaders of `$lib/api/catalog` fill it.
 */

import type { CatalogStar, ConstellationSegments, MessierEntry } from '$lib/api/wire/payload';
import type { StarVector } from '$lib/math/projection';

class CatalogState {
	stars = $state.raw<CatalogStar[]>([]);
	starVectors = $state.raw<StarVector[]>([]);
	constellations = $state.raw<ConstellationSegments[]>([]);
	constellationBoundaries = $state.raw<ConstellationSegments[]>([]);
	/** Loaded when something first asks for it (`loadMessier`): the chart does not draw it yet. */
	messier = $state.raw<MessierEntry[]>([]);
}

export const catalog = new CatalogState();
