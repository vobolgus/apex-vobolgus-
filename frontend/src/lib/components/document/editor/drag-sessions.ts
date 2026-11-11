/**
 * The four things a pointer drag does in the page editor, each a session of its own:
 * carrying a block, resizing a chart by a corner, setting the width of a text or a
 * table by a side, and turning one by its knob.
 *
 * A session begins at a press (`Press`: the block as it was, the pages where they
 * were). `update` says what the drag shows with the pointer somewhere; nothing is
 * written until the release, when `commit` writes the document once and tells the
 * editor how the block comes to rest and what to say. So a drag cancelled has
 * nothing to take back: its view is dropped, whichever session made it.
 *
 * No DOM here: a session reads and writes the store and works in numbers.
 */

import { typesetOf } from '$lib/document/blocks';
import type { DocumentStore } from '$lib/document/document.svelte';
import {
	fitFrame,
	snapResize,
	snapThresholdMm,
	snapWidth,
	type ResizeAnchor,
	type SnapGuide
} from '$lib/document/geometry';
import { spokenKind } from '$lib/document/labels';
import {
	anchoredFrame,
	fitTextFrame,
	MIN_TEXT_WIDTH_MM,
	normalizeRotation,
	squareRotation
} from '$lib/document/text';
import type { DocPage, Rect } from '$lib/document/types';
import { leastTableWidth, shownLayout } from '../typeset.svelte';
import type { TextSide } from './actions';
import { bearingFrom, framesOn, snapBlock, type HeldBlock } from './block-geometry';
import type { DragView } from './drag-view';
import {
	anchorOf,
	cornerOf,
	frameUnderPointer,
	landingPage,
	mmToScreen,
	resizeRect,
	screenToMm,
	type PageBox,
	type Point
} from './screen-geometry';

/**
 * The catch zone around every page, px: a block let go with its centre within
 * this of a page lands on that page, brought to the nearest place it may be.
 */
export const DROP_SLACK_PX = 40;

/** What a session knows from the press that began it. */
export interface Press {
	/** The page the block is on. */
	pageId: string;
	/** The block as it was. */
	block: HeldBlock;
	/** Where the pointer was, screen px. */
	start: Point;
	/** Screen px per mm. */
	scale: number;
	/** Every page on the stage, screen px. */
	boxes: readonly PageBox[];
}

/** What the editor does once a drag has been let go and the document written. */
interface DragOutcome {
	/** How the block comes to rest on screen: played into its new place, or eased back to its old. */
	rest?: 'settle' | 'return';
	/** What is read out. */
	say?: string;
	/** It went to another page: its element is a new one there, and the focus follows it. */
	changedPage?: boolean;
}

export interface DragSession {
	/**
	 * What the drag shows with the pointer at `point`, screen px; undefined when the
	 * block is no longer there to be drawn, which leaves the view as it was.
	 */
	update(point: Point, shift: boolean): DragView | undefined;
	/** The block is let go showing `view`: the one write of the drag. */
	commit(view: DragView): DragOutcome;
}

/** A view of a block changed where it stands: resized or turned, on its own page. */
function inPlace(press: Press): Pick<DragView, 'kind' | 'pageId' | 'blockId' | 'targetId'> & {
	landing: null;
} {
	const { pageId, block } = press;
	return { kind: 'resizing', pageId, blockId: block.id, targetId: pageId, landing: null };
}

/**
 * A block in the hand. It goes wherever the pointer takes it, on the paper or off
 * it: it is not on a page, and nothing is drawn for it on the pages unless Shift is
 * held, which shows the lines it would snap to. Where it would come to rest is
 * worked out beside it; it only goes there when let go, on the page its centre is
 * over or nearest to. Out of reach of every page it goes back where it was.
 */
export function carrySession(store: DocumentStore, press: Press): DragSession {
	const { pageId, block, start, scale, boxes } = press;
	const base = { pageId, blockId: block.id };
	const threshold = snapThresholdMm(scale);
	const home = boxes.find((b) => b.id === pageId)?.box;
	const pressed = home ? screenToMm(start, home, scale) : { x: 0, y: 0 };
	/** The grabbed point, mm from the block's top-left. */
	const grab = { x: pressed.x - block.frame.x, y: pressed.y - block.frame.y };

	/** The block's size on `target`: too large for another page it shrinks to fit, a text gets narrower. */
	function sizeOn(target: Pick<DocPage, 'id' | 'orientation'>): Rect {
		if (target.id === pageId) return block.frame;
		const atOrigin = { ...block.frame, x: 0, y: 0 };
		return block.kind === 'chart'
			? fitFrame(atOrigin, block.aspect, target.orientation)
			: fitTextFrame(atOrigin, target.orientation, block.rotation);
	}

	return {
		update(point, shift) {
			if (!home) return undefined;
			let frame: Rect = {
				...block.frame,
				x: block.frame.x + (point.x - start.x) / scale,
				y: block.frame.y + (point.y - start.y) / scale
			};
			const centre = mmToScreen(
				{ x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 },
				home,
				scale
			);
			const targetId = landingPage(centre, boxes, DROP_SLACK_PX);
			const target = targetId === null ? undefined : store.page(targetId);
			const box = boxes.find((b) => b.id === targetId)?.box;
			if (!target || !box) {
				// Out of reach of every page: let go here, it goes back where it was.
				return { ...base, kind: 'detached', targetId: null, frame, landing: null, guides: [] };
			}
			const size = sizeOn(target);
			if (size.w !== block.frame.w || size.h !== block.frame.h) {
				frame = frameUnderPointer(screenToMm(point, home, scale), grab, block.frame, size);
			}
			const raw = frameUnderPointer(screenToMm(point, box, scale), grab, block.frame, size);
			const landing = snapBlock(
				raw,
				block.rotation,
				framesOn(target, block.id),
				target.orientation,
				threshold
			);
			return {
				...base,
				kind: 'moving',
				targetId: target.id,
				frame,
				landing: landing.frame,
				guides: shift ? landing.guides : []
			};
		},

		commit(view) {
			if (view.targetId === null || !view.landing) return { rest: 'return' };
			if (view.targetId === pageId) {
				store.setFrame(pageId, block.id, view.landing);
				return { rest: 'settle' };
			}
			const number = store.pageIndex(view.targetId) + 1;
			if (!store.moveBlock(block.id, view.targetId, view.landing)) {
				return { rest: 'return', say: `Page ${number} is full` };
			}
			const what = spokenKind(block.kind);
			return { rest: 'settle', say: `${what} moved to page ${number}`, changedPage: true };
		}
	};
}

