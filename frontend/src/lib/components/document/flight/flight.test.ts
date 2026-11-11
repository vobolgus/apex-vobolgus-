import { describe, expect, it } from 'vitest';
import type { ChartView } from '$lib/document/types';
import { CHART_RADIUS_FRAC } from '$lib/constants';
import {
	chartBoxOnScreen,
	FLIGHT_FADE,
	flightEdgeKeyframes,
	flightKeyframes,
	flightPixelRatio,
	flightScale,
	flightStarScale,
	settleKeyframes
} from './flight';

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: { x: 0, y: 0, z: 0, w: 1 },
	stereoFovDeg: 180,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 2,
	pinholeHeightFrac: 1
};

/** The chart on screen, and its place on a page thumbnail. */
const FROM = { x: 400, y: 100, width: 600, height: 600 };
const TO = { x: 30, y: 90, width: 60, height: 60 };

describe('chartBoxOnScreen', () => {
	it('is the disc, centred on its canvas', () => {
		const box = chartBoxOnScreen({ x: 100, y: 50, width: 600, height: 600 }, VIEW);
		const diameter = 2 * CHART_RADIUS_FRAC * 600;
		expect(box.width).toBeCloseTo(diameter, 9);
		expect(box.height).toBeCloseTo(diameter, 9);
		expect(box.x + box.width / 2).toBeCloseTo(400, 9);
		expect(box.y + box.height / 2).toBeCloseTo(350, 9);
	});

	it('is the pinhole frame, at its aspect', () => {
		const box = chartBoxOnScreen(
			{ x: 0, y: 0, width: 600, height: 600 },
			{ ...VIEW, projection: 'pinhole' }
		);
		expect(box.width / box.height).toBeCloseTo(2, 9);
		expect(box.height).toBeCloseTo(CHART_RADIUS_FRAC * 600, 9);
		expect(box.x + box.width / 2).toBeCloseTo(300, 9);
	});
});

describe('settleKeyframes', () => {
	it('plays a chart the Add moved from where it was to where it now is', () => {
		// It filled the sheet's width, and now shares the sheet: half the size, further up.
		const frames = settleKeyframes(
			{ x: 20, y: 40, width: 60, height: 60 },
			{ x: 35, y: 30, width: 30, height: 30 }
		)!;
		expect(frames[0].transform).toBe('translate(0px, 25px) scale(2)');
		expect(frames[1].transform).toBe('none');
	});

	it('leaves alone a chart that did not move', () => {
		const box = { x: 20, y: 40, width: 60, height: 60 };
		expect(settleKeyframes(box, { ...box })).toBeNull();
		expect(settleKeyframes(box, { ...box, x: 20.1 })).toBeNull();
		expect(settleKeyframes(box, { ...box, width: 0 })).toBeNull();
	});
});

describe('the flight', () => {
	it('starts over the chart, as many times larger as the chart is, and ends in its place untransformed', () => {
		expect(flightScale(FROM, TO)).toBe(10);
		const frames = flightKeyframes(FROM, TO);
		// Laid out at (30, 90): its centre is (60, 120), the chart's (700, 400).
		expect(frames[0].transform).toBe('translate(640px, 280px) scale(10)');
		expect(frames[frames.length - 1].transform).toBe('none');
	});

	it('comes up as it lifts off and is solid from there to the landing', () => {
		expect(FLIGHT_FADE[0].opacity).toBe(0);
		expect(FLIGHT_FADE[1].opacity).toBe(1);
		expect(FLIGHT_FADE[1].offset).toBeLessThan(0.25);
		// It hands over to the thumbnail at full strength: no fade to hide a mismatch.
		expect(FLIGHT_FADE[FLIGHT_FADE.length - 1].opacity).toBe(1);
	});

	it('keeps the edge a hairline: thin by the scale at the start, 1 px at the end', () => {
		const frames = flightEdgeKeyframes(FROM, TO, 'gray');
		expect(frames[0].boxShadow).toBe('inset 0 0 0 0.1px gray');
		expect(frames[1].boxShadow).toBe('inset 0 0 0 1px gray');
	});

	it("keeps the stars a little larger than the thumbnail's all the way, and exactly its size on landing", () => {
		// On screen a star is its drawn size times the copy's scale.
		const onScreen = (scale: number) => flightStarScale(scale, 10) * scale;
		expect(onScreen(10)).toBeCloseTo(2.2, 9);
		expect(onScreen(1)).toBe(1);
		// Never the blot the plain scaling would give, and never smaller than it will end up.
		let last = onScreen(10);
		for (let scale = 9.5; scale >= 1; scale -= 0.5) {
			const size = onScreen(scale);
			expect(size).toBeLessThanOrEqual(last + 1e-9);
			expect(size).toBeGreaterThanOrEqual(1);
			last = size;
		}
		// A copy that does not shrink has nothing to correct.
		expect(flightStarScale(1, 1)).toBe(1);
	});

	it('draws the copy with more pixels while it is large, up to a cap', () => {
		expect(flightPixelRatio(FROM, TO, 2)).toBe(8);
		expect(flightPixelRatio({ ...FROM, width: 120 }, TO, 2)).toBe(4);
		// Never fewer than the screen's own.
		expect(flightPixelRatio({ ...FROM, width: 30 }, TO, 2)).toBe(2);
	});
});
