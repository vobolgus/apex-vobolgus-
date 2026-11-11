import { describe, expect, it } from 'vitest';
import { cross, dot, normalizeVec3, quaternionFromAxisAngle } from '$lib/math/quaternion';
import { viewBasis } from '$lib/math/projection';
import { contentBox } from './geometry';
import {
	alignAnchor,
	anchoredFrame,
	boundChart,
	boundItem,
	DEFAULT_TEXT_STYLE,
	fieldValues,
	fitTextFrame,
	FONT_METRICS,
	hasFields,
	layoutText,
	LINE_HEIGHT,
	MIN_TEXT_WIDTH_MM,
	MM_PER_PT,
	newTextFrame,
	normalizeRotation,
	NO_VALUE,
	quarterTurn,
	resolveFields,
	shownText,
	squareRotation,
	stepTextSize,
	textBounds,
	TEXT_SIZES,
	wrapLines
} from './text';
import type { ChartSnapshot, DocItem, DocText } from './types';

/** Every character one unit wide: a line of width 10 holds 10 of them. */
const mono = (text: string) => Array.from(text).length;

function chart(overrides: Partial<ChartSnapshot['view']> = {}): ChartSnapshot {
	return {
		view: {
			projection: 'stereographic',
			orientation: { x: 0, y: 0, z: 0, w: 1 },
			stereoFovDeg: 180,
			pinholeFovDeg: 70,
			pinholeAspectRatio: 1.6,
			pinholeHeightFrac: 1.18,
			...overrides
		},
		layers: {
			constellations: true,
			constellationBoundaries: false,
			equator: false,
			ecliptic: true,
			galacticEquator: false,
			planets: false
		},
		aspect: 1,
		createdAt: '2026-10-27T21:05:40.000Z'
	};
}

function text(overrides: Partial<DocText> = {}): DocText {
	return {
		id: 't',
		text: 'Text',
		style: { ...DEFAULT_TEXT_STYLE },
		frame: { x: 12, y: 12, w: 100, h: 5 },
		...overrides
	};
}

describe('wrapLines', () => {
	it('breaks at spaces, the space at the break hanging off the line', () => {
		expect(wrapLines('one two three four', 9, mono)).toEqual(['one two', 'three', 'four']);
		// "one two" and its space are 8 wide; the space does not count against the line.
		expect(wrapLines('one two three', 7, mono)).toEqual(['one two', 'three']);
		expect(wrapLines('fits as it is', 13, mono)).toEqual(['fits as it is']);
	});

	it('keeps the line breaks of the text, blank lines too', () => {
		expect(wrapLines('one\n\ntwo\r\nthree', 20, mono)).toEqual(['one', '', 'two', 'three']);
		expect(wrapLines('', 20, mono)).toEqual(['']);
	});

	it('keeps the spaces that begin a paragraph and those in a row, drops those at an end', () => {
		expect(wrapLines('  in  two   ', 20, mono)).toEqual(['  in  two']);
		expect(wrapLines('a\tb', 20, mono)).toEqual(['a b']);
	});

	it('breaks after a hyphen inside a word', () => {
		expect(wrapLines('a well-known fact', 7, mono)).toEqual(['a well-', 'known', 'fact']);
		// A dash between spaces is a word of its own.
		expect(wrapLines('one - two', 5, mono)).toEqual(['one -', 'two']);
	});

	it('breaks a word too long for a line between its characters', () => {
		expect(wrapLines('abcdefghij', 4, mono)).toEqual(['abcd', 'efgh', 'ij']);
		expect(wrapLines('to abcdefghij go', 4, mono)).toEqual(['to', 'abcd', 'efgh', 'ij', 'go']);
		// Never fewer than one character a line, however narrow.
		expect(wrapLines('abc', 0.5, mono)).toEqual(['a', 'b', 'c']);
	});

	it('counts characters, not UTF-16 units', () => {
		expect(wrapLines('😀😀😀', 2, mono)).toEqual(['😀😀', '😀']);
	});
});

