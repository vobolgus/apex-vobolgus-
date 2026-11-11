import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartLayers, ChartView } from '$lib/api/render-config';
import {
	CHART_RADIUS_FRAC,
	MAX_FOV_DEG_PINHOLE,
	MIN_FOV_DEG_STEREO,
	PINHOLE_ASPECT_RATIO_MAX
} from '$lib/constants';
import { orientationToPointing, pointingToOrientation } from '$lib/math/pointing';
import {
	applySharedView,
	decodeViewHash,
	encodeViewHash,
	ViewUrl,
	type ViewUrlHost
} from './view-url';

const ORION = pointingToOrientation({ raDeg: 83.822, decDeg: -5.391, paDeg: 15 });

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: ORION,
	stereoFovDeg: 60,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 1.6,
	pinholeHeightFrac: 1.18
};

const NO_LAYERS: ChartLayers = {
	constellations: false,
	constellationBoundaries: false,
	equator: false,
	ecliptic: false,
	galacticEquator: false,
	planets: false
};

describe('encodeViewHash', () => {
	it('writes the stereo view as its centre, the angle of its top and its field of view', () => {
		expect(encodeViewHash(VIEW, NO_LAYERS)).toBe('p=stereo&ra=83.822&dec=-5.391&pa=15&fov=60');
	});

	it('adds the frame for pinhole, with the pinhole field of view', () => {
		expect(encodeViewHash({ ...VIEW, projection: 'pinhole' }, NO_LAYERS)).toBe(
			'p=pinhole&ra=83.822&dec=-5.391&pa=15&fov=100&ar=1.6&size=1.18'
		);
	});

	it('lists the layers that are on', () => {
		const layers = { ...NO_LAYERS, constellations: true, ecliptic: true, planets: true };
		expect(encodeViewHash(VIEW, layers)).toMatch(/&layers=lines,ecliptic,planets$/);
	});
});

describe('decodeViewHash', () => {
	it('ignores a fragment that is not a view', () => {
		expect(decodeViewHash('')).toBeNull();
		expect(decodeViewHash('#about')).toBeNull();
		expect(decodeViewHash('#fov=40&layers=lines')).toBeNull();
		expect(decodeViewHash('#p=fisheye&ra=abc&dec=1')).toBeNull();
	});

	it('reads what it wrote, with or without the #', () => {
		const layers = { ...NO_LAYERS, constellationBoundaries: true, galacticEquator: true };
		for (const projection of ['stereographic', 'pinhole'] as const) {
			const view = { ...VIEW, projection };
			const hash = encodeViewHash(view, layers);
			for (const text of [hash, `#${hash}`]) {
				const shared = decodeViewHash(text);
				expect(shared).not.toBeNull();
				expect(shared!.layers).toEqual(layers);
				const back = applySharedView({ ...VIEW, orientation: { x: 0, y: 0, z: 0, w: 1 } }, shared!);
				// The fragment is the fixed point: what was read writes the same address.
				expect(encodeViewHash(back, shared!.layers)).toBe(hash);
			}
		}
	});

	it('turns every layer off when the fragment names none', () => {
		expect(decodeViewHash('#p=stereo')!.layers).toEqual(NO_LAYERS);
		expect(decodeViewHash('#p=stereo&layers=bogus,ecliptic')!.layers).toEqual({
			...NO_LAYERS,
			ecliptic: true
		});
	});

	it('takes north up when the position angle is missing', () => {
		const shared = decodeViewHash('#ra=10&dec=20')!;
		expect(shared.projection).toBeUndefined();
		const pointing = orientationToPointing(shared.orientation!);
		expect(pointing.raDeg).toBeCloseTo(10, 6);
		expect(pointing.decDeg).toBeCloseTo(20, 6);
		expect(pointing.paDeg).toBeCloseTo(0, 6);
	});
});

describe('applySharedView', () => {
	it('keeps what the fragment does not name', () => {
		const next = applySharedView(VIEW, decodeViewHash('#p=pinhole')!);
		expect(next).toEqual({ ...VIEW, projection: 'pinhole' });
	});

	it('gives the field of view to the projection the chart ends up in', () => {
		expect(applySharedView(VIEW, decodeViewHash('#ra=1&dec=2&fov=45')!).stereoFovDeg).toBe(45);
		const pinhole = applySharedView(VIEW, decodeViewHash('#p=pinhole&fov=45')!);
		expect(pinhole.pinholeFovDeg).toBe(45);
		expect(pinhole.stereoFovDeg).toBe(VIEW.stereoFovDeg);
	});

	it('clamps numbers to what the controls reach', () => {
		expect(applySharedView(VIEW, decodeViewHash('#p=stereo&fov=1')!).stereoFovDeg).toBe(
			MIN_FOV_DEG_STEREO
		);
		const pinhole = applySharedView(VIEW, decodeViewHash('#p=pinhole&fov=999&ar=99&size=99')!);
		expect(pinhole.pinholeFovDeg).toBe(MAX_FOV_DEG_PINHOLE);
		expect(pinhole.pinholeAspectRatio).toBe(PINHOLE_ASPECT_RATIO_MAX);
		// As wide as the chart surface, no wider.
		expect(pinhole.pinholeAspectRatio * pinhole.pinholeHeightFrac).toBeCloseTo(
			1 / CHART_RADIUS_FRAC,
			9
		);
	});

	it('clamps a declination past the pole', () => {
		const shared = decodeViewHash('#ra=0&dec=120')!;
		expect(orientationToPointing(shared.orientation!).decDeg).toBeCloseTo(90, 6);
	});
});

