/**
 * Where a block may go when the editor moves it: what a drag and a key ask alike of
 * a chart, a text and a table. Pure functions, no DOM.
 */

import { blockBounds, chartsOf, isChart } from '$lib/document/blocks';
import { placeFrame, rotatedBounds, snapMove, type SnapGuide } from '$lib/document/geometry';
import type { BlockKind, DocBlock, DocPage, PageOrientation, Rect } from '$lib/document/types';
import type { Point } from './screen-geometry';

/** A block as a drag holds it: what it was at the press, by what the kinds share. */
export interface HeldBlock {
	id: string;
	kind: BlockKind;
	frame: Rect;
	/** A chart's own; a text's is whatever its lines make it. */
	aspect: number;
	/** Degrees a text or a table is turned; a chart is not. */
	rotation: number;
}

export function holdBlock(block: DocBlock): HeldBlock {
	const { id, kind, frame } = block;
	return {
		id,
		kind,
		frame: { ...frame },
		aspect: isChart(block) ? block.chart.aspect : frame.w / frame.h,
		rotation: rotationOf(block)
	};
}

/** Degrees a block is turned, clockwise about its centre: a chart never is. */
export function rotationOf(block: DocBlock): number {
	return isChart(block) ? 0 : (block.rotation ?? 0);
}

/** What every chart and text takes up on `page`, but for the block `exceptId`. */
export function framesOn(page: Pick<DocPage, 'blocks'>, exceptId?: string): Rect[] {
	return page.blocks.filter((it) => it.id !== exceptId).map(blockBounds);
}

/**
 * `frame` (turned `rotation`) moved as `snapMove` moves what it takes up on the
 * page: a turned text snaps and stops by the upright box around it.
 */
export function snapBlock(
	frame: Rect,
	rotation: number,
	others: readonly Rect[],
	orientation: PageOrientation,
	threshold: number
): { frame: Rect; guides: SnapGuide[] } {
	const bounds = rotatedBounds(frame, rotation);
	const snapped = snapMove(bounds, others, orientation, threshold);
	return {
		frame: {
			...frame,
			x: frame.x + snapped.frame.x - bounds.x,
			y: frame.y + snapped.frame.y - bounds.y
		},
		guides: snapped.guides
	};
}

/**
 * `block` moved by `delta` mm on its page, through `snapMove` with no reach: it only
 * clamps, and gives the lines the block lands on.
 */
export function nudgedFrame(
	page: Pick<DocPage, 'blocks' | 'orientation'>,
	block: DocBlock,
	delta: Point
): { frame: Rect; guides: SnapGuide[] } {
	const moved = { ...block.frame, x: block.frame.x + delta.x, y: block.frame.y + delta.y };
	return snapBlock(moved, rotationOf(block), framesOn(page, block.id), page.orientation, 0);
}

/**
 * Where a block sent to another page by a key goes on it: a chart where it fits
 * clear of the charts there (`placeFrame`), a text or a table where it was on its
 * own page, as far as that page allows.
 */
export function frameOnPage(
	block: DocBlock,
	target: Pick<DocPage, 'blocks' | 'orientation'>
): Rect {
	if (!isChart(block)) return block.frame;
	const others = chartsOf(target).map((it) => it.frame);
	return placeFrame(block.frame, block.chart.aspect, others, target.orientation);
}

/** The bearing of `point` from `centre`, degrees clockwise from the screen's x axis. */
export function bearingFrom(centre: Point, point: Point): number {
	return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
}
