/**
 * Catalog loaders for the generator page.
 *
 * Every loader fetches one backend collection and writes it into the shared
 * `catalog` store. Failures are logged and swallowed: a missing layer must not
 * take the whole page down, the chart simply renders without it.
 */

import { raDecToUnitVector } from '$lib/math/astronomy';
import { catalog, type CatalogStar, type ConstellationData } from '$lib/stores.svelte';

/** Faintest star magnitude requested from `/api/catalog/full` by default. */
const DEFAULT_MAX_MAGNITUDE = 6.5;

/**
 * `fetch` + JSON decode with the loaders' shared failure handling.
 * Returns `null` when the request failed or the response was not 2xx.
 */
async function fetchJson<T>(url: string, label: string): Promise<T | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${label} load failed: ${response.status}`);
		return (await response.json()) as T;
	} catch (error) {
		console.error(error);
		return null;
	}
}

/** Load the star catalog and precompute the unit vector used by the renderer. */
export async function loadStars(maxMagnitude = DEFAULT_MAX_MAGNITUDE): Promise<void> {
	const stars = await fetchJson<CatalogStar[]>(
		`/api/catalog/full?max_mag=${maxMagnitude}`,
		'catalog'
	);
	if (!stars) return;
	catalog.stars = stars;
	catalog.starVectors = stars.map((star) => ({
		...raDecToUnitVector(star.ra, star.dec),
		v_mag: star.v_mag
	}));
}

/** Load the constellation stick figures. */
export async function loadConstellations(): Promise<void> {
	const constellations = await fetchJson<ConstellationData[]>(
		'/api/constellations',
		'constellations'
	);
	if (!constellations) return;
	catalog.constellations = constellations;
}

/** Load the IAU constellation boundaries. */
export async function loadConstellationBoundaries(): Promise<void> {
	const boundaries = await fetchJson<ConstellationData[]>(
		'/api/constellation-boundaries',
		'constellation boundaries'
	);
	if (!boundaries) return;
	catalog.constellationBoundaries = boundaries;
}