/** A chart whose view the test reads, and an address bar the test can look at. */
function setup(hash = '', view: ChartView = VIEW) {
	const shown: { next: ChartView; fly: boolean }[] = [];
	const layers = { ...NO_LAYERS, assign: (values: ChartLayers) => Object.assign(layers, values) };
	const chart: { view: ChartView; host: ViewUrlHost } = {
		view,
		host: {
			get chartView(): ChartView {
				return chart.view;
			},
			layers,
			show(next: ChartView, fly: boolean) {
				shown.push({ next, fly });
				chart.view = next;
			}
		}
	};
	const address = {
		hash,
		written: [] as string[],
		refuse: false,
		replace(next: string) {
			if (address.refuse) throw new Error('too many calls');
			address.written.push(next);
			address.hash = `#${next}`;
		}
	};
	return { chart, layers, shown, address, url: new ViewUrl(chart.host, address) };
}

function reduceMotion(reduce: boolean) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: reduce && query.includes('prefers-reduced-motion')
	}));
}

describe('ViewUrl', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('takes the view a link brings on a load, with its layers, and writes nothing back', () => {
		const { url, shown, layers, address } = setup('#p=pinhole&ra=10&dec=20&fov=45&layers=lines');
		url.read();
		expect(shown).toHaveLength(1);
		expect(shown[0].fly).toBe(false);
		expect(shown[0].next.projection).toBe('pinhole');
		expect(shown[0].next.pinholeFovDeg).toBe(45);
		expect(layers.constellations).toBe(true);

		url.follow();
		vi.advanceTimersByTime(1000);
		expect(address.written).toEqual([]);
	});

	it('keeps a plain address until the view changes, then follows it once it is still', () => {
		const { url, chart, shown, address } = setup();
		url.read();
		expect(shown).toEqual([]);
		url.follow();
		vi.advanceTimersByTime(1000);
		expect(address.written).toEqual([]);

		chart.view = { ...VIEW, stereoFovDeg: 90 };
		url.follow();
		vi.advanceTimersByTime(200);
		// Still moving: the wait starts again.
		chart.view = { ...VIEW, stereoFovDeg: 80 };
		url.follow();
		vi.advanceTimersByTime(299);
		expect(address.written).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(address.written).toEqual([encodeViewHash(chart.view, NO_LAYERS)]);
	});

	it('does not write before the address has been read', () => {
		const { url, chart, address } = setup();
		chart.view = { ...VIEW, stereoFovDeg: 90 };
		url.follow();
		vi.advanceTimersByTime(1000);
		expect(address.written).toEqual([]);
	});

	it('tries again on the next change when the browser refuses a write', () => {
		const { url, chart, address } = setup();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		url.read();
		address.refuse = true;
		chart.view = { ...VIEW, stereoFovDeg: 90 };
		url.follow();
		vi.advanceTimersByTime(300);
		expect(console.error).toHaveBeenCalledTimes(1);

		address.refuse = false;
		url.follow();
		vi.advanceTimersByTime(300);
		expect(address.written).toEqual([encodeViewHash(chart.view, NO_LAYERS)]);
	});

	it('writes a waiting change at once when the tab goes away, and nothing when none waits', () => {
		const { url, chart, address } = setup();
		url.read();
		url.flush();
		expect(address.written).toEqual([]);

		chart.view = { ...VIEW, stereoFovDeg: 90 };
		url.follow();
		url.flush();
		expect(address.written).toHaveLength(1);
		vi.advanceTimersByTime(1000);
		expect(address.written).toHaveLength(1);
	});

	it('flies to a link pasted into the open tab, within one projection only', () => {
		reduceMotion(false);
		const { url, shown, address } = setup();
		url.read();
		const stop = url.listen();

		address.hash = '#p=stereo&ra=200&dec=-30&pa=40&fov=60';
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		expect(shown.at(-1)?.fly).toBe(true);

		address.hash = '#p=pinhole&ra=200&dec=-30&pa=40&fov=60';
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		expect(shown.at(-1)?.fly).toBe(false);

		stop();
		address.hash = '#p=pinhole&ra=10&dec=10';
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		expect(shown).toHaveLength(2);
	});

	it('cuts to a pasted link when less motion is asked for', () => {
		reduceMotion(true);
		const { url, shown, address } = setup();
		url.read();
		address.hash = '#p=stereo&ra=200&dec=-30&pa=40&fov=60';
		url.read(true);
		expect(shown.at(-1)?.fly).toBe(false);
	});
});
