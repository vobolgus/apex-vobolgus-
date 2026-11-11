import { describe, expect, it } from 'vitest';
import { isOnChart } from '$lib/document/templates';
import { chart } from '$lib/document/test-support';
import { orientationToPointing } from '$lib/math/pointing';
import type { MessierObject } from '$lib/api/catalog-types';
import { closeUpOf, FinderChoice, matching, objectName, objectsOn } from './finder.svelte';

function object(m: number, over: Partial<MessierObject> = {}): MessierObject {
	return {
		m,
		name: '',
		kind: 'Open Cluster',
		constellation: 'Ori',
		mag: 6,
		ra_deg: 83.8,
		dec_deg: -5.4,
		...over
	} as MessierObject;
}

const ORION = object(42, { name: 'Orion Nebula', kind: 'Nebula', mag: 4 });
const RUNNING_MAN = object(43, { mag: 9 });
const PLEIADES = object(45, { name: 'Pleiades', constellation: 'Tau', mag: 1.6 });

describe('objectName', () => {
	it('is the number and the name, or the number alone', () => {
		expect(objectName(ORION)).toBe('M 42 · Orion Nebula');
		expect(objectName(RUNNING_MAN)).toBe('M 43');
	});
});

describe('matching', () => {
	const all = [ORION, RUNNING_MAN, PLEIADES];

	it('finds an object by its number written either way, its name, its kind and its constellation', () => {
		expect(matching(all, 'm42')).toEqual([ORION]);
		expect(matching(all, 'M 45')).toEqual([PLEIADES]);
		expect(matching(all, 'orion')).toEqual([ORION]);
		expect(matching(all, 'NEBULA')).toEqual([ORION]);
		expect(matching(all, 'tau')).toEqual([PLEIADES]);
	});

	it('reads what is typed with its spaces run together, and lists all for nothing', () => {
		expect(matching(all, '  open   cluster ')).toEqual([RUNNING_MAN, PLEIADES]);
		expect(matching(all, ' ')).toBe(all);
	});
});

/** The middle of the test sky, and the place opposite it. */
const SKY = chart();
const CENTRE = orientationToPointing(SKY.view.orientation);
const AT_CENTRE = { ra_deg: CENTRE.raDeg, dec_deg: CENTRE.decDeg };
const OPPOSITE = { ra_deg: (CENTRE.raDeg + 180) % 360, dec_deg: -CENTRE.decDeg };

describe('objectsOn', () => {
	const near = object(1, { ...AT_CENTRE, mag: 8 });
	const far = object(2, { ...OPPOSITE, mag: 8 });
	const bright = object(3, { ...AT_CENTRE, mag: 2 });
	const twin = object(4, { ...AT_CENTRE, mag: 2 });

	it('lists what is on the sky, brightest first, and by number among the equally bright', () => {
		expect(isOnChart(SKY, near.ra_deg, near.dec_deg)).toBe(true);
		expect(isOnChart(SKY, far.ra_deg, far.dec_deg)).toBe(false);
		expect(objectsOn(SKY, [near, far, twin, bright])).toEqual([bright, twin, near]);
	});

	it('lists nothing without a sky', () => {
		expect(objectsOn(undefined, [near])).toEqual([]);
	});
});

describe('closeUpOf', () => {
	it('is the object where it is, named, at the field asked for', () => {
		expect(closeUpOf(ORION, 10)).toEqual({
			name: 'M 42 · Orion Nebula',
			raDeg: 83.8,
			decDeg: -5.4,
			fovDeg: 10
		});
	});
});

describe('FinderChoice', () => {
	const catalogue = [ORION, RUNNING_MAN, PLEIADES].map((o) => ({ ...o, ...AT_CENTRE }));

	it('draws the card for the first object listed, or for the one shown while it is listed', () => {
		const finder = new FinderChoice(
			() => SKY,
			() => catalogue
		);
		expect(finder.loaded).toBe(true);
		expect(finder.objects.map((o) => o.m)).toEqual([45, 42, 43]);
		expect(finder.shown?.m).toBe(45);
		finder.shownNumber = 43;
		expect(finder.shown?.m).toBe(43);
		finder.query = 'orion';
		expect(finder.listed.map((o) => o.m)).toEqual([42]);
		expect(finder.shown?.m).toBe(42);
	});

	it('is still loading while the catalogue is empty', () => {
		const finder = new FinderChoice(
			() => SKY,
			() => []
		);
		expect(finder.loaded).toBe(false);
		expect(finder.objects).toEqual([]);
		expect(finder.shown).toBeNull();
	});
});
