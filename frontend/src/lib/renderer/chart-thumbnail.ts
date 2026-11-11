/**
 * The placeholder a chart shows on its page until the vector preview loads: the
 * preview canvas cut to the chart (the disc or the pinhole frame) and scaled
 * down, with the dark page around it left transparent so the paper shows.
 */

import { chartSizePx, type ChartView } from '$lib/api/render-config';
import {
	CHART_CANVAS_BACKING_PX,
	MARK_COLOR,
	PINHOLE_CORNER_RADIUS,
	STAR_COLOR
} from '$lib/constants';
import type { ChartSnapshot, SkyMark } from '$lib/document/types';
import {
	getProjectionFrameParams,
	sampleStarMorphFrame,
	toViewSpace,
	type StarVector
} from '$lib/math/projection';

/** Long side of the thumbnail, px: sharp in the pages panel, small in storage. */
export const CHART_THUMB_PX = 320;

interface ThumbnailCrop {
	/** The chart's box on the canvas, canvas px. */
	sx: number;
	sy: number;
	sw: number;
	sh: number;
	/** The thumbnail's size, px. */
	width: number;
	height: number;
	/** Corner radius of the clip in thumbnail px; half the side for the disc. */
	radius: number;
}

/** Where the chart sits on the (square, centred) preview canvas and the thumbnail's size. */
export function thumbnailCrop(view: ChartView, longSidePx = CHART_THUMB_PX): ThumbnailCrop {
	const { width: sw, height: sh } = chartSizePx(view);
	const scale = longSidePx / Math.max(sw, sh);
	const width = Math.max(1, Math.round(sw * scale));
	const height = Math.max(1, Math.round(sh * scale));
	const centre = CHART_CANVAS_BACKING_PX / 2;
	const radius =
		view.projection === 'stereographic'
			? width / 2
			: Math.min(PINHOLE_CORNER_RADIUS * scale, width / 2, height / 2);
	return { sx: centre - sw / 2, sy: centre - sh / 2, sw, sh, width, height, radius };
}

/**
 * A PNG data URL of the chart as `canvas` shows it now, or undefined where the
 * canvas cannot be read (no 2D context, a tainted canvas).
 */
export function chartThumbnail(canvas: HTMLCanvasElement, view: ChartView): string | undefined {
	const crop = thumbnailCrop(view);
	try {
		const out = document.createElement('canvas');
		out.width = crop.width;
		out.height = crop.height;
		const ctx = out.getContext('2d');
		if (!ctx) return undefined;
		ctx.beginPath();
		ctx.roundRect(0, 0, crop.width, crop.height, crop.radius);
		ctx.clip();
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(canvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.width, crop.height);
		return out.toDataURL('image/png');
	} catch {
		return undefined;
	}
}

/**
 * Page-thumbnail stars, CSS px of radius: the brightest, the floor, and the step
 * per magnitude. Small enough that a sheet reads as a chart and not as a spatter
 * of blots: at 1.2 px the bright stars of a 60 px chart ran into each other.
 */
const THUMB_STAR_MAX_PX = 0.85;
const THUMB_STAR_MIN_PX = 0.3;
const THUMB_STAR_PER_MAG = 0.16;

/**
 * The faintest star a thumbnail chart `sidePx` across draws: a few hundred dots read
 * as the sky's figures, the full catalogue as a grey wash.
 */
function thumbnailMagnitudeLimit(sidePx: number): number {
	return sidePx < 60 ? 3.2 : sidePx < 120 ? 4 : 4.8;
}

/** A mark's ring on a page thumbnail, CSS px wide. */
const THUMB_MARK_PX = 1;
/** The ring is traced in steps of a degree, as the backend traces it. */
const RING_STEPS = 360;

/**
 * The ring of points `radiusDeg` from a mark's place, closed, as unit vectors: the
 * backend's `ring_points` (backend/src/svg_generator/grids.rs), so that the
 * thumbnail's ring is the one the vector preview and the PDF draw.
 */
