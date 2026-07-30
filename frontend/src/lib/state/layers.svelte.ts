/**
 * Layer visibility state for the generator page.
 *
 * `planets` is export-only (the backend draws them), the reference lines drive
 * the canvas renderer and are exposed as one `ReferenceLinesState` object.
 */

import type { ReferenceLinesState } from '$lib/renderer/types';

export type ReferenceLineKey = keyof ReferenceLinesState;

/** Reference-line menu entries, in display order. */
export const REFERENCE_LINE_OPTIONS: readonly { key: ReferenceLineKey; label: string }[] = [
	{ key: 'constellations', label: 'Constellations' },
	{ key: 'constellationBoundaries', label: 'Boundaries' },
	{ key: 'equator', label: 'Celestial Equator' },
	{ key: 'ecliptic', label: 'Ecliptic' },
	{ key: 'galacticEquator', label: 'Galactic Equator' }
];

export class LayerState {
	planets = $state(false);
	equator = $state(false);
	ecliptic = $state(false);
	galacticEquator = $state(false);
	constellations = $state(false);
	constellationBoundaries = $state(false);

	/**
	 * Snapshot of the reference-line flags for the renderer. Reading this inside
	 * an effect subscribes to every flag at once.
	 */
	get referenceLines(): ReferenceLinesState {
		return {
			equator: this.equator,
			ecliptic: this.ecliptic,
			galacticEquator: this.galacticEquator,
			constellations: this.constellations,
			constellationBoundaries: this.constellationBoundaries
		};
	}

	toggle(key: ReferenceLineKey) {
		this[key] = !this[key];
	}
}
