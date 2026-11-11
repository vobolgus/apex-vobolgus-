/**
 * The catalogue's arrival, as the notice over the chart tells of it: each part is
 * fetched on its own and drawn as it comes; a load that takes a while says it is
 * loading, and what did not arrive is offered again.
 */

import { loadConstellationBoundaries, loadConstellations, loadStars } from '$lib/api/catalog';

/** The catalogue says it is loading only when it takes longer than this. */
const CATALOG_SLOW_MS = 500;

/** What the chart is drawn from, each fetched on its own. */
export type CatalogPart = 'stars' | 'constellations' | 'boundaries';
/** Each part's loader: whether it arrived. */
export type CatalogLoaders = Readonly<Record<CatalogPart, () => Promise<boolean>>>;

const CATALOG_PARTS: readonly CatalogPart[] = ['stars', 'constellations', 'boundaries'];

/** The backend's loaders; `arrived` is told each time there is something new to draw. */
export function catalogLoaders(arrived: () => void): CatalogLoaders {
	return {
		// Stars are drawn twice: the bright ones first, then all of them.
		stars: () => loadStars(arrived),
		constellations: loadConstellations,
		boundaries: loadConstellationBoundaries
	};
}

export class CatalogLoad {
	/** The catalogue parts that did not arrive; the notice over the chart offers to try again. */
	failed = $state<CatalogPart[]>([]);
	loading = $state(true);
	/** The load is slow, or a retry: worth saying so. */
	slow = $state(false);
	/** What the notice says when something did not arrive. */
	readonly failure = $derived(
		this.failed.includes('stars')
			? 'Couldn’t load the star catalogue.'
			: this.failed.length === 2
				? 'Couldn’t load the constellation lines and boundaries.'
				: this.failed[0] === 'constellations'
					? 'Couldn’t load the constellation lines.'
					: 'Couldn’t load the constellation boundaries.'
	);
	readonly #arrived: () => void;
	readonly #loaders: CatalogLoaders;

	constructor(arrived: () => void, loaders: CatalogLoaders = catalogLoaders(arrived)) {
		this.#arrived = arrived;
		this.#loaders = loaders;
	}

	/**
	 * Fetch `parts` of the catalogue, drawing each as it arrives. What fails is kept
	 * in `failed` for the notice; a `retry` says it is loading at once, so the
	 * notice does not blink away and back when the backend is still down.
	 */
	async load(parts: readonly CatalogPart[] = CATALOG_PARTS, retry = false): Promise<void> {
		this.loading = true;
		this.slow = retry;
		const slowTimer = setTimeout(() => (this.slow = true), CATALOG_SLOW_MS);
		const arrived = await Promise.all(
			parts.map(async (part) => {
				const ok = await this.#loaders[part]();
				if (ok) this.#arrived();
				return ok;
			})
		);
		clearTimeout(slowTimer);
		this.failed = parts.filter((_, index) => !arrived[index]);
		this.loading = false;
		this.slow = false;
	}

	/** Try again for what did not arrive. */
	retry = (): Promise<void> => this.load(this.failed, true);
}
