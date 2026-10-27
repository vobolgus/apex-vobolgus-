/**
 * The placeholder a chart shows on its page until the vector preview loads: the
 * preview canvas cut to the chart (the disc or the pinhole frame) and scaled
 * down, with the dark page around it left transparent so the paper shows.
 */

import { chartSizePx, type ChartView } from '$lib/api/render-config';
import { CHART_CANVAS_BACKING_PX, PINHOLE_CORNER_RADIUS } from '$lib/constants';

/** Long side of the thumbnail, px: sharp in the pages panel, small in storage. */
export const CHART_THUMB_PX = 320;

export interface ThumbnailCrop {
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
