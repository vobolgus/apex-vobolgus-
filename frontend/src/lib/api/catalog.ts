/**
 * Catalog loaders for the generator page.
 *
 * Every loader fetches one backend collection and writes it into the shared
 * `catalog` store. Failures are logged, not thrown: a missing layer must not
 * take the whole page down, the chart simply renders without it. Each loader
 * resolves to whether its collection arrived, so the page can say so and retry.
 */

import { raDecToUnitVector } from '$lib/math/astronomy';
import {
	catalog,
	type CatalogStar,
	type ConstellationData,
	type MessierObject
} from '$lib/stores.svelte';

/**
 * Faintest star the preview draws: the backend's default for `/api/catalog/full`,
 * which is asked for without a limit so every visitor shares one cached URL. The
 * exports send the same limit.
 */
export const DEFAULT_MAX_MAGNITUDE = 6.5;

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

function setStars(stars: CatalogStar[]) {
	catalog.stars = stars;
	catalog.starVectors = stars.map((star) => ({
		...raDecToUnitVector(star.ra, star.dec),
		v_mag: star.v_mag
	}));
}

/**
 * Load the star catalog in two stages, as SPEC.md asks: the few hundred stars
 * brighter than 4.0 arrive first (a payload some 15 times smaller) and are drawn
 * at once, then the full catalog replaces them. Both requests start together, so
 * the second does not wait for the first; from the HTTP cache the full catalog is
 * there straight away and the bright one is dropped.
 *
 * `onStars` is called each time there are new stars to draw. Resolves to whether
 * the full catalog arrived.
 */
export async function loadStars(onStars: () => void = () => {}): Promise<boolean> {
	let fullSettled = false;
	void fetchJson<CatalogStar[]>('/api/catalog/bright', 'bright catalog').then((stars) => {
		// Late, or after a failed full load with stars already up: nothing to add.
		if (!stars || fullSettled) return;
		setStars(stars);
		onStars();
	});
	const stars = await fetchJson<CatalogStar[]>('/api/catalog/full', 'catalog');
	fullSettled = true;
	// On a failure the bright stars, if they came, stay on the chart.
	if (!stars) return false;
	setStars(stars);
	onStars();
	return true;
}

/** Load the constellation stick figures. */
export async function loadConstellations(): Promise<boolean> {
	const constellations = await fetchJson<ConstellationData[]>(
		'/api/constellations',
		'constellations'
	);
	if (!constellations) return false;
	catalog.constellations = constellations;
	return true;
}

/** Load the IAU constellation boundaries. */
export async function loadConstellationBoundaries(): Promise<boolean> {
	const boundaries = await fetchJson<ConstellationData[]>(
		'/api/constellation-boundaries',
		'constellation boundaries'
	);
	if (!boundaries) return false;
	catalog.constellationBoundaries = boundaries;
	return true;
}

let messierLoad: Promise<boolean> | null = null;

/**
 * Load the Messier catalogue, once: whoever asks while it is on its way, or after
 * it came, gets the same answer. A failure is not kept, so the next call tries again.
 */
export function loadMessier(): Promise<boolean> {
	messierLoad ??= fetchJson<MessierObject[]>('/api/catalog/messier', 'Messier catalogue').then(
		(objects) => {
			if (!objects) {
				messierLoad = null;
				return false;
			}
			catalog.messier = objects;
			return true;
		}
	);
	return messierLoad;
}