/**
 * A chart resized by the corner `handle`: the opposite corner stays, the aspect is
 * kept, and the frame is the snapped one all along (`snapResize`), which is also
 * what the release writes. The margins it is held to are drawn meanwhile.
 */
export function cornerResizeSession(
	store: DocumentStore,
	press: Press,
	handle: ResizeAnchor
): DragSession {
	const { pageId, block, start, scale } = press;
	const threshold = snapThresholdMm(scale);
	const anchor = anchorOf(handle);
	const anchorPoint = cornerOf(block.frame, anchor);
	const corner = cornerOf(block.frame, handle);

	return {
		update(point, shift) {
			const page = store.page(pageId);
			if (!page) return undefined;
			const dragged = {
				x: corner.x + (point.x - start.x) / scale,
				y: corner.y + (point.y - start.y) / scale
			};
			const snapped = snapResize(
				resizeRect(anchor, anchorPoint, dragged),
				anchor,
				block.aspect,
				framesOn(page, block.id),
				page.orientation,
				threshold
			);
			return {
				...inPlace(press),
				frame: snapped.frame,
				guides: shift ? snapped.guides : [],
				margins: true
			};
		},

		commit(view) {
			store.setFrame(pageId, block.id, view.frame);
			return {};
		}
	};
}

/**
 * A text or a table made wider or narrower by its side `side`: that side follows
 * the pointer, the other stays. Its lines wrap to the new width as it is dragged;
 * the height is theirs.
 */
export function widthResizeSession(
	store: DocumentStore,
	press: Press,
	side: TextSide
): DragSession {
	const { pageId, block, start, scale } = press;
	const threshold = snapThresholdMm(scale);
	/** The dragged side at the press, mm. */
	const edge = side === 'e' ? block.frame.x + block.frame.w : block.frame.x;

	return {
		update(point, shift) {
			const page = store.page(pageId);
			const text = page && typesetOf(page).find((it) => it.id === block.id);
			if (!page || !text) return undefined;
			const dx = point.x - start.x;
			const dy = point.y - start.y;
			const heightAt = (w: number) => shownLayout(page, text, w, store.pages).height;
			// A table is made no narrower than holds all of it; a text, than a word or two.
			const narrowest = text.kind === 'table' ? leastTableWidth(page, text, store.pages) : 0;
			const least = Math.max(MIN_TEXT_WIDTH_MM, narrowest);
			let frame: Rect;
			let guides: SnapGuide[] = [];
			if (block.rotation === 0) {
				const snapped = snapWidth(
					block.frame,
					side,
					edge + dx / scale,
					least,
					framesOn(page, block.id),
					page.orientation,
					threshold
				);
				frame = { ...snapped.frame, h: heightAt(snapped.frame.w) };
				guides = snapped.guides;
			} else {
				// Turned, the side goes along the text's own line, the other side staying
				// where it is on the page; there are no lines of the page to snap to.
				const angle = (block.rotation * Math.PI) / 180;
				const along = (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale;
				const w = Math.max(least, block.frame.w + (side === 'e' ? along : -along));
				const fitted = fitTextFrame({ ...block.frame, w }, page.orientation, block.rotation).w;
				frame = anchoredFrame(
					block.frame,
					block.rotation,
					fitted,
					heightAt(fitted),
					side === 'e' ? 'left' : 'right'
				);
			}
			// As a chart in the hand: the lines it snaps to show only with Shift held.
			return { ...inPlace(press), frame, guides: shift ? guides : [] };
		},

		commit(view) {
			store.setFrame(pageId, block.id, view.frame);
			return {};
		}
	};
}

/**
 * A text or a table turned by its knob about `centre` (screen px): as far round as
 * the pointer has gone since the press; with Shift, to the nearest right angle.
 */
export function turnSession(store: DocumentStore, press: Press, centre: Point): DragSession {
	const { pageId, block, start } = press;
	/** The pointer's bearing from the centre at the press, degrees. */
	const bearing = bearingFrom(centre, start);

	return {
		update(point, shift) {
			const turned = block.rotation + bearingFrom(centre, point) - bearing;
			return {
				...inPlace(press),
				frame: block.frame,
				guides: [],
				rotation: shift ? squareRotation(turned) : normalizeRotation(turned)
			};
		},

		commit(view) {
			const rotation = view.rotation ?? block.rotation;
			store.updateTypeset(pageId, block.id, { rotation });
			return { say: `Turned to ${Math.round(rotation)} degrees` };
		}
	};
}
