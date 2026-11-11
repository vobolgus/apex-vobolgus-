import { describe, expect, it } from 'vitest';
import type { ChartView } from '$lib/document/types';
import {
	CHART_CANVAS_BACKING_PX,
	CHART_RADIUS_FRAC,
	MARK_COLOR,
	PINHOLE_CORNER_RADIUS,
	STAR_COLOR
} from '$lib/constants';
import type { ChartSnapshot, SkyMark } from '$lib/document/types';
import { pointingToOrientation } from '$lib/math/pointing';
import type { StarVector } from '$lib/math/projection';
import { CHART_THUMB_PX, drawChartThumbnail, ringPoints, thumbnailCrop } from './chart-thumbnail';

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

interface Point {
	x: number;
	y: number;
}

/** What a drawing left on the canvas: the dots it filled and the paths it stroked. */
interface Drawing {
	dots: (Point & { r: number; style: string })[];
	strokes: { style: string; width: number; lines: Point[][] }[];
}

/** A canvas whose 2D context only writes down what is drawn on it. */
function recorder(): { canvas: HTMLCanvasElement; drawing: Drawing } {
	const drawing: Drawing = { dots: [], strokes: [] };
	let lines: Point[][] = [];
	let arcs: (Point & { r: number })[] = [];
	const ctx = {
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		lineJoin: 'miter',
		setTransform() {},
		clearRect() {},
		beginPath() {
			lines = [];
			arcs = [];
		},
		arc(x: number, y: number, r: number) {
			arcs.push({ x, y, r });
		},
		moveTo(x: number, y: number) {
			lines.push([{ x, y }]);
		},
		lineTo(x: number, y: number) {
			lines[lines.length - 1].push({ x, y });
		},
		fill() {
			for (const arc of arcs) drawing.dots.push({ ...arc, style: ctx.fillStyle });
		},
		stroke() {
			drawing.strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, lines });
		}
	};
	const canvas = { width: 0, height: 0, getContext: () => ctx };
	return { canvas: canvas as unknown as HTMLCanvasElement, drawing };
}

/** A chart whose centre is (`raDeg`, `decDeg`), north up. */
function looking(raDeg: number, decDeg: number, view: Partial<ChartView> = {}): ChartSnapshot {
	const orientation = pointingToOrientation({ raDeg, decDeg, paDeg: 0 });
	return {
		view: { ...VIEW, orientation, ...view },
		layers: {
			constellations: false,
			constellationBoundaries: false,
			equator: false,
			ecliptic: false,
			galacticEquator: false,
			planets: false
		},
		aspect: 1,
		createdAt: '2026-10-27T21:05:40.000Z'
	};
}

/** A bright star at a place on the sky. */
function starAt(raDeg: number, decDeg: number): StarVector {
	const ra = (raDeg * Math.PI) / 180;
	const dec = (decDeg * Math.PI) / 180;
	return {
		x: Math.cos(dec) * Math.cos(ra),
		y: Math.cos(dec) * Math.sin(ra),
		z: Math.sin(dec),
		v_mag: 1
	};
}

function draw(chart: ChartSnapshot, stars: StarVector[], width = 200, height = 200, starScale = 1) {
	const { canvas, drawing } = recorder();
	drawChartThumbnail(canvas, chart, width, height, stars, 1, starScale);
	return drawing;
}

const centroid = (points: Point[]): Point => ({
	x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
	y: points.reduce((sum, p) => sum + p.y, 0) / points.length
});

describe('ringPoints', () => {
	it('is a closed ring of unit vectors, each the radius from the place', () => {
		const mark: SkyMark = { raDeg: 83.8, decDeg: -5.4, radiusDeg: 10 };
		const centre = starAt(mark.raDeg, mark.decDeg);
		const ring = ringPoints(mark);
		expect(ring).toHaveLength(361);
		for (const point of ring) {
			expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1, 9);
			const cos = point.x * centre.x + point.y * centre.y + point.z * centre.z;
			expect((Math.acos(cos) * 180) / Math.PI).toBeCloseTo(10, 6);
		}
		expect(ring[360].x).toBeCloseTo(ring[0].x, 9);
		expect(ring[360].y).toBeCloseTo(ring[0].y, 9);
		expect(ring[360].z).toBeCloseTo(ring[0].z, 9);
		// It starts due east of the place and goes on through north, as the backend's does.
		const east = starAt(mark.raDeg + 90, 0);
		expect(ring[0].x * east.x + ring[0].y * east.y).toBeGreaterThan(0);
		expect(ring[90].z).toBeGreaterThan(centre.z);
	});
});

