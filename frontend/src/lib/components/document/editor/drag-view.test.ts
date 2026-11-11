import { describe, expect, it } from 'vitest';
import type { SnapGuide } from '$lib/document/geometry';
import { blockState, pageDrag, type DragView } from './drag-view';

const GUIDE: SnapGuide = { axis: 'x', at: 12, from: 12, to: 285 };

function carried(over: Partial<DragView> = {}): DragView {
	return {
		kind: 'moving',
		pageId: 'p1',
		blockId: 'a',
		targetId: 'p2',
		frame: { x: 230, y: 40, w: 90, h: 90 },
		landing: { x: 12, y: 40, w: 90, h: 90 },
		guides: [GUIDE],
		...over
	};
}

describe('pageDrag', () => {
	it('draws nothing on any page at rest', () => {
		expect(pageDrag('p1', null, null)).toBeNull();
	});

	it('draws the block on its own page, wherever on the stage that is, and the lines on the target', () => {
		const view = carried();
		expect(pageDrag('p1', view, null)).toEqual({
			blockId: 'a',
			frame: view.frame,
			kind: 'moving',
			margins: false,
			rotation: null,
			guides: [],
			target: false
		});
		expect(pageDrag('p2', view, null)).toEqual({
			blockId: null,
			frame: null,
			kind: 'moving',
			margins: false,
			rotation: null,
			guides: [GUIDE],
			target: true
		});
		expect(pageDrag('p3', view, null)).toBeNull();
	});

	it('draws both on one page when the block stays on it', () => {
		const drawn = pageDrag('p1', carried({ targetId: 'p1' }), null)!;
		expect(drawn.blockId).toBe('a');
		expect(drawn.guides).toEqual([GUIDE]);
		expect(drawn.target).toBe(true);
	});

	it('has no target while the block is out of reach of every page', () => {
		const view = carried({ kind: 'detached', targetId: null, landing: null, guides: [] });
		expect(pageDrag('p1', view, null)).toMatchObject({ kind: 'detached', target: false });
		expect(pageDrag('p2', view, null)).toBeNull();
	});

	it('draws the margins for a chart being resized, and the turn of a text being turned', () => {
		const resized = carried({ kind: 'resizing', targetId: 'p1', landing: null, margins: true });
		expect(pageDrag('p1', resized, null)).toMatchObject({ kind: 'resizing', margins: true });
		const turned = carried({ kind: 'resizing', targetId: 'p1', landing: null, rotation: 45 });
		expect(pageDrag('p1', turned, null)).toMatchObject({ rotation: 45, margins: false });
	});

	it('draws the lines of the last nudge on its page, while no drag goes on', () => {
		const flash = { pageId: 'p1', guides: [GUIDE] };
		expect(pageDrag('p1', null, flash)).toEqual({
			blockId: null,
			frame: null,
			kind: 'moving',
			margins: false,
			rotation: null,
			guides: [GUIDE],
			target: false
		});
		expect(pageDrag('p2', null, flash)).toBeNull();
		// A drag's own lines take their place.
		expect(pageDrag('p1', carried({ targetId: 'p3' }), flash)!.guides).toEqual([]);
	});
});

describe('blockState', () => {
	const drag = pageDrag('p1', carried({ kind: 'resizing', targetId: 'p1' }), null);

	it('is the drag’s for the block it carries, resizes or turns', () => {
		expect(blockState('a', drag, null, null)).toBe('resizing');
		expect(blockState('a', pageDrag('p1', carried(), null), null, null)).toBe('moving');
	});

	it('is at rest for every other block, on the page the drag is over too', () => {
		expect(blockState('b', drag, null, null)).toBe('idle');
		expect(blockState('a', pageDrag('p2', carried(), null), null, null)).toBe('idle');
		expect(blockState('a', null, null, null)).toBe('idle');
	});

	it('comes to rest, or eases back, once let go', () => {
		expect(blockState('a', null, 'a', null)).toBe('settling');
		expect(blockState('a', null, null, 'a')).toBe('returning');
		// The drag in hand comes first: a block picked up again as it lands is carried.
		expect(blockState('a', drag, 'a', 'a')).toBe('resizing');
	});
});
