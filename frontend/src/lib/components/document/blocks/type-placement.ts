/**
 * Where a text or a table is drawn in the editor, and where its toolbar stands.
 *
 * Its width is the frame's; its height is the lines'. It is drawn from its own
 * top-left corner, which stays put on the page as the lines come and go, whichever
 * way it is turned. The toolbar (and the readout of its angle) stands clear of what
 * it takes up turned, and of the knob on its stalk over its top, which the turn may
 * have pointing anywhere; low on the page, the toolbar goes above it, where under
 * it it would leave the stage.
 */

import { rotatedBounds } from '$lib/document/geometry';
import { anchoredFrame } from '$lib/document/text';
import type { Rect } from '$lib/document/types';
import type { Size } from '../editor/screen-geometry';

/** The knob that turns the text: its size, and how far its far edge stands off the text, px (as in the CSS). */
const KNOB_PX = 16;
const KNOB_REACH_PX = 24;
/** Between the text (or its knob) and the toolbar, px. */
const TOOLS_GAP_PX = 10;
/** Below this far down the page, the toolbar goes above the text. */
const LOW_ON_PAGE = 0.72;

export interface TypePlacement {
	/** Where it is drawn, mm on its page: its frame as tall as its lines. */
	box: Rect;
	/** The toolbar goes above it. */
	toolsAbove: boolean;
	/** How far above and below its centre the toolbar stands, as CSS offsets from the box's middle. */
	above: string;
	below: string;
}

/**
 * Where a text with lines `height` mm tall and turned `turn` degrees is drawn on
 * `page`, at `scale` px per mm; `knob` with its knob shown.
 */
export function typePlacement(
	frame: Rect,
	height: number,
	turn: number,
	page: Size,
	scale: number,
	knob: boolean
): TypePlacement {
	const box = turn === 0 ? { ...frame, h: height } : anchoredFrame(frame, turn, frame.w, height);
	const bounds = rotatedBounds(box, turn);
	// How far the text reaches up and down from its centre on the screen, px, the knob included.
	const half = (bounds.h * scale) / 2;
	const angle = (turn * Math.PI) / 180;
	const stalk = knob ? (box.h * scale) / 2 + KNOB_REACH_PX : 0;
	// Its middle, and half its width when it lies to the side of the stalk.
	const tip = stalk * Math.cos(angle);
	const spread = (KNOB_PX / 2) * Math.abs(Math.sin(angle));
	const up = Math.max(half, tip + spread);
	const down = Math.max(half, -tip + spread);
	return {
		box,
		toolsAbove: bounds.y + bounds.h > page.h * LOW_ON_PAGE,
		above: `calc(50% + ${up + TOOLS_GAP_PX}px)`,
		below: `calc(50% + ${down + TOOLS_GAP_PX}px)`
	};
}