describe('layoutText', () => {
	it('sets lines a line height apart, the first baseline where a line box has it', () => {
		const style = { ...DEFAULT_TEXT_STYLE, size: 10 };
		const size = 10 * MM_PER_PT;
		// Half a font size a character: 20 characters to a 10-size line.
		const layout = layoutText(
			'aaaa aaaa aaaa aaaa aaaa aaaa',
			style,
			10 * size,
			(line) => mono(line) / 2
		);
		expect(layout.size).toBeCloseTo(size);
		expect(layout.lineHeight).toBeCloseTo(size * LINE_HEIGHT);
		expect(layout.lines.map((line) => line.text)).toEqual(['aaaa aaaa aaaa aaaa', 'aaaa aaaa']);
		expect(layout.height).toBeCloseTo(2 * size * LINE_HEIGHT);
		const { ascent, descent } = FONT_METRICS.serif;
		const first = ((LINE_HEIGHT - ascent - descent) / 2 + ascent) * size;
		expect(layout.lines[0].baseline).toBeCloseTo(first);
		expect(layout.lines[1].baseline).toBeCloseTo(first + size * LINE_HEIGHT);
	});

	it('is one line high with nothing in it', () => {
		const layout = layoutText('', DEFAULT_TEXT_STYLE, 100, () => 0);
		expect(layout.lines).toHaveLength(1);
		expect(layout.height).toBeCloseTo(12 * MM_PER_PT * LINE_HEIGHT);
	});
});

describe('alignAnchor', () => {
	it('names the point of a line its x is', () => {
		expect(alignAnchor('left', 80)).toEqual({ x: 0, anchor: 'start' });
		expect(alignAnchor('center', 80)).toEqual({ x: 40, anchor: 'middle' });
		expect(alignAnchor('right', 80)).toEqual({ x: 80, anchor: 'end' });
	});
});

describe('fields', () => {
	/** The orientation whose view looks at (`raDeg`, `decDeg`), checked by its forward axis. */
	function looking(raDeg: number, decDeg: number): ChartSnapshot['view']['orientation'] {
		const ra = (raDeg * Math.PI) / 180;
		const dec = (decDeg * Math.PI) / 180;
		const want = {
			x: Math.cos(dec) * Math.cos(ra),
			y: Math.cos(dec) * Math.sin(ra),
			z: Math.sin(dec)
		};
		const [x, y, z] = viewBasis({ x: 0, y: 0, z: 0, w: 1 }).forward;
		// Whichever way round the view applies its orientation, one of the two turns it there.
		const from = { x, y, z };
		const axis = normalizeVec3(cross(from, want));
		const angle = Math.acos(Math.max(-1, Math.min(1, dot(from, want))));
		const error = (q: ChartSnapshot['view']['orientation']) => {
			const [fx, fy, fz] = viewBasis(q).forward;
			return Math.hypot(fx - want.x, fy - want.y, fz - want.z);
		};
		const best = [angle, -angle]
			.map((turn) => quaternionFromAxisAngle(axis, turn))
			.sort((a, b) => error(a) - error(b))[0];
		expect(error(best)).toBeLessThan(1e-9);
		return best;
	}

	it('reads the zenith of a stereographic chart as latitude and sidereal time', () => {
		const values = fieldValues(chart({ orientation: looking(206.25, 55.7) }));
		expect(values.lat).toBe('56° N');
		expect(values.lst).toBe('13h 45m');
		expect(values.ra).toBe('13h 45m');
		expect(values.dec).toBe('+56°');
		expect(values.fov).toBe('180°');
		expect(values.date).toBe('2026-10-27');
		expect(values.time).toBe('21:05 UTC');

		const south = fieldValues(chart({ orientation: looking(15, -33.4) }));
		expect(south.lat).toBe('33° S');
		expect(south.lst).toBe('1h 00m');
		expect(south.dec).toBe('−33°');
	});

	it('gives a pinhole frame a centre and a field, but no latitude or sidereal time', () => {
		const values = fieldValues(
			chart({ projection: 'pinhole', orientation: looking(83.8, -5.4), pinholeFovDeg: 42.4 })
		);
		expect(values.lat).toBe(NO_VALUE);
		expect(values.lst).toBe(NO_VALUE);
		expect(values.ra).toBe('5h 35m');
		expect(values.dec).toBe('−5°');
		expect(values.fov).toBe('42°');
	});

	it('replaces the fields it knows and leaves the rest as typed', () => {
		const sky = chart({ orientation: looking(90, 40) });
		expect(resolveFields('φ = {lat}, s = {lst} {unknown} {LAT} {}', sky)).toBe(
			'φ = 40° N, s = 6h 00m {unknown} {LAT} {}'
		);
		expect(resolveFields('φ = {lat}, {date}', null)).toBe(`φ = ${NO_VALUE}, ${NO_VALUE}`);
		expect(resolveFields('no fields', null)).toBe('no fields');
		expect(hasFields('at {lst}')).toBe(true);
		expect(hasFields('at {noon}')).toBe(false);
	});

	it('reads the chart a text names, else the nearest on its page', () => {
		const first = chart({ orientation: looking(0, 10) });
		const second = chart({ orientation: looking(0, 70) });
		const items: DocItem[] = [
			{ id: 'a', chart: first, frame: { x: 12, y: 12, w: 80, h: 80 } },
			{ id: 'b', chart: second, frame: { x: 118, y: 12, w: 80, h: 80 } }
		];
		const under = (x: number, w = 60) => text({ text: '{lat}', frame: { x, y: 98, w, h: 6 } });
		// A caption reads the chart it is put under.
		expect(boundItem({ items }, under(20))?.id).toBe('a');
		expect(boundItem({ items }, under(130))?.id).toBe('b');
		expect(shownText({ items }, under(130))).toBe('70° N');
		// Under both, as near to each: the one whose centre is nearer, then the earlier.
		expect(boundItem({ items }, under(100, 98))?.id).toBe('b');
		expect(boundItem({ items }, under(12, 186))?.id).toBe('a');
		// Under a short chart, 12 mm below it and 10 mm from the tall one beside: the short one's.
		const mixed: DocItem[] = [
			{ id: 'disc', chart: first, frame: { x: 12, y: 12, w: 90, h: 90 } },
			{ id: 'frame', chart: second, frame: { x: 108, y: 12, w: 90, h: 56 } }
		];
		const caption = text({ frame: { x: 112, y: 80, w: 86, h: 6 } });
		expect(boundItem({ items: mixed }, caption)?.id).toBe('frame');
		// Beside a chart, with the other far below, it is the one beside.
		const beside = text({ frame: { x: 108, y: 30, w: 60, h: 6 } });
		const stacked: DocItem[] = [mixed[0], { ...mixed[1], frame: { x: 108, y: 200, w: 90, h: 56 } }];
		expect(boundItem({ items: stacked }, beside)?.id).toBe('disc');
		// Told a chart, it reads that one wherever it is, while the chart is on the page.
		expect(boundItem({ items }, { ...under(20), chartId: 'b' })?.id).toBe('b');
		expect(boundChart({ items }, { ...under(20), chartId: 'b' })).toBe(second);
		expect(boundItem({ items }, { ...under(20), chartId: 'gone' })?.id).toBe('a');
		expect(boundItem({ items: [] }, under(20))).toBeNull();
		expect(boundChart({ items: [] }, under(20))).toBeNull();
		expect(shownText({ items: [] }, under(20))).toBe(NO_VALUE);
	});
});

