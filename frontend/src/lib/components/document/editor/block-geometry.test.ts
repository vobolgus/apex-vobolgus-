import { describe, expect, it } from 'vitest';
import { contentBox, GUTTER_MM, overlaps, rotatedBounds } from '$lib/document/geometry';
import { chart } from '$lib/document/test-support';
import { DEFAULT_TEXT_STYLE } from '$lib/document/text';
import type { ChartBlock, DocPage, Rect, TextBlock } from '$lib/document/types';
import {
	bearingFrom,
	frameOnPage,
	framesOn,
	holdBlock,
	nudgedFrame,
	rotationOf,
	snapBlock
} from './block-geometry';

function disc(id: string, frame: Rect): ChartBlock {
	return { kind: 'chart', id, chart: chart(), frame };
}

function words(id: string, frame: Rect, rotation?: number): TextBlock {
	const text: TextBlock = { kind: 'text', id, text: 'Orion', style: DEFAULT_TEXT_STYLE, frame };
	if (rotation) text.rotation = rotation;
	return text;
}

function page(...blocks: DocPage['blocks']): DocPage {
	return { id: 'p', orientation: 'portrait', blocks };
}

describe('holdBlock', () => {
	it('holds a chart by its frame and its own aspect, never turned', () => {
		const item: ChartBlock = {
			kind: 'chart',
			id: 'a',
			chart: chart(1.6),
			frame: { x: 12, y: 12, w: 160, h: 100 }
		};
		const held = holdBlock(item);
		expect(held).toEqual({
			id: 'a',
			kind: 'chart',
			frame: { x: 12, y: 12, w: 160, h: 100 },
			aspect: 1.6,
			rotation: 0
		});
		// As it was at the press, whatever becomes of the block.
		item.frame.x = 50;
		expect(held.frame.x).toBe(12);
	});

	it('holds a text by the aspect its lines make it, and its turn', () => {
		const held = holdBlock(words('t', { x: 12, y: 12, w: 80, h: 8 }, 90));
		expect(held.kind).toBe('text');
		expect(held.aspect).toBe(10);
		expect(held.rotation).toBe(90);
	});
});

describe('rotationOf', () => {
	it('is the turn of a text, none when upright, and never a chart’s', () => {
		expect(rotationOf(words('t', { x: 0, y: 0, w: 80, h: 8 }, -45))).toBe(-45);
		expect(rotationOf(words('t', { x: 0, y: 0, w: 80, h: 8 }))).toBe(0);
		expect(rotationOf(disc('a', { x: 0, y: 0, w: 90, h: 90 }))).toBe(0);
	});
});

describe('framesOn', () => {
	it('gives what every block takes up, a turned text by the upright box around it', () => {
		const a = disc('a', { x: 12, y: 12, w: 90, h: 90 });
		const t = words('t', { x: 60, y: 150, w: 80, h: 6 }, 90);
		expect(framesOn(page(a, t))).toEqual([a.frame, rotatedBounds(t.frame, 90)]);
	});

	it('leaves out the block that is being moved', () => {
		const a = disc('a', { x: 12, y: 12, w: 90, h: 90 });
		const b = disc('b', { x: 12, y: 120, w: 60, h: 60 });
		expect(framesOn(page(a, b), 'a')).toEqual([b.frame]);
	});
});

describe('snapBlock', () => {
	it('holds an upright block to the content box', () => {
		const { frame } = snapBlock({ x: -20, y: 400, w: 90, h: 90 }, 0, [], 'portrait', 0);
		const box = contentBox('portrait');
		expect(frame).toEqual({ x: box.x, y: box.y + box.h - 90, w: 90, h: 90 });
	});

	it('holds a turned text by the upright box around it, its own frame moved by as much', () => {
		const frame = { x: -30, y: 100, w: 80, h: 6 };
		const snapped = snapBlock(frame, 90, [], 'portrait', 0);
		const bounds = rotatedBounds(snapped.frame, 90);
		expect(bounds.x).toBeCloseTo(contentBox('portrait').x);
		// Moved, not resized or turned.
		expect(snapped.frame.w).toBe(80);
		expect(snapped.frame.h).toBe(6);
		expect(snapped.frame.y).toBe(100);
	});
});

describe('nudgedFrame', () => {
	it('moves a block by the delta, clear of nothing: a nudge has no reach', () => {
		const a = disc('a', { x: 30, y: 30, w: 90, h: 90 });
		const near = disc('b', { x: 122, y: 30, w: 60, h: 60 });
		expect(nudgedFrame(page(a, near), a, { x: 1, y: 0 }).frame).toEqual({
			x: 31,
			y: 30,
			w: 90,
			h: 90
		});
	});

	it('stops at the margin, and gives the line it stopped on', () => {
		const a = disc('a', { x: 12, y: 12, w: 90, h: 90 });
		const { frame, guides } = nudgedFrame(page(a), a, { x: -10, y: 0 });
		expect(frame).toEqual({ x: 12, y: 12, w: 90, h: 90 });
		expect(guides.some((guide) => guide.axis === 'x' && guide.at === 12)).toBe(true);
	});

	it('stops a turned text where the box around it meets the margin', () => {
		const t = words('t', { x: 60, y: 150, w: 80, h: 6 }, 90);
		const { frame } = nudgedFrame(page(t), t, { x: -200, y: 0 });
		expect(rotatedBounds(frame, 90).x).toBeCloseTo(contentBox('portrait').x);
	});
});

describe('frameOnPage', () => {
	it('places a chart clear of the charts on the page it is sent to', () => {
		const there = disc('b', { x: 12, y: 12, w: 90, h: 90 });
		const sent = disc('a', { x: 12, y: 12, w: 80, h: 80 });
		const frame = frameOnPage(sent, page(there));
		expect(frame.w).toBe(80);
		expect(overlaps(frame, there.frame, GUTTER_MM - 1e-9)).toBe(false);
	});

	it('puts a chart at the top of an empty page, its size kept', () => {
		const sent = disc('a', { x: 40, y: 60, w: 80, h: 80 });
		expect(frameOnPage(sent, page())).toEqual({ x: 12, y: 12, w: 80, h: 80 });
	});

	it('leaves a text where it was on its own page, whatever is there', () => {
		const there = disc('b', { x: 12, y: 12, w: 90, h: 90 });
		const sent = words('t', { x: 20, y: 30, w: 80, h: 6 });
		expect(frameOnPage(sent, page(there))).toEqual({ x: 20, y: 30, w: 80, h: 6 });
	});
});

describe('bearingFrom', () => {
	it('is 0 to the right and grows clockwise, as the screen’s y grows downward', () => {
		const centre = { x: 100, y: 100 };
		expect(bearingFrom(centre, { x: 150, y: 100 })).toBeCloseTo(0);
		expect(bearingFrom(centre, { x: 100, y: 150 })).toBeCloseTo(90);
		expect(bearingFrom(centre, { x: 100, y: 50 })).toBeCloseTo(-90);
		expect(Math.abs(bearingFrom(centre, { x: 50, y: 100 }))).toBeCloseTo(180);
	});
});
