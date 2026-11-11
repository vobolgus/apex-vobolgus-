/**
 * The flight of a chart from the preview to its page, on Add to PDF.
 *
 * The page's thumbnail keeps the chart's place empty; a copy of the chart, drawn
 * exactly as the thumbnail will draw it, appears over the preview, shrinks along
 * the way and comes to a stop on that place; there the thumbnail draws the chart
 * and the copy is taken away. Since the two are the same drawing at the same
 * size, nothing changes under the eye at that moment.
 *
 * Geometry and timing only; the flight itself (`PdfFlight`) owns the copy and
 * runs the animation, and the pages panel says where the copy lands (`reveal`).
 */

import type { ChartView } from '$lib/api/render-config';
import { CHART_CANVAS_BACKING_PX } from '$lib/constants';
import { thumbnailCrop } from '$lib/renderer/chart-thumbnail';

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A chart on its way to a page, as the pages panel needs to know it. */
export interface Landing {
	itemId: string;
	/** The chart opened a page of its own, which makes its entrance as the copy flies. */
	newPage: boolean;
	/** How long the copy is in the air: the page's flash waits for it. */
	ms: number;
	/**
	 * Where every chart was on the thumbnails before the Add (`PagesPanel.chartBoxes`).
	 * The charts already on the page may have moved to make room; they are played to
	 * their new places over the length of the flight, so the room is seen being made.
	 */
	before?: Readonly<Record<string, Box>>;
}

/** Where the copy comes to a stop: the chart's place on the thumbnail, and its corner radius there. */
export interface LandingTarget {
	box: Box;
	/** A CSS length or percentage, as the thumbnail's chart has it. */
	corner: string;
}

/** How long the copy is in the air. */
export const PDF_FLIGHT_MS = 620;
/**
 * The copy sets off gently and brakes into its place. A curve that spends itself
 * at the start would have it at the panel within a few frames, with nothing for
 * the eye to follow.
 */
export const PDF_FLIGHT_EASING = 'cubic-bezier(0.5, 0, 0.2, 1)';
/** The copy is drawn with at most this many times the thumbnail's pixels. */
const MAX_OVERSAMPLE = 4;
/**
 * How much larger than on the thumbnail the copy's stars are, on screen, as it
 * lifts off; they come down to the thumbnail's size as it lands. About the size
 * of the preview's own bright stars, so the copy comes up over the chart without
 * every star jumping.
 */
const FLIGHT_STAR_GAIN = 2.2;

/**
 * Where the chart itself (the disc, or the pinhole frame) is on screen, given where
 * its canvas is: the canvas is square with the chart centred on it.
 */
export function chartBoxOnScreen(canvas: Box, view: ChartView): Box {
	const crop = thumbnailCrop(view);
	const scale = canvas.width / CHART_CANVAS_BACKING_PX;
	return {
		x: canvas.x + crop.sx * scale,
		y: canvas.y + crop.sy * scale,
		width: crop.sw * scale,
		height: crop.sh * scale
	};
}

/** How many times larger than its place on the thumbnail the copy starts out. */
export function flightScale(from: Box, to: Box): number {
	return to.width > 0 ? from.width / to.width : 1;
}

/**
 * Keyframes for an element laid out at `to`, its final place: it starts over
 * `from` (the chart on screen), that many times larger, and ends untransformed,
 * exactly where it is laid out. To be run on `PDF_FLIGHT_EASING`.
 */
export function flightKeyframes(from: Box, to: Box): Keyframe[] {
	const dx = from.x + from.width / 2 - (to.x + to.width / 2);
	const dy = from.y + from.height / 2 - (to.y + to.height / 2);
	return [
		{ transform: `translate(${dx}px, ${dy}px) scale(${flightScale(from, to)})` },
		{ transform: 'none' }
	];
}

/**
 * Keyframes for a chart already on the page that the Add moved: laid out at
 * `after`, it is played there from `before`, in step with the copy flying in. Null
 * when it did not move, to within what the eye could see.
 */
export function settleKeyframes(before: Box, after: Box): Keyframe[] | null {
	if (!(after.width > 0) || !(after.height > 0)) return null;
	const dx = before.x + before.width / 2 - (after.x + after.width / 2);
	const dy = before.y + before.height / 2 - (after.y + after.height / 2);
	const scale = before.width / after.width;
	if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25 && Math.abs(scale - 1) < 0.005) return null;
	return [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }];
}

/**
 * The copy's opacity, to be run on linear time beside the move: it comes up over
 * the chart as it lifts off and is then solid all the way to its place, where the
 * thumbnail takes over from it at full strength.
 */
export const FLIGHT_FADE: Keyframe[] = [
	{ opacity: 0 },
	{ opacity: 1, offset: 0.18 },
	{ opacity: 1 }
];

/**
 * The copy's edge, a hairline on the thumbnail. Scaled up with the copy it would
 * start as a band several px wide; it starts that many times thinner instead and
 * ends at the thumbnail's 1 px. For the same easing as the move.
 */
export function flightEdgeKeyframes(from: Box, to: Box, color: string): Keyframe[] {
	const start = 1 / Math.max(1, flightScale(from, to));
	return [
		{ boxShadow: `inset 0 0 0 ${start}px ${color}` },
		{ boxShadow: `inset 0 0 0 1px ${color}` }
	];
}

/**
 * The factor to draw the copy's stars with (`drawChartThumbnail`'s `starScale`)
 * while the copy is shown `scale` times its final size, having started at
 * `startScale`. Left alone, the thumbnail's stars would be `scale` times larger on
 * screen: blots, seven times too big at lift-off. This keeps them a little larger
 * than they will be on the thumbnail (`FLIGHT_STAR_GAIN` at the start, easing to
 * exactly 1 on landing), whatever the copy's size.
 */
export function flightStarScale(scale: number, startScale: number): number {
	if (!(scale > 1) || !(startScale > 1)) return 1;
	const gain = 1 + (FLIGHT_STAR_GAIN - 1) * Math.min(1, (scale - 1) / (startScale - 1));
	return gain / scale;
}

/**
 * The density to draw the copy's canvas at: the screen's, times how much larger
 * than its final size it is shown at first (capped), so it is sharp while large.
 */
export function flightPixelRatio(from: Box, to: Box, dpr: number): number {
	return dpr * Math.min(MAX_OVERSAMPLE, Math.max(1, flightScale(from, to)));
}
