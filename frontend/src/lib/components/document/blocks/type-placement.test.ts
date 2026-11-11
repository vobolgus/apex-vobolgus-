import { describe, expect, it } from 'vitest';
import { rotatedBounds } from '$lib/document/geometry';
import { typePlacement } from './type-placement';

const A4 = { w: 210, h: 297 };
/** Screen px per mm. */
const SCALE = 2;

/** The px a CSS offset `calc(50% + Npx)` stands off the box's middle. */
function px(offset: string): number {
	const match = /^calc\(50% \+ (-?[\d.]+)px\)$/.exec(offset);
	if (!match) throw new Error(`not an offset: ${offset}`);
	return Number(match[1]);
}

describe('typePlacement', () => {
	const frame = { x: 20, y: 40, w: 100, h: 6 };

	it('draws an upright text as tall as its lines, from its own corner', () => {
		const placed = typePlacement(frame, 14, 0, A4, SCALE, true);
		expect(placed.box).toEqual({ x: 20, y: 40, w: 100, h: 14 });
	});

	it('keeps a turned text’s corner where it is on the page as its lines grow', () => {
		const placed = typePlacement(frame, 14, 90, A4, SCALE, false);
		// Turned a quarter clockwise, its top-left corner is at the top right of what it takes up.
		const corner = (box: typeof frame) => {
			const bounds = rotatedBounds(box, 90);
			return { x: bounds.x + bounds.w, y: bounds.y };
		};
		const before = corner(frame);
		const after = corner(placed.box);
		expect(after.x).toBeCloseTo(before.x, 9);
		expect(after.y).toBeCloseTo(before.y, 9);
	});

	it('puts the toolbar under the text, clear of it, and above it low on the page', () => {
		const high = typePlacement(frame, 6, 0, A4, SCALE, false);
		expect(high.toolsAbove).toBe(false);
		// Half the text's height on the screen, and the gap.
		expect(px(high.below)).toBeCloseTo(6 + 10, 9);
		const low = typePlacement({ ...frame, y: 230 }, 6, 0, A4, SCALE, false);
		expect(low.toolsAbove).toBe(true);
	});

	it('stands clear of the knob over the text, wherever the turn has it pointing', () => {
		const upright = typePlacement(frame, 6, 0, A4, SCALE, true);
		// Up: the knob's stalk, half the text and 24 px; down, only the text.
		expect(px(upright.above)).toBeCloseTo(6 + 24 + 10, 9);
		expect(px(upright.below)).toBeCloseTo(6 + 10, 9);
		const over = typePlacement(frame, 6, 180, A4, SCALE, true);
		expect(px(over.below)).toBeCloseTo(6 + 24 + 10, 6);
		expect(px(over.above)).toBeCloseTo(6 + 10, 6);
		// Turned to the side, the knob's own half width is in the reach both ways.
		const side = typePlacement(frame, 6, 90, A4, SCALE, true);
		expect(px(side.above)).toBeCloseTo(100 + 10, 6);
		expect(px(side.below)).toBeCloseTo(100 + 10, 6);
	});
});