export function ringPoints(mark: SkyMark): StarVector[] {
	const ra = (mark.raDeg * Math.PI) / 180;
	const dec = (mark.decDeg * Math.PI) / 180;
	const radius = (mark.radiusDeg * Math.PI) / 180;
	// The centre, and two directions square to it and to each other: east and north.
	const centre = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
	const east = [-Math.sin(ra), Math.cos(ra), 0];
	const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
	const points: StarVector[] = [];
	for (let step = 0; step <= RING_STEPS; step++) {
		const angle = (step * 2 * Math.PI) / RING_STEPS;
		const at = (i: number) =>
			Math.cos(radius) * centre[i] +
			Math.sin(radius) * (Math.cos(angle) * east[i] + Math.sin(angle) * north[i]);
		points.push({ x: at(0), y: at(1), z: at(2), v_mag: 0 });
	}
	return points;
}

/**
 * Draws a chart for a page thumbnail on `canvas`, `width` × `height` CSS px: the
 * preview's own camera, but only the brighter stars, none under a floor. The vector
 * preview, and the preview's pixels scaled down, both draw the stars at their size
 * on paper, which at this scale is far under a pixel: the sheet looked empty.
 *
 * `dpr` is the backing store's density, and `starScale` multiplies every star's
 * radius. The copy that flies to the page on Add to PDF is this same drawing shown
 * several times larger: it asks for that many times the pixels, so that it is
 * sharp on the way, and for smaller stars while it is large, so that they do not
 * arrive as blots (`flightStarScale`). On the thumbnail itself both are 1.
 *
 * A place ringed on the chart (`marks`, a finder card's) is ringed here too, over
 * the stars: the part of the ring that is on the chart, as a star off it is not drawn.
 */
export function drawChartThumbnail(
	canvas: HTMLCanvasElement,
	chart: ChartSnapshot,
	width: number,
	height: number,
	stars: readonly StarVector[],
	dpr = 1,
	starScale = 1
): void {
	canvas.width = Math.max(1, Math.round(width * dpr));
	canvas.height = Math.max(1, Math.round(height * dpr));
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);

	const { view } = chart;
	const blend = view.projection === 'pinhole' ? 1 : 0;
	const params = getProjectionFrameParams(
		CHART_CANVAS_BACKING_PX,
		CHART_CANVAS_BACKING_PX,
		blend,
		view.stereoFovDeg,
		view.pinholeFovDeg,
		view.pinholeAspectRatio,
		view.pinholeHeightFrac
	);
	// The preview's chart, centred on its canvas, mapped onto this one.
	const scale = width / (2 * params.morphHalfWidth);
	const limit = thumbnailMagnitudeLimit(Math.min(width, height));
	const rotate = (x: number, y: number, z: number) => toViewSpace(x, y, z, view.orientation);
	ctx.fillStyle = STAR_COLOR;
	for (const star of stars) {
		if (star.v_mag > limit) continue;
		const sample = sampleStarMorphFrame(star, blend, params, rotate);
		if (sample.visibility < 0.5) continue;
		const r =
			starScale * Math.max(THUMB_STAR_MIN_PX, THUMB_STAR_MAX_PX - THUMB_STAR_PER_MAG * star.v_mag);
		ctx.beginPath();
		ctx.arc(width / 2 + sample.px * scale, height / 2 + sample.py * scale, r, 0, Math.PI * 2);
		ctx.fill();
	}

	if (!chart.marks?.length) return;
	ctx.strokeStyle = MARK_COLOR;
	// Thinner while the drawing is shown larger, as the stars are smaller.
	ctx.lineWidth = THUMB_MARK_PX * starScale;
	ctx.lineJoin = 'round';
	for (const mark of chart.marks) {
		ctx.beginPath();
		// The pen is down while the ring is on the chart, and lifted where it leaves it.
		let down = false;
		let drawn = false;
		for (const point of ringPoints(mark)) {
			const sample = sampleStarMorphFrame(point, blend, params, rotate);
			if (sample.visibility < 0.5) {
				down = false;
				continue;
			}
			const x = width / 2 + sample.px * scale;
			const y = height / 2 + sample.py * scale;
			if (down) {
				ctx.lineTo(x, y);
				drawn = true;
			} else {
				ctx.moveTo(x, y);
				down = true;
			}
		}
		if (drawn) ctx.stroke();
	}
}