describe('fitTextFrame', () => {
	const box = contentBox('portrait');

	it('keeps a frame inside the content box as it is', () => {
		const frame = { x: 40, y: 50, w: 80, h: 12 };
		expect(fitTextFrame(frame, 'portrait')).toEqual(frame);
	});

	it('holds the width between the smallest and the box, and moves the frame in', () => {
		expect(fitTextFrame({ x: 0, y: 0, w: 5, h: 10 }, 'portrait')).toEqual({
			x: box.x,
			y: box.y,
			w: MIN_TEXT_WIDTH_MM,
			h: 10
		});
		expect(fitTextFrame({ x: 150, y: 290, w: 400, h: 10 }, 'portrait')).toEqual({
			x: box.x,
			y: box.y + box.h - 10,
			w: box.w,
			h: 10
		});
	});

	it('keeps the top of a text taller than the box at the top of the box', () => {
		const fitted = fitTextFrame({ x: 12, y: 100, w: 100, h: 400 }, 'portrait');
		expect(fitted.y).toBe(box.y);
		expect(fitted.h).toBe(400);
	});
});

describe('newTextFrame', () => {
	const box = contentBox('portrait');

	it('goes at the top of an empty page, the width of the content box', () => {
		expect(newTextFrame({ orientation: 'portrait', items: [] }, 6)).toEqual({
			x: box.x,
			y: box.y,
			w: box.w,
			h: 6
		});
	});

	it('takes the topmost free place: over a chart with room above it', () => {
		const items = [{ id: 'a', chart: chart(), frame: { x: 42, y: 40, w: 126, h: 126 } }];
		expect(newTextFrame({ orientation: 'portrait', items }, 6)).toEqual({
			x: box.x,
			y: box.y,
			w: box.w,
			h: 6
		});
		// With a text there already, the next goes under it: a gutter clear, still over the chart.
		const texts = [text({ frame: { x: 12, y: 12, w: 186, h: 6 } })];
		expect(newTextFrame({ orientation: 'portrait', items, texts }, 6)).toEqual({
			x: box.x,
			y: 24,
			w: box.w,
			h: 6
		});
	});

	it('goes beside a chart that holds the top, as wide as the room there', () => {
		const items = [{ id: 'a', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } }];
		expect(newTextFrame({ orientation: 'portrait', items }, 6)).toEqual({
			x: 108,
			y: box.y,
			w: 90,
			h: 6
		});
	});

	it('goes under a chart across the top, and passes by a place too narrow or too low', () => {
		const across = [{ id: 'a', chart: chart(), frame: { x: 12, y: 12, w: 186, h: 186 } }];
		expect(newTextFrame({ orientation: 'portrait', items: across }, 6)).toEqual({
			x: box.x,
			y: 204,
			w: box.w,
			h: 6
		});
		// 30 mm beside the chart is no place for a text; 4 mm over it is not 6.
		const narrow = [{ id: 'a', chart: chart(), frame: { x: 12, y: 22, w: 150, h: 150 } }];
		expect(newTextFrame({ orientation: 'portrait', items: narrow }, 6).y).toBe(178);
		expect(newTextFrame({ orientation: 'portrait', items: narrow }, 3).y).toBe(box.y);
	});

	it('keeps clear of what a turned text takes up', () => {
		// A line down the left margin: 6 mm wide on the page, the height of the box.
		const texts = [text({ frame: { x: 12 - 133.5, y: 145.5, w: 273, h: 6 }, rotation: -90 })];
		expect(textBounds(texts[0])).toMatchObject({ x: 12, y: 12, w: 6, h: 273 });
		const frame = newTextFrame({ orientation: 'portrait', items: [], texts }, 6);
		expect(frame.x).toBeCloseTo(24);
		expect(frame.y).toBe(box.y);
		expect(frame.w).toBeCloseTo(box.w - 12);
	});

	it('goes at the top, over what is there, on a page with no room', () => {
		const items = [{ id: 'a', chart: chart(), frame: { x: 12, y: 12, w: 186, h: 273 } }];
		expect(newTextFrame({ orientation: 'portrait', items }, 6)).toEqual({
			x: box.x,
			y: box.y,
			w: box.w,
			h: 6
		});
	});
});

