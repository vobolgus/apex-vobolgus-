/**
 * Where the chart sits in its area when panels take room at the sides.
 *
 * The chart is a square of `side` px in an area `width` px wide, with `left` and
 * `right` px reserved for the pages panel and the layers panel. It stays in the
 * middle of the area for as long as it clears both panels there, so opening a
 * panel on a wide screen does not move it; in a narrower window it moves over
 * just far enough, and only then (the CSS's job, with the same reserves) does it
 * shrink. The page's CSS places the chart with the same formula
 * (`--chart-centre` in `+page.svelte`); this is its mirror, for what the script
 * needs to know.
 */

/** The chart's centre, px from the area's left edge. */
export function chartCentreX(width: number, side: number, left: number, right: number): number {
	const min = left + side / 2;
	const max = width - right - side / 2;
	// As CSS `clamp()` does, the lower bound wins when the chart cannot clear both.
	return Math.max(min, Math.min(width / 2, max));
}

/**
 * The widest box, centred on the chart, that clears both panels: what the pinhole
 * frame's handles may spread into without sliding under a panel.
 */
export function clearWidthAroundChart(
	width: number,
	side: number,
	left: number,
	right: number
): number {
	const centre = chartCentreX(width, side, left, right);
	return Math.max(0, 2 * Math.min(centre - left, width - right - centre));
}
