import { describe, expect, it } from 'vitest';
import type { CatalogStar } from '$lib/api/catalog-types';
import { constellationName, starName } from './index';

const DEG = Math.PI / 180;

const star = (raHours: number, decDeg: number, v_mag: number): CatalogStar => ({
	ra: raHours * 15 * DEG,
	dec: decDeg * DEG,
	v_mag
});

describe('names', () => {
	it('gives the constellations in full', () => {
		expect(constellationName('Ori')).toBe('Orion');
		expect(constellationName('CVn')).toBe('Canes Venatici');
		expect(constellationName('Xyz')).toBe('Xyz');
	});

	it('names a bright star by its place, once', () => {
		const taken = new Set<string>();
		const sirius = star(6.752, -16.716, -1.44);
		expect(starName(sirius.ra, sirius.dec, taken)).toBe('Sirius');
		// A companion as near gets no name: the brighter, met first, has it.
		expect(starName(sirius.ra + 0.001, sirius.dec, taken)).toBeNull();
		const vega = star(18.616, 38.784, 0.03);
		expect(starName(vega.ra, vega.dec, taken)).toBe('Vega');
		// A star of no fame, and a place a degree off a famous one.
		expect(starName(star(3, 3, 5).ra, star(3, 3, 5).dec, new Set())).toBeNull();
		expect(starName(vega.ra, vega.dec + 1 * DEG, new Set())).toBeNull();
		// Polaris, where right ascension means little.
		const polaris = star(2.53, 89.264, 1.97);
		expect(starName(polaris.ra + 0.2, polaris.dec, new Set())).toBe('Polaris');
		// In Russian, by the name it goes by there; taken all the same, whatever it was called.
		const again = new Set<string>();
		expect(starName(vega.ra, vega.dec, again, 'ru')).toBe('Вега');
		expect(starName(vega.ra, vega.dec, again)).toBeNull();
		expect(
			starName(star(14.66, -60.834, -0.01).ra, star(14.66, -60.834, -0.01).dec, again, 'ru')
		).toBe('Альфа Центавра');
	});
});
