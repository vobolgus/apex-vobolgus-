import { beforeEach, describe, expect, it } from 'vitest';
import { chartsOf, typesetOf } from '$lib/document/blocks';
import { DocumentStore } from '$lib/document/document.svelte';
import { contentBox, snapThresholdMm } from '$lib/document/geometry';
import { MAX_ITEMS_PER_PAGE } from '$lib/document/page';
import { chart, expectInside } from '$lib/document/test-support';
import { DEFAULT_TEXT_STYLE, MIN_TEXT_WIDTH_MM } from '$lib/document/text';
import type { ChartBlock, DocBlock, DocPage, TableBlock, TextBlock } from '$lib/document/types';
import { leastTableWidth, shownLayout } from '../typeset.svelte';
import { holdBlock } from './block-geometry';
import {
	carrySession,
	cornerResizeSession,
	DROP_SLACK_PX,
	turnSession,
	widthResizeSession,
	type Press
} from './drag-sessions';
import type { PageBox, Point } from './screen-geometry';

/** Screen px per mm on the stage of these tests. */
const SCALE = 2;
/** Three pages side by side, 40 px apart: portrait, portrait, landscape. */
const BOXES: PageBox[] = [
	{ id: 'p1', box: { left: 0, top: 0, width: 420, height: 594 } },
	{ id: 'p2', box: { left: 460, top: 0, width: 420, height: 594 } },
	{ id: 'p3', box: { left: 920, top: 0, width: 594, height: 420 } }
];

function disc(id: string, x: number, y: number, side: number): ChartBlock {
	return { kind: 'chart', id, chart: chart(), frame: { x, y, w: side, h: side } };
}

function words(id: string, frame: TextBlock['frame'], rotation?: number): TextBlock {
	const text: TextBlock = { kind: 'text', id, text: 'Orion', style: DEFAULT_TEXT_STYLE, frame };
	if (rotation) text.rotation = rotation;
	return text;
}

function pages(): DocPage[] {
	return [
		{
			id: 'p1',
			orientation: 'portrait',
			blocks: [disc('a', 12, 12, 90), words('t', { x: 12, y: 120, w: 80, h: 6 })]
		},
		{ id: 'p2', orientation: 'portrait', blocks: [] },
		{
			id: 'p3',
			orientation: 'landscape',
			blocks: [
				{ kind: 'chart', id: 'wide', chart: chart(1.6), frame: { x: 12, y: 12, w: 256, h: 160 } }
			]
		}
	];
}

/** Where a page's mm point is on the screen of these tests. */
function onScreen(pageId: string, x: number, y: number): Point {
	const { box } = BOXES.find((b) => b.id === pageId)!;
	return { x: box.left + x * SCALE, y: box.top + y * SCALE };
}

