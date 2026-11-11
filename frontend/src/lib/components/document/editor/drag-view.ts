/**
 * What a drag looks like while it goes on: the one view the session keeps
 * (`DragView`), the part of it each page on the stage draws (`PageDrag`), and what
 * each block on it is doing meanwhile (`BlockState`).
 */

import type { SnapGuide } from '$lib/document/geometry';
import type { Rect } from '$lib/document/types';

/** A drag as it stands: where the block is drawn, and where it would end. */
export interface DragView {
	kind: 'moving' | 'detached' | 'resizing';
	/** The page the block is on. */
	pageId: string;
	blockId: string;
	/** The page it would land on; null out of reach of every page. */
	targetId: string | null;
	/**
	 * Where the block is drawn, its own page's mm. Moving, that is wherever the
	 * pointer has it, on a page or off: it is not held to the paper. Resizing, it
	 * is the snapped frame, which is also what the resize commits.
	 */
	frame: Rect;
	/** Moving: where it would come to rest if let go now, the target page's mm. */
	landing: Rect | null;
	/** The lines it is snapped to, drawn only with Shift held. */
	guides: SnapGuide[];
	/** A text being turned by its knob: where it is turned to, degrees. */
	rotation?: number;
	/** A chart being resized: the margins it is held to are drawn. */
	margins?: boolean;
}

/** The lines a keyboard nudge landed on, drawn for a moment as a drag's are. */
export interface GuideFlash {
	pageId: string;
	guides: SnapGuide[];
}

/** What a drag (or a keyboard nudge) draws on one page. */
export interface PageDrag {
	/** This page's chart or text being dragged, if it is this page's. */
	blockId: string | null;
	/** Where to draw it, this page's mm. */
	frame: Rect | null;
	kind: DragView['kind'];
	/** A chart is being resized: the margins it is held to are drawn. */
	margins: boolean;
	/** A text of this page being turned by its knob: where to, degrees. */
	rotation: number | null;
	/** Snap guides to draw on this page, mm. */
	guides: SnapGuide[];
	/** The block would land on this page if dropped now. */
	target: boolean;
}

/**
 * What a block is doing: carried on a page or off every page, resized or turned,
 * easing back after it was let go off every page, coming to rest after it was let
 * go over one; or nothing.
 */
export type BlockState = DragView['kind'] | 'idle' | 'returning' | 'settling';

/** What the block `blockId` is doing, by its page's drag and the blocks the last drag let go. */
export function blockState(
	blockId: string,
	drag: PageDrag | null,
	settlingId: string | null,
	returningId: string | null
): BlockState {
	if (drag?.blockId === blockId) return drag.kind;
	if (settlingId === blockId) return 'settling';
	return returningId === blockId ? 'returning' : 'idle';
}

/** What the page `pageId` draws for the drag going on, or for the guides of the last nudge. */
export function pageDrag(
	pageId: string,
	view: DragView | null,
	flash: GuideFlash | null
): PageDrag | null {
	if (!view) {
		return flash?.pageId === pageId
			? {
					blockId: null,
					frame: null,
					kind: 'moving',
					margins: false,
					rotation: null,
					guides: flash.guides,
					target: false
				}
			: null;
	}
	const isSource = view.pageId === pageId;
	const isTarget = view.targetId === pageId;
	if (!isSource && !isTarget) return null;
	return {
		blockId: isSource ? view.blockId : null,
		// Its own page's mm, wherever on the stage that puts it: the page draws it
		// past its own edges, above the others.
		frame: isSource ? view.frame : null,
		kind: view.kind,
		margins: view.margins === true,
		rotation: isSource ? (view.rotation ?? null) : null,
		guides: isTarget ? view.guides : [],
		target: isTarget
	};
}