describe('turning a text', () => {
	const box = contentBox('portrait');

	it('keeps an angle in (−180, 180], to a tenth of a degree', () => {
		expect(normalizeRotation(0)).toBe(0);
		expect(normalizeRotation(90)).toBe(90);
		expect(normalizeRotation(180)).toBe(180);
		expect(normalizeRotation(-180)).toBe(180);
		expect(normalizeRotation(270)).toBe(-90);
		expect(normalizeRotation(-450)).toBe(-90);
		expect(normalizeRotation(33.333)).toBe(33.3);
		expect(normalizeRotation(359.99)).toBe(0);
		expect(normalizeRotation(NaN)).toBe(0);
	});

	it('squares an angle to the nearest right one', () => {
		expect(squareRotation(12)).toBe(0);
		expect(squareRotation(-40)).toBe(0);
		expect(squareRotation(50)).toBe(90);
		expect(squareRotation(170)).toBe(180);
		expect(squareRotation(-170)).toBe(180);
		expect(squareRotation(-100)).toBe(-90);
	});

	it('turns by quarters to the next right angle, either way', () => {
		expect(quarterTurn(0, 1)).toBe(90);
		expect(quarterTurn(90, 1)).toBe(180);
		expect(quarterTurn(180, 1)).toBe(-90);
		expect(quarterTurn(-90, 1)).toBe(0);
		expect(quarterTurn(30, 1)).toBe(90);
		expect(quarterTurn(30, -1)).toBe(0);
		expect(quarterTurn(0, -1)).toBe(-90);
		expect(quarterTurn(-90, -1)).toBe(180);
	});

	it('takes up the upright box around it', () => {
		const frame = { x: 50, y: 100, w: 80, h: 10 };
		expect(textBounds({ frame })).toBe(frame);
		const quarter = textBounds({ frame, rotation: 90 });
		expect(quarter.x).toBeCloseTo(85);
		expect(quarter.y).toBeCloseTo(65);
		expect(quarter.w).toBeCloseTo(10);
		expect(quarter.h).toBeCloseTo(80);
		const half = textBounds({ frame, rotation: 180 });
		expect(half.x).toBeCloseTo(50);
		expect(half.w).toBeCloseTo(80);
		const slant = textBounds({ frame, rotation: 45 });
		expect(slant.w).toBeCloseTo(90 * Math.SQRT1_2);
		expect(slant.h).toBeCloseTo(90 * Math.SQRT1_2);
		expect(slant.x + slant.w / 2).toBeCloseTo(90);
	});

	it('grows from its own top corner, wherever the turn has put that', () => {
		const frame = { x: 50, y: 100, w: 80, h: 10 };
		expect(anchoredFrame(frame, 0, 60, 20)).toEqual({ x: 50, y: 100, w: 60, h: 20 });
		expect(anchoredFrame(frame, 0, 60, 20, 'right')).toEqual({ x: 70, y: 100, w: 60, h: 20 });
		// A quarter clockwise, its top-left is the top-right of what it takes up: (95, 65).
		const corner = (f: typeof frame, rotation: number) => {
			const b = textBounds({ frame: f, rotation });
			return { x: b.x + b.w, y: b.y };
		};
		expect(corner(frame, 90)).toEqual({ x: 95, y: 65 });
		const taller = anchoredFrame(frame, 90, 80, 30);
		expect(corner(taller, 90).x).toBeCloseTo(95);
		expect(corner(taller, 90).y).toBeCloseTo(65);
		// Upside down it is the bottom-right, and the text grows up the page.
		const flipped = anchoredFrame(frame, 180, 80, 30);
		expect(flipped.x).toBeCloseTo(50);
		expect(flipped.y + flipped.h).toBeCloseTo(110);
	});

	it('fits on the page by what it takes up, and is no wider than fits at its turn', () => {
		// Down the left edge: its own frame hangs far off the page, what it takes up is inside.
		const sideways = fitTextFrame({ x: -200, y: 140, w: 100, h: 10 }, 'portrait', -90);
		const bounds = textBounds({ frame: sideways, rotation: -90 });
		expect(bounds.x).toBeCloseTo(box.x);
		expect(bounds.w).toBeCloseTo(10);
		expect(bounds.h).toBeCloseTo(100);
		expect(sideways.w).toBe(100);
		// On its side a text may be as long as the box is tall, and no longer.
		expect(fitTextFrame({ x: 0, y: 0, w: 500, h: 10 }, 'portrait', 90).w).toBeCloseTo(box.h);
		expect(fitTextFrame({ x: 0, y: 0, w: 500, h: 10 }, 'portrait', 180).w).toBeCloseTo(box.w);
		const slant = fitTextFrame({ x: 0, y: 0, w: 500, h: 10 }, 'portrait', 45);
		const taken = textBounds({ frame: slant, rotation: 45 });
		expect(taken.w).toBeCloseTo(box.w);
		expect(taken.x).toBeCloseTo(box.x);
		expect(taken.y).toBeCloseTo(box.y);
	});

	it('reads the chart nearest to what it takes up', () => {
		const items: DocItem[] = [
			{ id: 'a', chart: chart(), frame: { x: 30, y: 12, w: 80, h: 80 } },
			{ id: 'b', chart: chart(), frame: { x: 30, y: 200, w: 80, h: 80 } }
		];
		// Its frame is level with the first chart; turned, it stands beside the second.
		const upright = text({ frame: { x: 114, y: 150, w: 180, h: 6 } });
		expect(textBounds({ ...upright, rotation: 90 })).toMatchObject({ y: 63, h: 180 });
		const low = text({ frame: { x: 30, y: 237, w: 180, h: 6 }, rotation: 90 });
		expect(textBounds(low).y).toBeCloseTo(150);
		expect(boundItem({ items }, low)?.id).toBe('b');
	});
});

describe('stepTextSize', () => {
	it('steps through the sizes and stops at the ends', () => {
		expect(stepTextSize(12, 1)).toBe(14);
		expect(stepTextSize(12, -1)).toBe(11);
		expect(stepTextSize(13, 1)).toBe(14);
		expect(stepTextSize(13, -1)).toBe(12);
		expect(stepTextSize(TEXT_SIZES[0], -1)).toBeNull();
		expect(stepTextSize(TEXT_SIZES[TEXT_SIZES.length - 1], 1)).toBeNull();
	});
});