describe('drag sessions', () => {
	let store: DocumentStore;

	beforeEach(() => {
		store = new DocumentStore(null);
		store.pages = pages();
	});

	function block(id: string): DocBlock {
		return store.pages.flatMap((page) => page.blocks).find((it) => it.id === id)!;
	}

	/** A press on the block `id` of `pageId`, at `start`. */
	function press(pageId: string, id: string, start: Point): Press {
		return { pageId, block: holdBlock(block(id)), start, scale: SCALE, boxes: BOXES };
	}

	describe('carry', () => {
		it('takes the block wherever the pointer goes, and works out beside it where it would rest', () => {
			const start = onScreen('p1', 50, 50);
			const session = carrySession(store, press('p1', 'a', start));
			const view = session.update({ x: start.x + 60, y: start.y + 30 }, false)!;
			expect(view.kind).toBe('moving');
			expect(view.pageId).toBe('p1');
			expect(view.blockId).toBe('a');
			expect(view.targetId).toBe('p1');
			// In the hand it is not held to the paper: just where the pointer has it.
			expect(view.frame).toEqual({ x: 42, y: 27, w: 90, h: 90 });
			// Its landing is on the page, its size kept, within the snap's reach of the hand.
			expectInside(view.landing!, store.page('p1')!);
			expect(view.landing!.w).toBe(90);
			expect(Math.abs(view.landing!.x - 42)).toBeLessThanOrEqual(snapThresholdMm(SCALE));
			// Nothing is written before the release.
			expect(block('a').frame).toEqual({ x: 12, y: 12, w: 90, h: 90 });
		});

		it('shows the lines it would snap to only with Shift held', () => {
			const start = onScreen('p1', 50, 50);
			const session = carrySession(store, press('p1', 'a', start));
			// Back at the left margin, where the content box is a line to snap to.
			const point = { x: start.x + 1, y: start.y + 40 };
			const plain = session.update(point, false)!;
			const shifted = session.update(point, true)!;
			expect(plain.guides).toEqual([]);
			expect(shifted.guides.length).toBeGreaterThan(0);
			expect(shifted.landing).toEqual(plain.landing);
		});

		it('writes the landing on the release, and the block settles there', () => {
			const start = onScreen('p1', 50, 50);
			const session = carrySession(store, press('p1', 'a', start));
			const view = session.update({ x: start.x + 60, y: start.y + 30 }, false)!;
			expect(session.commit(view)).toEqual({ rest: 'settle' });
			expect(block('a').frame).toEqual(view.landing);
			expect(store.page('p1')!.manual).toBe(true);
		});

		it('is detached out of reach of every page, and goes back when let go there', () => {
			const start = onScreen('p1', 50, 50);
			const session = carrySession(store, press('p1', 'a', start));
			// Its centre far below every page.
			const view = session.update({ x: start.x, y: start.y + 1400 }, true)!;
			expect(view.kind).toBe('detached');
			expect(view.targetId).toBeNull();
			expect(view.landing).toBeNull();
			expect(view.guides).toEqual([]);
			expect(session.commit(view)).toEqual({ rest: 'return' });
			expect(block('a').frame).toEqual({ x: 12, y: 12, w: 90, h: 90 });
		});

		it('lands on the page its centre is nearest to, within the catch zone', () => {
			// Grabbed by its centre, so the pointer is where the centre is.
			const start = onScreen('p1', 57, 57);
			const session = carrySession(store, press('p1', 'a', start));
			const below = BOXES[0].box.top + BOXES[0].box.height;
			const inReach = session.update({ x: start.x, y: below + DROP_SLACK_PX - 1 }, false)!;
			expect(inReach.targetId).toBe('p1');
			const outOfReach = session.update({ x: start.x, y: below + DROP_SLACK_PX + 1 }, false)!;
			expect(outOfReach.targetId).toBeNull();
		});

		it('moves to the page it is let go over, and says where it went', () => {
			const start = onScreen('p1', 57, 57);
			const session = carrySession(store, press('p1', 'a', start));
			const view = session.update(onScreen('p2', 100, 150), false)!;
			expect(view.targetId).toBe('p2');
			// Drawn from its own page still, past its edge; the landing is in the target's mm.
			expect(view.frame.x).toBeGreaterThan(210);
			expectInside(view.landing!, store.page('p2')!);
			expect(session.commit(view)).toEqual({
				rest: 'settle',
				say: 'Chart moved to page 2',
				changedPage: true
			});
			expect(chartsOf(store.page('p1')!)).toHaveLength(0);
			expect(chartsOf(store.page('p2')!).map((it) => it.frame)).toEqual([view.landing]);
		});

		it('calls a text a text when it changes page', () => {
			const start = onScreen('p1', 20, 122);
			const session = carrySession(store, press('p1', 't', start));
			const view = session.update(onScreen('p2', 60, 100), false)!;
			expect(session.commit(view).say).toBe('Text moved to page 2');
			expect(typesetOf(store.page('p2')!).map((it) => it.id)).toEqual(['t']);
		});

		it('shrinks a chart too large for the page it is over, keeping it under the pointer', () => {
			// The wide chart of the landscape page, grabbed a quarter of the way in.
			const start = onScreen('p3', 12 + 64, 12 + 40);
			const session = carrySession(store, press('p3', 'wide', start));
			const point = onScreen('p2', 100, 150);
			const view = session.update(point, false)!;
			expect(view.targetId).toBe('p2');
			const room = contentBox('portrait').w;
			expect(view.frame.w).toBeCloseTo(room);
			expect(view.frame.h).toBeCloseTo(room / 1.6);
			expect(view.landing!.w).toBeCloseTo(room);
			// The grabbed point is still a quarter of the way in, under the pointer.
			const home = BOXES[2].box;
			const pointerMm = { x: (point.x - home.left) / SCALE, y: (point.y - home.top) / SCALE };
			expect((pointerMm.x - view.frame.x) / view.frame.w).toBeCloseTo(0.25);
			expect((pointerMm.y - view.frame.y) / view.frame.h).toBeCloseTo(0.25);
		});

		it('goes back from a page that holds no more, and says the page is full', () => {
			store.page('p2')!.blocks = Array.from({ length: MAX_ITEMS_PER_PAGE }, (_, i) =>
				disc(`full-${i}`, 12, 12, 40)
			);
			const start = onScreen('p1', 57, 57);
			const session = carrySession(store, press('p1', 'a', start));
			const view = session.update(onScreen('p2', 100, 150), false)!;
			expect(session.commit(view)).toEqual({ rest: 'return', say: 'Page 2 is full' });
			expect(chartsOf(store.page('p1')!).map((it) => it.id)).toEqual(['a']);
			expect(chartsOf(store.page('p2')!)).toHaveLength(MAX_ITEMS_PER_PAGE);
		});

		it('shows nothing for a block whose page is not on the stage', () => {
			const offStage: Press = { ...press('p1', 'a', { x: 0, y: 0 }), boxes: BOXES.slice(1) };
			expect(carrySession(store, offStage).update({ x: 50, y: 50 }, false)).toBeUndefined();
		});
	});

	describe('corner resize', () => {
		it('keeps the opposite corner and the aspect, and draws the margins', () => {
			const start = onScreen('p1', 102, 102);
			const session = cornerResizeSession(store, press('p1', 'a', start), 'se');
			const view = session.update({ x: start.x + 41, y: start.y + 41 }, false)!;
			expect(view.kind).toBe('resizing');
			expect(view.targetId).toBe('p1');
			expect(view.landing).toBeNull();
			expect(view.margins).toBe(true);
			expect(view.guides).toEqual([]);
			expect(view.frame.x).toBe(12);
			expect(view.frame.y).toBe(12);
			expect(view.frame.w).toBeCloseTo(view.frame.h);
			expect(Math.abs(view.frame.w - 110.5)).toBeLessThanOrEqual(snapThresholdMm(SCALE));
		});

		it('grows away from the corner that stays, whichever is dragged', () => {
			store.setFrame('p1', 'a', { x: 60, y: 60, w: 90, h: 90 });
			const start = onScreen('p1', 60, 60);
			const session = cornerResizeSession(store, press('p1', 'a', start), 'nw');
			const view = session.update({ x: start.x - 30, y: start.y - 30 }, false)!;
			expect(view.frame.x + view.frame.w).toBeCloseTo(150);
			expect(view.frame.y + view.frame.h).toBeCloseTo(150);
			expect(view.frame.w).toBeGreaterThan(90);
		});

		it('writes the frame it showed on the release', () => {
			const start = onScreen('p1', 102, 102);
			const session = cornerResizeSession(store, press('p1', 'a', start), 'se');
			const view = session.update({ x: start.x + 41, y: start.y + 41 }, false)!;
			expect(session.commit(view)).toEqual({});
			expect(block('a').frame).toEqual(view.frame);
		});

		it('leaves the view as it was once its page is gone', () => {
			const session = cornerResizeSession(store, press('p1', 'a', { x: 0, y: 0 }), 'se');
			store.pages = store.pages.slice(1);
			expect(session.update({ x: 40, y: 40 }, false)).toBeUndefined();
		});
	});

	describe('width resize', () => {
		it('moves the dragged side and keeps the other; the height is the lines’', () => {
			const start = onScreen('p1', 92, 123);
			const session = widthResizeSession(store, press('p1', 't', start), 'e');
			const view = session.update({ x: start.x + 41, y: start.y + 12 }, false)!;
			expect(view.kind).toBe('resizing');
			expect(view.margins).toBeUndefined();
			expect(view.frame.x).toBe(12);
			expect(Math.abs(view.frame.w - 100.5)).toBeLessThanOrEqual(snapThresholdMm(SCALE));
			const page = store.page('p1')!;
			const text = typesetOf(page)[0];
			expect(view.frame.h).toBe(shownLayout(page, text, view.frame.w, store.pages).height);
		});

		it('moves the left side with the right one staying', () => {
			store.updateTypeset('p1', 't', { frame: { x: 60, y: 120, w: 80, h: 6 } });
			const start = onScreen('p1', 60, 123);
			const session = widthResizeSession(store, press('p1', 't', start), 'w');
			const view = session.update({ x: start.x - 41, y: start.y }, false)!;
			expect(view.frame.x + view.frame.w).toBeCloseTo(140);
			expect(view.frame.w).toBeGreaterThan(80);
		});

		it('makes a text no narrower than a word or two', () => {
			const start = onScreen('p1', 92, 123);
			const session = widthResizeSession(store, press('p1', 't', start), 'e');
			const view = session.update({ x: start.x - 400, y: start.y }, false)!;
			expect(view.frame.x).toBe(12);
			expect(view.frame.w).toBe(MIN_TEXT_WIDTH_MM);
		});

		it('makes a table no narrower than holds all of it', () => {
			const table: TableBlock = {
				kind: 'table',
				id: 'list',
				style: DEFAULT_TEXT_STYLE,
				table: { source: 'stars', look: 'details', rows: 5 },
				frame: { x: 12, y: 140, w: 150, h: 40 }
			};
			store.page('p1')!.blocks.push(table);
			const page = store.page('p1')!;
			const least = Math.max(MIN_TEXT_WIDTH_MM, leastTableWidth(page, table, store.pages));
			const start = onScreen('p1', 162, 150);
			const session = widthResizeSession(store, press('p1', 'list', start), 'e');
			const view = session.update({ x: start.x - 400, y: start.y }, false)!;
			// The least it can be, or the first line of the page past that.
			expect(view.frame.w).toBeGreaterThanOrEqual(least - 1e-9);
			expect(view.frame.w).toBeLessThanOrEqual(least + snapThresholdMm(SCALE));
			expect(least).toBeGreaterThan(MIN_TEXT_WIDTH_MM);
		});

		it('takes a turned text along its own line, with no lines of the page to snap to', () => {
			store.updateTypeset('p1', 't', { frame: { x: 60, y: 150, w: 80, h: 6 }, rotation: 90 });
			const start = onScreen('p1', 100, 193);
			const session = widthResizeSession(store, press('p1', 't', start), 'e');
			// Turned a quarter clockwise, its line runs down the page.
			const across = session.update({ x: start.x + 40, y: start.y }, true)!;
			expect(across.frame.w).toBeCloseTo(80);
			const along = session.update({ x: start.x, y: start.y + 40 }, true)!;
			expect(along.frame.w).toBeCloseTo(100);
			expect(along.guides).toEqual([]);
		});

		it('writes the width it showed on the release', () => {
			const start = onScreen('p1', 92, 123);
			const session = widthResizeSession(store, press('p1', 't', start), 'e');
			const view = session.update({ x: start.x + 41, y: start.y }, false)!;
			expect(session.commit(view)).toEqual({});
			expect(typesetOf(store.page('p1')!)[0].frame.w).toBeCloseTo(view.frame.w);
		});

		it('leaves the view as it was once the text is gone', () => {
			const session = widthResizeSession(store, press('p1', 't', { x: 0, y: 0 }), 'e');
			store.removeBlock('p1', 't');
			expect(session.update({ x: 40, y: 0 }, false)).toBeUndefined();
		});
	});

	describe('turn', () => {
		const centre = { x: 104, y: 246 };

		it('turns as far round as the pointer has gone since the press', () => {
			// Pressed on the knob over it, then a quarter of the way round to its right.
			const session = turnSession(
				store,
				press('p1', 't', { x: centre.x, y: centre.y - 60 }),
				centre
			);
			const quarter = session.update({ x: centre.x + 60, y: centre.y }, false)!;
			expect(quarter.kind).toBe('resizing');
			expect(quarter.rotation).toBeCloseTo(90);
			expect(quarter.frame).toEqual({ x: 12, y: 120, w: 80, h: 6 });
			const eighth = session.update({ x: centre.x + 60, y: centre.y - 60 }, false)!;
			expect(eighth.rotation).toBeCloseTo(45);
		});

		it('goes on from the turn it had', () => {
			store.updateTypeset('p1', 't', { rotation: 90 });
			const session = turnSession(
				store,
				press('p1', 't', { x: centre.x + 60, y: centre.y }),
				centre
			);
			const view = session.update({ x: centre.x, y: centre.y + 60 }, false)!;
			expect(view.rotation).toBeCloseTo(180);
		});

		it('holds to the right angles with Shift', () => {
			const session = turnSession(
				store,
				press('p1', 't', { x: centre.x, y: centre.y - 60 }),
				centre
			);
			// A little past an eighth: free it is some 50 degrees, held it is a quarter.
			const point = { x: centre.x + 60, y: centre.y - 50 };
			expect(session.update(point, false)!.rotation).toBeCloseTo(50.19, 1);
			expect(session.update(point, true)!.rotation).toBe(90);
		});

		it('writes the turn on the release, and reads it out', () => {
			const session = turnSession(
				store,
				press('p1', 't', { x: centre.x, y: centre.y - 60 }),
				centre
			);
			const view = session.update({ x: centre.x + 60, y: centre.y }, false)!;
			expect(session.commit(view)).toEqual({ say: 'Turned to 90 degrees' });
			expect(typesetOf(store.page('p1')!)[0].rotation).toBeCloseTo(90);
		});
	});
});
