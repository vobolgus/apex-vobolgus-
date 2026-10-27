/**
 * Layer visibility state for the generator page.
 *
 * `planets` is export-only (the backend draws them), the reference lines drive
 * the canvas renderer and are exposed as one `ReferenceLinesState` object.
 */

import type { ReferenceLinesState } from '$lib/renderer/types';

export type ReferenceLineKey = keyof ReferenceLinesState;
export type LayerKey = ReferenceLineKey | 'planets';

export interface LayerOption {
	key: LayerKey;
	label: string;
	/** One quiet line under the label, for layers whose effect is not obvious. */
	note?: string;
}

export interface LayerGroup {
	id: string;
	label: string;
	layers: readonly LayerOption[];
}

/** Layers popover contents, in display order. Only layers that render somewhere. */
export const LAYER_GROUPS: readonly LayerGroup[] = [
	{
		id: 'constellations',
		label: 'Constellations',
		layers: [
			{ key: 'constellations', label: 'Lines' },
			{ key: 'constellationBoundaries', label: 'Boundaries' }
		]
	},
	{
		id: 'circles',
		label: 'Circles',
		layers: [
			{ key: 'equator', label: 'Celestial equator' },
			{ key: 'ecliptic', label: 'Ecliptic' },
			{ key: 'galacticEquator', label: 'Galactic equator' }
		]
	},
	{
		id: 'bodies',
		label: 'Bodies',
		// The canvas does not draw planets, so the preview and PNG never show them.
		layers: [{ key: 'planets', label: 'Planets', note: 'SVG/PDF only' }]
	}
];

const LAYER_KEYS: readonly LayerKey[] = LAYER_GROUPS.flatMap((group) =>
	group.layers.map((layer) => layer.key)
);

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

	/** Number of enabled layers, shown in the Layers badge. */
	get enabledCount(): number {
		return LAYER_KEYS.filter((key) => this[key]).length;
	}

	toggle(key: LayerKey) {
		this[key] = !this[key];
	}

	/** A group reads as on only when every one of its layers is on. */
	isGroupOn(group: LayerGroup): boolean {
		return group.layers.every((layer) => this[layer.key]);
	}

	/** Some, but not all, of the group's layers are on. */
	isGroupMixed(group: LayerGroup): boolean {
		const on = group.layers.filter((layer) => this[layer.key]).length;
		return on > 0 && on < group.layers.length;
	}

	setGroup(group: LayerGroup, on: boolean) {
		for (const layer of group.layers) this[layer.key] = on;
	}
}
