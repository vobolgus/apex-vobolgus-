import { describe, expect, it } from 'vitest';
import type { ChartView } from '$lib/api/render-config';
import { CHART_CANVAS_BACKING_PX, CHART_RADIUS_FRAC, PINHOLE_CORNER_RADIUS } from '$lib/constants';
import { CHART_THUMB_PX, thumbnailCrop } from './chart-thumbnail';

const VIEW: ChartView = {
	projection: 'stereographic',
	orientation: { x: 0, y: 0, z: 0, w: 1 },
	stereoFovDeg: 180,
	pinholeFovDeg: 100,
	pinholeAspectRatio: 2,
	pinholeHeightFrac: 1
};

describe('thumbnailCrop', () => {
	it('cuts the disc out of the centre of the canvas, round', () => {
		const crop = thumbnailCrop(VIEW);
		const diameter = 2 * CHART_RADIUS_FRAC * CHART_CANVAS_BACKING_PX;
		expect(crop.sw).toBeCloseTo(diameter, 9);
		expect(crop.sh).toBeCloseTo(diameter, 9);
		expect(crop.sx).toBeCloseTo((CHART_CANVAS_BACKING_PX - diameter) / 2, 9);
		expect(crop.sy).toBeCloseTo(crop.sx, 9);
		expect(crop.width).toBe(CHART_THUMB_PX);
		expect(crop.height).toBe(CHART_THUMB_PX);
		expect(crop.radius).toBe(CHART_THUMB_PX / 2);
	});

	it('cuts the pinhole frame, its long side scaled to the thumbnail size', () => {
		const crop = thumbnailCrop({ ...VIEW, projection: 'pinhole' });
		const height = CHART_RADIUS_FRAC * CHART_CANVAS_BACKING_PX;
		expect(crop.sw).toBeCloseTo(2 * height, 9);
		expect(crop.sh).toBeCloseTo(height, 9);
		expect(crop.sx).toBeCloseTo(CHART_CANVAS_BACKING_PX / 2 - height, 9);
		expect(crop.sy).toBeCloseTo(CHART_CANVAS_BACKING_PX / 2 - height / 2, 9);
		expect(crop.width).toBe(CHART_THUMB_PX);
		expect(crop.height).toBe(CHART_THUMB_PX / 2);
		expect(crop.radius).toBeCloseTo((PINHOLE_CORNER_RADIUS * CHART_THUMB_PX) / (2 * height), 9);
	});

	it('takes another size', () => {
		const crop = thumbnailCrop({ ...VIEW, projection: 'pinhole', pinholeAspectRatio: 0.5 }, 100);
		expect(crop.height).toBe(100);
		expect(crop.width).toBe(50);
	});
});
