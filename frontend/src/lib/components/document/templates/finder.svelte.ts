/**
 * A finder card's close-up, as the picker asks for it: the Messier objects on the
 * card's wide sky, brightest first, narrowed to what is typed, and the one the card
 * is drawn for meanwhile, under the pointer or the focus (else the first listed).
 */

import type { CloseUp } from '$lib/document/templates';
import { isOnChart } from '$lib/document/templates';
import type { ChartSnapshot } from '$lib/document/types';
import type { MessierObject } from '$lib/stores.svelte';

/** "M 42 · Orion Nebula", or "M 40" for one with no name. */
export function objectName(object: MessierObject): string {
	return object.name ? `M ${object.m} · ${object.name}` : `M ${object.m}`;
}

/** What a search may match: "m 42", "m42", the name, the kind, the constellation. */
function objectWords(object: MessierObject): string {
	const { m, name, kind, constellation } = object;
	return `m ${m} m${m} ${name} ${kind} ${constellation}`.toLowerCase();
}

/** The objects of `catalogue` on `sky`, brightest first. */
export function objectsOn(
	sky: ChartSnapshot | undefined,
	catalogue: readonly MessierObject[]
): MessierObject[] {
	return sky
		? catalogue
				.filter((object) => isOnChart(sky, object.ra_deg, object.dec_deg))
				.sort((a, b) => a.mag - b.mag || a.m - b.m)
		: [];
}

/** `objects` narrowed to those `query` is found in, all of them for an empty one. */
export function matching(objects: MessierObject[], query: string): MessierObject[] {
	const words = query.trim().toLowerCase().replace(/\s+/g, ' ');
	if (words === '') return objects;
	return objects.filter((object) => objectWords(object).includes(words));
}

/** A close-up of `object`, `fovDeg` across. */
export function closeUpOf(object: MessierObject, fovDeg: number): CloseUp {
	return { name: objectName(object), raDeg: object.ra_deg, decDeg: object.dec_deg, fovDeg };
}

export class FinderChoice {
	/** What the list is narrowed to, as typed. */
	query = $state('');
	/** The number of the object the card is drawn for: the one under the pointer or the focus. */
	shownNumber = $state<number | null>(null);
	/** The Messier objects on the sky, brightest first. */
	readonly objects: MessierObject[];
	/** Those of them the search finds. */
	readonly listed: MessierObject[];
	/** The object the card is drawn for. */
	readonly shown: MessierObject | null;
	/** The catalogue has come: until it does, the list is still loading (or failed to). */
	readonly loaded: boolean;

	/** `sky`: the chart the card would be made of; `catalogue`: the Messier objects, once loaded. */
	constructor(sky: () => ChartSnapshot | undefined, catalogue: () => readonly MessierObject[]) {
		this.loaded = $derived(catalogue().length > 0);
		this.objects = $derived(objectsOn(sky(), catalogue()));
		this.listed = $derived(matching(this.objects, this.query));
		this.shown = $derived(
			this.listed.find((object) => object.m === this.shownNumber) ?? this.listed[0] ?? null
		);
	}
}