describe('drawChartThumbnail', () => {
	it('draws a star where the chart has it, and none that is off the chart', () => {
		const drawing = draw(looking(80, 20), [starAt(80, 20), starAt(95, 30), starAt(260, -20)]);
		expect(drawing.dots).toHaveLength(2);
		expect(drawing.dots[0].style).toBe(STAR_COLOR);
		// The chart's centre is the canvas's.
		expect(drawing.dots[0].x).toBeCloseTo(100, 6);
		expect(drawing.dots[0].y).toBeCloseTo(100, 6);
		// East is to the left of north, and north is up.
		expect(drawing.dots[1].x).toBeLessThan(100);
		expect(drawing.dots[1].y).toBeLessThan(100);
		expect(drawing.strokes).toEqual([]);
	});

	it('rings a marked place where a star there is drawn, a pixel wide in the accent', () => {
		const chart = looking(80, 20);
		chart.marks = [{ raDeg: 95, decDeg: 30, radiusDeg: 8 }];
		const drawing = draw(chart, [starAt(95, 30)]);
		const [star] = drawing.dots;
		expect(drawing.strokes).toHaveLength(1);
		const [ring] = drawing.strokes;
		expect(ring.style).toBe(MARK_COLOR);
		expect(ring.width).toBe(1);
		// One unbroken line, closed: every degree of the ring and its start again.
		expect(ring.lines).toHaveLength(1);
		const [line] = ring.lines;
		expect(line).toHaveLength(361);
		expect(line[360].x).toBeCloseTo(line[0].x, 6);
		expect(line[360].y).toBeCloseTo(line[0].y, 6);
		// Round the star: a disc of 180 deg is 200 px across, so 8 deg is about 7 px here.
		const middle = centroid(line.slice(0, 360));
		expect(Math.abs(middle.x - star.x)).toBeLessThan(0.5);
		expect(Math.abs(middle.y - star.y)).toBeLessThan(0.5);
		for (const point of line) {
			const away = Math.hypot(point.x - star.x, point.y - star.y);
			expect(away).toBeGreaterThan(6);
			expect(away).toBeLessThan(9);
		}
	});

	it('rings every mark of a chart, each with a stroke of its own', () => {
		const chart = looking(80, 20);
		chart.marks = [
			{ raDeg: 95, decDeg: 30, radiusDeg: 8 },
			{ raDeg: 60, decDeg: 0, radiusDeg: 4 }
		];
		const drawing = draw(chart, []);
		expect(drawing.strokes).toHaveLength(2);
		expect(drawing.strokes[1].lines[0]).toHaveLength(361);
	});

	it('strokes nothing on a chart with no marks', () => {
		expect(draw(looking(80, 20), [starAt(95, 30)]).strokes).toEqual([]);
		const empty = looking(80, 20);
		empty.marks = [];
		expect(draw(empty, [starAt(95, 30)]).strokes).toEqual([]);
	});

	it('strokes nothing for a mark that is off the chart', () => {
		const chart = looking(80, 20);
		// The other side of the sky.
		chart.marks = [{ raDeg: 260, decDeg: -20, radiusDeg: 8 }];
		expect(draw(chart, []).strokes).toEqual([]);
	});

	it('draws only the part of a ring that is on the disc', () => {
		const chart = looking(80, 20);
		// Centred 85 deg from the middle of a 180 deg disc: half in, half out.
		chart.marks = [{ raDeg: 80, decDeg: -65, radiusDeg: 15 }];
		const drawing = draw(chart, []);
		expect(drawing.strokes).toHaveLength(1);
		const points = drawing.strokes[0].lines.flat();
		expect(points.length).toBeGreaterThan(20);
		expect(points.length).toBeLessThan(300);
		for (const point of points) {
			expect(Math.hypot(point.x - 100, point.y - 100)).toBeLessThanOrEqual(100 + 1e-6);
		}
	});

	it('draws only the part of a ring that is in a pinhole frame', () => {
		const chart = looking(80, 20, { projection: 'pinhole', pinholeFovDeg: 40 });
		chart.aspect = 2;
		// On the frame's left edge: the frame is 40 deg across.
		chart.marks = [{ raDeg: 101, decDeg: 20, radiusDeg: 5 }];
		const drawing = draw(chart, [], 200, 100);
		expect(drawing.strokes).toHaveLength(1);
		const points = drawing.strokes[0].lines.flat();
		expect(points.length).toBeGreaterThan(20);
		expect(points.length).toBeLessThan(300);
		for (const point of points) {
			expect(point.x).toBeGreaterThanOrEqual(-1e-6);
			expect(point.x).toBeLessThan(40);
			expect(point.y).toBeGreaterThanOrEqual(-1e-6);
			expect(point.y).toBeLessThanOrEqual(100 + 1e-6);
		}
	});

	it('thins the ring with the stars while the drawing is shown larger', () => {
		const chart = looking(80, 20);
		chart.marks = [{ raDeg: 95, decDeg: 30, radiusDeg: 8 }];
		const drawing = draw(chart, [starAt(95, 30)], 200, 200, 0.25);
		expect(drawing.strokes[0].width).toBeCloseTo(0.25, 9);
	});
});
