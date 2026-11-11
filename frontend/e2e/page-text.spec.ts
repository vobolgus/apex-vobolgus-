import { expect, test, type Locator, type Page } from '@playwright/test';
import { contentBox } from '../src/lib/document/geometry';
import {
	chartsOf,
	documentOf,
	savedPages,
	seedDocument,
	typesetOf,
	type SavedType
} from './saved-document';

/**
 * Text on a page, in the page editor: added from the page's name, typed in place,
 * its fields read from the page's chart; moved and made narrower with the pointer,
 * styled from its toolbar and the keys, removed and brought back; and sent to the
 * backend line by line, as the editor broke it.
 */

const MM_PER_PT = 25.4 / 72;

const STEREO = {
	view: {
		projection: 'stereographic',
		orientation: { x: 0.3, y: 0.2, z: 0.1, w: 0.9 },
		stereoFovDeg: 180,
		pinholeFovDeg: 70,
		pinholeAspectRatio: 1.6,
		pinholeHeightFrac: 1.18
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
	createdAt: '2026-10-27T12:00:00.000Z'
};

const STYLE = { font: 'serif', size: 12, bold: false, italic: false, align: 'left' };

/** A text as it is saved, with its words. */
type SavedText = SavedType & { kind: 'text'; text: string };

/** A disc on the first page with room under it, and an empty second page. */
function documentWith(texts: SavedText[] = []) {
	const disc = {
		kind: 'chart',
		id: 'e2e-a',
		chart: STEREO,
		frame: { x: 42, y: 30, w: 126, h: 126 }
	};
	return documentOf([
		{
			id: 'e2e-page-1',
			orientation: 'portrait',
			blocks: [disc, ...texts],
			...(texts.length > 0 ? { manual: true } : {})
		},
		{ id: 'e2e-page-2', orientation: 'portrait', blocks: [] }
	]);
}

const CAPTION: SavedText = {
	kind: 'text',
	id: 'e2e-text',
	text: 'Find the zenith and name the ten brightest stars of this sky.',
	style: STYLE,
	frame: { x: 12, y: 170, w: 186, h: 6 }
};

async function seedAndOpen(page: Page, texts: SavedText[] = []) {
	await seedDocument(page, documentWith(texts));
	await page.getByRole('button', { name: /^Page 1,/ }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await expect(editor).toBeVisible();
	// The type is measured in its own face: wait for it, as a layout before it is another's.
	await page.evaluate(() => document.fonts.ready);
	return editor;
}

/** The texts of the saved page `at` (saves are debounced: poll this). */
async function savedTexts(page: Page, at = 0): Promise<SavedType[]> {
	const saved = (await savedPages(page))[at];
	return saved ? typesetOf(saved) : [];
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
}

/** The element's box once it has stopped moving: a text let go comes to rest over a moment. */
async function settledBox(locator: Locator) {
	// At rest, not on its way there: its handles take no press until it is.
	await expect(locator.locator('xpath=ancestor::*[@data-item-id][1]')).toHaveAttribute(
		'data-state',
		'idle'
	);
	let last = await locator.boundingBox();
	for (let i = 0; i < 40; i += 1) {
		await locator.page().waitForTimeout(60);
		const box = await locator.boundingBox();
		if (box && last && Math.abs(box.x - last.x) < 0.5 && Math.abs(box.y - last.y) < 0.5) {
			return box;
		}
		last = box;
	}
	throw new Error('the element never stopped moving');
}

function centre(box: { x: number; y: number; width: number; height: number }) {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The lines a text shows, top to bottom. */
function shownLines(text: Locator) {
	return text.locator('xpath=..').locator('svg text').allTextContents();
}

test('a text is added at the top of the page, typed in place, and shows the chart in its fields', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	await editor.getByRole('button', { name: 'Add text to page 1' }).click();

	// It opens for typing with its word selected: typing replaces it.
	const field = editor.getByRole('textbox', { name: 'Text 1' });
	await expect(field).toBeFocused();
	await expect(field).toHaveValue('Text');
	await page.keyboard.type('Latitude {lat}, ');
	// The row of fields under the toolbar writes one at the caret.
	await editor.getByRole('button', { name: 'Sidereal time' }).click();
	await expect(field).toHaveValue('Latitude {lat}, {lst}');
	await expect(field).toBeFocused();

	// Escape keeps what was typed and leaves the text selected, the editor open.
	await page.keyboard.press('Escape');
	const text = editor.getByRole('button', {
		name: /^Text 1 of 1: Latitude \d+° [NS], \d+h \d\dm$/
	});
	await expect(text).toBeFocused();
	await expect(field).toHaveCount(0);
	expect(await shownLines(text)).toEqual([
		expect.stringMatching(/^Latitude \d+° [NS], \d+h \d\dm$/)
	]);
	await expect(
		editor.getByRole('group', { name: 'Page 1, A4 portrait, 1 chart, 1 text' })
	).toBeVisible();

	// Saved as typed, in the topmost free place (over the chart), as wide as the content box;
	// the page is hand-arranged.
	await expect.poll(async () => (await savedTexts(page))[0]?.text).toBe('Latitude {lat}, {lst}');
	const [saved] = await savedTexts(page);
	const box = contentBox('portrait');
	expect(saved.frame.x).toBe(box.x);
	expect(saved.frame.w).toBe(box.w);
	expect(saved.frame.y).toBe(box.y);
	expect(saved.frame.h).toBeCloseTo(12 * MM_PER_PT * 1.35, 2);
	expect(saved.style).toEqual(STYLE);
	expect((await savedPages(page))[0].manual).toBe(true);

	// Enter types in it again; emptied, it is taken off the page.
	await page.keyboard.press('Enter');
	await expect(field).toBeFocused();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Escape');
	await expect(editor.getByRole('button', { name: /^Text 1 of/ })).toHaveCount(0);
	await expect(editor.getByRole('group', { name: 'Page 1, A4 portrait, 1 chart' })).toBeFocused();
	await expect.poll(async () => (await savedTexts(page)).length).toBe(0);
});

test('a text is moved with the pointer and made narrower by its side, its lines wrapping', async ({
	page
}) => {
	const editor = await seedAndOpen(page, [CAPTION]);
	const paper = editor.getByRole('group', { name: 'Page 1, A4 portrait, 1 chart, 1 text' });
	const scale = (await paper.boundingBox())!.width / 210;
	const text = editor.getByRole('button', { name: /^Text 1 of 1: Find the zenith/ });
	expect(await shownLines(text)).toHaveLength(1);

	// Down by 40 mm: it goes with the pointer and stays where it is let go.
	const from = centre((await text.boundingBox())!);
	await drag(page, from, { x: from.x, y: from.y + 40 * scale });
	await expect.poll(async () => (await savedTexts(page))[0]?.frame.y).toBeCloseTo(210, 0);
	expect((await savedTexts(page))[0].frame).toMatchObject({ x: 12, w: 186 });

	// Its right side to the middle of the page: the left stays, the lines wrap, the height follows.
	const box = await settledBox(text);
	const handle = { x: box.x + box.width + 3, y: box.y + box.height / 2 };
	await drag(page, handle, { x: box.x + 60 * scale + 1, y: handle.y + 30 });
	await expect.poll(async () => (await savedTexts(page))[0]?.frame.w).toBeLessThan(70);
	await expect
		.poll(async () => (await savedTexts(page))[0]?.frame.h)
		.toBeGreaterThan(2 * 12 * MM_PER_PT);
	const narrow = (await savedTexts(page))[0].frame;
	expect(narrow.x).toBe(12);
	expect(narrow.w).toBeGreaterThanOrEqual(20);
	const lines = await shownLines(text);
	expect(lines.length).toBeGreaterThan(1);
	expect(lines.join(' ')).toBe(CAPTION.text);
	// One line height a line: the frame is exactly as tall as its lines.
	expect(narrow.h).toBeCloseTo(lines.length * 12 * MM_PER_PT * 1.35, 2);

	// Onto the next page, like a chart.
	const next = editor.getByRole('button', { name: 'Show page 2, no charts' });
	await drag(page, centre(await settledBox(text)), centre((await next.boundingBox())!));
	await expect.poll(async () => (await savedTexts(page, 1)).map((t) => t.id)).toEqual(['e2e-text']);
	expect(await savedTexts(page, 0)).toEqual([]);
});

test('the toolbar and the keys set the type; Delete removes a text and Undo brings it back', async ({
	page
}) => {
	const editor = await seedAndOpen(page, [CAPTION]);
	const text = editor.getByRole('button', { name: /^Text 1 of 1:/ });
	await text.click();
	await expect(text).toBeFocused();

	const tools = editor.getByRole('group', { name: 'Text 1', exact: true });
	await tools.getByRole('button', { name: 'Bold' }).click();
	await tools.getByRole('button', { name: 'Italic' }).click();
	await tools.getByRole('button', { name: 'Font: serif. Change' }).click();
	await tools.getByRole('button', { name: 'Aligned left. Change' }).click();
	await tools.getByRole('button', { name: 'Larger type' }).click();
	// The tools keep the focus on the text, so the keys go on working.
	await expect(text).toBeFocused();
	await page.keyboard.press('Equal');
	await page.keyboard.press('ArrowDown');
	await expect
		.poll(async () => (await savedTexts(page))[0]?.style)
		.toEqual({ font: 'sans', size: 16, bold: true, italic: true, align: 'center' });
	await expect(tools.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(async () => (await savedTexts(page))[0]?.frame.y).toBe(171);
	// Larger type is taller.
	await expect
		.poll(async () => (await savedTexts(page))[0]?.frame.h)
		.toBeCloseTo(16 * MM_PER_PT * 1.35, 2);

	// A page with text on it is not empty: the editor does not offer to delete it.
	await expect(editor.getByRole('button', { name: 'Delete page 1' })).toHaveCount(0);

	await page.keyboard.press('Delete');
	await expect(text).toHaveCount(0);
	await expect.poll(async () => (await savedTexts(page)).length).toBe(0);
	const toast = page.getByRole('status').filter({ hasText: 'Text removed' });
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(text).toBeFocused();
	await expect.poll(async () => (await savedTexts(page)).map((t) => t.id)).toEqual(['e2e-text']);
});

test('the document sends its text to the backend line by line, as the editor shows it', async ({
	page
}) => {
	const long = {
		...CAPTION,
		text: `${CAPTION.text} Then mark the ecliptic.\n\nField {fov}`,
		frame: { x: 12, y: 170, w: 80, h: 6 }
	};
	const editor = await seedAndOpen(page, [long]);
	const text = editor.getByRole('button', { name: /^Text 1 of 1:/ });
	await expect.poll(async () => (await shownLines(text)).length).toBeGreaterThan(2);
	const lines = await shownLines(text);
	expect(lines.at(-1)).toBe('Field 180°');
	await page.keyboard.press('Escape');
	await expect(editor).toBeHidden();

	interface TextBody {
		font: string;
		bold: boolean;
		italic: boolean;
		size_mm: number;
		anchor: string;
		lines: { x_mm: number; y_mm: number; text: string }[];
	}
	let body: { pages: { items: unknown[]; texts: TextBody[] }[] } | null = null;
	await page.route('**/api/export/document', async (route) => {
		body = route.request().postDataJSON();
		await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF\n' });
	});
	await page.getByRole('button', { name: 'Choose export format' }).click();
	const download = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'PDF document' }).click();
	await download;

	expect(body).not.toBeNull();
	const [first, second] = body!.pages;
	expect(second.texts).toEqual([]);
	expect(first.items).toHaveLength(1);
	expect(first.texts).toHaveLength(1);
	const sent = first.texts[0];
	expect(sent).toMatchObject({ font: 'serif', bold: false, italic: false, anchor: 'start' });
	expect(sent.size_mm).toBeCloseTo(12 * MM_PER_PT, 6);
	// The very lines the editor drew, the blank one left out, a line height apart.
	expect(sent.lines.map((line) => line.text)).toEqual(lines);
	expect(sent.lines.every((line) => line.x_mm === 12)).toBe(true);
	const step = 12 * MM_PER_PT * 1.35;
	expect(sent.lines[1].y_mm - sent.lines[0].y_mm).toBeCloseTo(step, 6);
	expect(sent.lines.at(-1)!.y_mm - sent.lines.at(-2)!.y_mm).toBeCloseTo(2 * step, 6);
	expect(sent.lines[0].y_mm).toBeGreaterThan(170);
	expect(sent.lines[0].y_mm).toBeLessThan(170 + step);
});

test('on a page with two charts a text reads the nearest, or the one it is told by number', async ({
	page
}) => {
	const pinhole = {
		...STEREO,
		view: { ...STEREO.view, projection: 'pinhole', pinholeFovDeg: 40 },
		aspect: 1.6
	};
	// Saved in the first shape, charts in `items` and text in `texts`: the app brings it over.
	const caption = {
		id: CAPTION.id,
		text: 'Field {fov}',
		style: STYLE,
		frame: { x: 112, y: 80, w: 86, h: 6 }
	};
	await seedDocument(page, {
		pages: [
			{
				id: 'e2e-page-1',
				orientation: 'portrait',
				manual: true,
				items: [
					{ id: 'e2e-disc', chart: STEREO, frame: { x: 12, y: 12, w: 90, h: 90 } },
					{ id: 'e2e-frame', chart: pinhole, frame: { x: 108, y: 12, w: 90, h: 56.25 } }
				],
				texts: [caption]
			}
		]
	});
	await page.getByRole('button', { name: /^Page 1,/ }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await page.evaluate(() => document.fonts.ready);

	// Under the pinhole frame, it reads the frame.
	const text = editor.getByRole('button', { name: /^Text 1 of 1:/ });
	await expect.poll(() => shownLines(text)).toEqual(['Field 40°']);

	// Selected, it says which chart it reads, and the charts show their numbers.
	await text.click();
	const reads = editor.getByRole('group', { name: 'The chart the fields read' });
	const nearest = reads.getByRole('button', { name: 'Read the nearest chart, now chart 2' });
	await expect(nearest).toHaveAttribute('aria-pressed', 'true');
	await expect(nearest).toHaveText('Nearest · 2');
	const badges = editor.locator('.slot[data-role="current"] .badge');
	await expect(badges).toHaveText(['1', '2']);
	await expect(editor.locator('.item.is-linked')).toHaveAttribute('data-item-id', 'e2e-frame');

	// Told the disc, it reads the disc from where it is.
	await reads.getByRole('button', { name: 'Read chart 1' }).click();
	await expect.poll(() => shownLines(text)).toEqual(['Field 180°']);
	await expect(reads.getByRole('button', { name: 'Read chart 1' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(editor.locator('.item.is-linked')).toHaveAttribute('data-item-id', 'e2e-disc');
	await expect.poll(async () => (await savedTexts(page))[0].chartId).toBe('e2e-disc');

	// And the nearest again.
	await reads.getByRole('button', { name: /^Read the nearest chart/ }).click();
	await expect.poll(() => shownLines(text)).toEqual(['Field 40°']);
	await expect.poll(async () => 'chartId' in (await savedTexts(page))[0]).toBe(false);

	// The focus elsewhere, the numbers go.
	await editor.getByRole('group', { name: /^Page 1, A4 portrait/ }).focus();
	await expect(badges).toHaveCount(0);
});

test('a text is turned by quarters from its toolbar and R, and by its knob, to a right angle with Shift', async ({
	page
}) => {
	const short = { ...CAPTION, text: 'Key: {lat}, {lst}', frame: { x: 60, y: 200, w: 90, h: 6 } };
	const editor = await seedAndOpen(page, [short]);
	const text = editor.getByRole('button', { name: /^Text 1 of 1:/ });
	const saved = async () => (await savedTexts(page))[0];
	await text.click();

	// A quarter clockwise: it stands on its side, taller than wide on the screen.
	await editor.getByRole('button', { name: 'Turn a quarter clockwise' }).click();
	await expect.poll(async () => (await saved()).rotation).toBe(90);
	const side = await settledBox(text);
	expect(side.height).toBeGreaterThan(side.width * 5);
	// Its own frame is as it was: the turn is about its centre.
	expect((await saved()).frame.x).toBeCloseTo(60, 6);
	expect((await saved()).frame.y).toBeCloseTo(200, 1);
	expect((await saved()).frame.w).toBe(90);

	// R goes on by quarters, Shift+R back; upright carries no turn at all.
	await expect(text).toBeFocused();
	await page.keyboard.press('r');
	await expect.poll(async () => (await saved()).rotation).toBe(180);
	await page.keyboard.press('Shift+R');
	await page.keyboard.press('Shift+R');
	await expect.poll(async () => 'rotation' in (await saved())).toBe(false);

	// The knob over it: dragged round its centre the text follows, and the angle is read out.
	const box = await settledBox(text);
	const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const knob = { x: centre.x, y: box.y - 15 };
	await page.mouse.move(knob.x, knob.y);
	await page.mouse.down();
	// To 30° past the top: a bearing of −60° from the centre.
	const reach = 120;
	const at = (degrees: number) => ({
		x: centre.x + reach * Math.cos((degrees * Math.PI) / 180),
		y: centre.y + reach * Math.sin((degrees * Math.PI) / 180)
	});
	await page.mouse.move(at(-60).x, at(-60).y, { steps: 10 });
	await expect(editor.locator('.readout')).toHaveText(/^(29|30|31)°$/);
	await page.mouse.up();
	await expect
		.poll(async () => Math.round((await saved()).rotation ?? 0))
		.toBeGreaterThanOrEqual(29);
	expect(Math.round((await saved()).rotation!)).toBeLessThanOrEqual(31);

	// With Shift held it goes to the nearest right angle: from 30° towards 80°, to 90°.
	const turned = await settledBox(text);
	const middle = { x: turned.x + turned.width / 2, y: turned.y + turned.height / 2 };
	const stalk = (degrees: number, far: number) => ({
		x: middle.x + far * Math.cos((degrees * Math.PI) / 180),
		y: middle.y + far * Math.sin((degrees * Math.PI) / 180)
	});
	// The knob is up the text's own top, which now points to −60° on the screen.
	const scale =
		(await editor.locator('.slot[data-role="current"] [data-paper]').boundingBox())!.width / 210;
	const grip = stalk(-60, ((await saved()).frame.h * scale) / 2 + 15);
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	await page.keyboard.down('Shift');
	await page.mouse.move(stalk(-10, 120).x, stalk(-10, 120).y, { steps: 10 });
	await expect(editor.locator('.readout')).toHaveText('90°');
	await page.mouse.up();
	await page.keyboard.up('Shift');
	await expect.poll(async () => (await saved()).rotation).toBe(90);

	// The PDF is told the turn, and the lines as they are before it.
	interface TurnedBody {
		rotation_deg: number;
		cx_mm: number;
		cy_mm: number;
		lines: { x_mm: number; y_mm: number; text: string }[];
	}
	await page.keyboard.press('Escape');
	await expect(editor).toBeHidden();
	let body: { pages: { texts: TurnedBody[] }[] } | null = null;
	await page.route('**/api/export/document', async (route) => {
		body = route.request().postDataJSON();
		await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF\n' });
	});
	await page.getByRole('button', { name: 'Choose export format' }).click();
	const download = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'PDF document' }).click();
	await download;
	const sent = body!.pages[0].texts[0];
	const frame = (await saved()).frame;
	expect(sent.rotation_deg).toBe(90);
	expect(sent.cx_mm).toBeCloseTo(frame.x + frame.w / 2, 3);
	expect(sent.cy_mm).toBeCloseTo(frame.y + frame.h / 2, 3);
	expect(sent.lines).toHaveLength(1);
	expect(sent.lines[0].x_mm).toBeCloseTo(frame.x, 3);
	expect(sent.lines[0].text).toMatch(/^Key: \d+° [NS], \d+h \d\dm$/);
});

test('a chart and a text are copied, cut and pasted with the keys; copied words paste as a text', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const editor = await seedAndOpen(page, [CAPTION]);
	const charts = async () => (await savedPages(page)).map((p) => chartsOf(p).map((it) => it.id));

	// A text: copied and pasted on its own page it goes under the first.
	const text = editor.getByRole('button', { name: /^Text 1 of/ });
	await text.click();
	await page.keyboard.press('ControlOrMeta+c');
	await page.keyboard.press('ControlOrMeta+v');
	await expect.poll(async () => (await savedTexts(page)).length).toBe(2);
	const [first, copy] = await savedTexts(page);
	expect(copy.text).toBe(CAPTION.text);
	expect(copy.id).not.toBe(first.id);
	// In the nearest free place: under the first, a gutter clear, the same width.
	expect(copy.frame.x).toBe(first.frame.x);
	expect(copy.frame.w).toBe(first.frame.w);
	expect(copy.frame.y - first.frame.y).toBeCloseTo(first.frame.h + 6, 2);
	await expect(page.getByRole('status').filter({ hasText: 'Text pasted' })).toBeVisible();
	// The copy has the focus: Delete takes it, not the original.
	await expect(editor.getByRole('button', { name: /^Text 2 of 2/ })).toBeFocused();

	// The toast's Undo takes the paste back.
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(async () => (await savedTexts(page)).map((t) => t.id)).toEqual(['e2e-text']);

	// A chart: cut from page 1 and pasted on page 2, where its place is free.
	await editor.getByRole('button', { name: /^Chart 1 of 1/ }).click();
	await page.keyboard.press('ControlOrMeta+x');
	await expect.poll(charts).toEqual([[], []]);
	await editor.getByRole('button', { name: 'Go to page 2, no charts' }).click();
	await editor.getByRole('group', { name: 'Page 2, A4 portrait, no charts' }).focus();
	await page.keyboard.press('ControlOrMeta+v');
	await expect.poll(async () => (await charts())[1].length).toBe(1);
	const [, second] = await savedPages(page);
	expect(chartsOf(second)[0].frame).toEqual({ x: 42, y: 30, w: 126, h: 126 });
	await expect(editor.getByRole('button', { name: /^Chart 1 of 1/ })).toBeFocused();
	// Pasted again: a second disc of that size has no room on the page (3 mm short), and
	// the pointer is not over it, so the copy keeps its size and stands a little off the first.
	await page.keyboard.press('ControlOrMeta+v');
	await expect.poll(async () => (await charts())[1].length).toBe(2);
	const again = chartsOf((await savedPages(page))[1])[1];
	expect(again.frame).toEqual({ x: 47, y: 35, w: 126, h: 126 });

	// With the pointer over the page, the next goes over the others with its middle under it.
	const paper = (await editor.getByRole('group', { name: /^Page 2, A4 portrait/ }).boundingBox())!;
	const mm = paper.width / 210;
	await page.mouse.move(paper.x + 105 * mm, paper.y + 100 * mm);
	await page.keyboard.press('ControlOrMeta+v');
	await expect.poll(async () => (await charts())[1].length).toBe(3);
	const third = chartsOf((await savedPages(page))[1])[2];
	expect(third.frame.w).toBe(126);
	expect(third.frame.x).toBeCloseTo(42, 0);
	expect(third.frame.y).toBeCloseTo(37, 0);

	// Words from anywhere else: a new text, in the topmost free place.
	await page.evaluate(() => navigator.clipboard.writeText('Find the zenith.\nName ten stars.'));
	await page.keyboard.press('ControlOrMeta+v');
	await expect.poll(async () => (await savedTexts(page, 1)).length).toBe(1);
	const [words] = await savedTexts(page, 1);
	expect(words.text).toBe('Find the zenith.\nName ten stars.');
	expect(words.frame.y).toBe(12);
	expect(words.frame.h).toBeCloseTo(2 * 12 * MM_PER_PT * 1.35, 2);

	// In a text being typed, the keys are the field's own: words go into it.
	await page.keyboard.press('Enter');
	const field = editor.getByRole('textbox', { name: 'Text 1' });
	await expect(field).toBeFocused();
	await page.keyboard.press('ControlOrMeta+v');
	await expect(field).toHaveValue('Find the zenith.\nName ten stars.');
	await page.keyboard.press('Escape');
	await expect.poll(async () => (await savedTexts(page, 1)).length).toBe(1);
});
