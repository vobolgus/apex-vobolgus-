import { describe, expect, it } from 'vitest';
import { chartCentreX, clearWidthAroundChart } from './chart-area';

describe('chartCentreX', () => {
	it('keeps the chart in the middle while it clears both panels there', () => {
		expect(chartCentreX(1256, 644, 0, 0)).toBe(628);
		// The layers panel open on a 1280 px window: room to spare, nothing moves.
		expect(chartCentreX(1256, 644, 0, 244)).toBe(628);
		expect(chartCentreX(1256, 644, 142, 244)).toBe(628);
	});

	it('moves the chart over just far enough in a narrower window', () => {
		// 1000 wide, the layers panel on the right: the chart's edge meets the reserve.
		expect(chartCentreX(1000, 644, 0, 244)).toBe(1000 - 244 - 322);
		// The pages panel alone pushes it the other way.
		expect(chartCentreX(900, 720, 142, 0)).toBe(142 + 360);
	});

	it('sits between the panels when the chart fills what is left', () => {
		expect(chartCentreX(1000, 614, 142, 244)).toBe(142 + 307);
	});

	it('moves continuously as the window narrows', () => {
		let last = chartCentreX(1300, 644, 0, 244);
		for (let width = 1299; width >= 900; width -= 1) {
			const next = chartCentreX(width, 644, 0, 244);
			expect(Math.abs(next - last)).toBeLessThanOrEqual(1);
			last = next;
		}
	});
});

describe('clearWidthAroundChart', () => {
	it('is the area less the reserve on both sides when the chart is in the middle', () => {
		expect(clearWidthAroundChart(1256, 644, 142, 142)).toBe(1256 - 284);
		expect(clearWidthAroundChart(1256, 644, 0, 0)).toBe(1256);
	});

	it('is bounded by the nearer panel', () => {
		// Centred at 628 with the panel 244 in from the right: 384 px to it, 628 to the left edge.
		expect(clearWidthAroundChart(1256, 644, 0, 244)).toBe(2 * 384);
	});

	it('is the chart itself once the chart has moved against a panel', () => {
		expect(clearWidthAroundChart(1000, 644, 0, 244)).toBe(644);
	});

	it('is never negative', () => {
		expect(clearWidthAroundChart(300, 644, 142, 244)).toBe(0);
	});
});
