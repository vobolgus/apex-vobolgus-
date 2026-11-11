import { expect, test, type Locator, type Page } from '@playwright/test';
import { contentBox, gridLines } from '../src/lib/document/geometry';
import {
	chartsOf,
	savedPages as savedDocumentPages,
	seedFirstShape,
	type SavedChart
} from './saved-document';

/**
 * The page editor, opened from the pages panel: a chart dragged near a grid line
 * snaps onto it, a chart dragged onto the next page moves there, one on a
 * neighbouring page can be dragged onto the current one, one let go off every
 * page goes back, and Escape closes the editor.
 */

const STEREO = {
	view: {
		projection: 'stereographic',
		orientation: { x: 0, y: 0, z: 0, w: 1 },
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

/**
 * Two portrait pages: two discs on the first, none on the second. In the shape the
 * document was first saved in (`items`, no `blocks`, under the first key): every test
 * here begins with the app bringing it over.
 */
const DOCUMENT = {
	pages: [
		{
			id: 'e2e-page-1',
			orientation: 'portrait',
			items: [
				{ id: 'e2e-a', chart: STEREO, frame: { x: 12, y: 12, w: 60, h: 60 } },
				{ id: 'e2e-b', chart: STEREO, frame: { x: 12, y: 120, w: 80, h: 80 } }
			]
		},
		{ id: 'e2e-page-2', orientation: 'portrait', items: [] }
	]
};

type SavedItem = SavedChart;

async function seedAndOpen(page: Page) {
	await seedFirstShape(page, DOCUMENT);
	await page.getByRole('button', { name: 'Page 1, 2 charts' }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await expect(editor).toBeVisible();
	return editor;
}

/** The saved charts of each page (saves are debounced: poll this). */
async function savedPages(page: Page): Promise<SavedItem[][]> {
	return (await savedDocumentPages(page)).map(chartsOf);
}

async function savedFrame(page: Page, id: string) {
	return (await savedPages(page)).flat().find((item) => item.id === id)?.frame;
}

/** Press at `from`, move to `to` in steps (pointer events, coalesced per frame), release. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
}

/** The element's box once it has stopped moving: the pages slide when the current one changes. */
async function settledBox(locator: Locator) {
	let last = await locator.boundingBox();
	for (let i = 0; i < 40; i += 1) {
		await locator.page().waitForTimeout(50);
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

function onLine(value: number, lines: number[]) {
	return lines.some((line) => Math.abs(line - value) < 1e-3);
}

/** A frame's start or end on a grid edge line, or its centre on a centre line, along `axis`. */
function onGrid(frame: SavedItem['frame'], axis: 'x' | 'y') {
	const { edges, centres } = gridLines('portrait', axis);
	const start = axis === 'x' ? frame.x : frame.y;
	const size = axis === 'x' ? frame.w : frame.h;
	return onLine(start, edges) || onLine(start + size, edges) || onLine(start + size / 2, centres);
}

test('a dragged chart snaps to a grid line', async ({ page }) => {
	const editor = await seedAndOpen(page);
	const paper = editor.getByRole('group', { name: 'Page 1, A4 portrait, 2 charts' });
	const scale = (await paper.boundingBox())!.width / 210;

	// Its left edge to 1.5 px past x = 108 mm, the start of the second of two columns.
	const chart = editor.getByRole('button', { name: /^Chart 1 of 2,/ });
	const from = centre((await chart.boundingBox())!);
	await drag(page, from, { x: from.x + (108 - 12) * scale + 1.5, y: from.y + 3 });

	await expect.poll(async () => (await savedFrame(page, 'e2e-a'))?.x).toBeCloseTo(108, 3);
	const frame = (await savedFrame(page, 'e2e-a'))!;
	expect(onGrid(frame, 'x')).toBe(true);
	// Its top snaps as well: to the margin, or its centre to a cell's centre.
	expect(onGrid(frame, 'y')).toBe(true);
	expect(frame.w).toBeCloseTo(60, 6);
});

test('a chart dragged onto the next page moves there, Escape closes', async ({ page }) => {
	const editor = await seedAndOpen(page);
	const chart = editor.getByRole('button', { name: /^Chart 2 of 2,/ });
	const next = editor.getByRole('button', { name: 'Show page 2, no charts' });
	await drag(page, centre((await chart.boundingBox())!), centre((await next.boundingBox())!));

	await expect
		.poll(async () => (await savedPages(page)).map((items) => items.map((it) => it.id)))
		.toEqual([['e2e-a'], ['e2e-b']]);
	const frame = (await savedFrame(page, 'e2e-b'))!;
	const box = contentBox('portrait');
	expect(frame.x).toBeGreaterThanOrEqual(box.x - 1e-6);
	expect(frame.y).toBeGreaterThanOrEqual(box.y - 1e-6);
	expect(frame.x + frame.w).toBeLessThanOrEqual(box.x + box.w + 1e-6);
	expect(frame.y + frame.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
	expect(frame.w).toBeCloseTo(80, 6);
	await expect(editor.getByRole('button', { name: 'Show page 2, 1 chart' })).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(editor).toBeHidden();
});

test('a chart on a neighbouring page can be dragged onto the current one', async ({ page }) => {
	const editor = await seedAndOpen(page);
	await editor.getByRole('button', { name: 'Show page 2, no charts' }).click();
	const current = editor.getByRole('group', { name: 'Page 2, A4 portrait, no charts' });
	await expect(current).toBeVisible();

	// Page 1 is now the neighbour on the left; its charts are pictures, not buttons.
	const side = editor.locator('.slot[data-role="prev"] [data-item-id="e2e-a"] .chart');
	await drag(page, centre(await settledBox(side)), centre(await settledBox(current)));

	await expect
		.poll(async () => (await savedPages(page)).map((items) => items.map((it) => it.id)))
		.toEqual([['e2e-b'], ['e2e-a']]);
	// The drop keeps page 2 current (the release's click does not turn to page 1) and selects the chart.
	await expect(editor.getByRole('group', { name: 'Page 2, A4 portrait, 1 chart' })).toBeVisible();
	await expect(editor.getByRole('button', { name: /^Chart 1 of 1,/ })).toBeFocused();
});

test('a chart dragged from a neighbouring page is in sight over the current one all the way', async ({
	page
}, testInfo) => {
	const editor = await seedAndOpen(page);
	await editor.getByRole('button', { name: 'Show page 2, no charts' }).click();
	const current = editor.getByRole('group', { name: 'Page 2, A4 portrait, no charts' });
	await expect(current).toBeVisible();
	const item = editor.locator('.slot[data-role="prev"] [data-item-id="e2e-a"]');
	const from = centre(await settledBox(item.locator('.chart')));
	const over = centre(await settledBox(current));

	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(over.x, over.y, { steps: 12 });
	await page.waitForTimeout(200);
	// Held over the current page, not yet let go: the chart is under the pointer...
	const held = (await item.boundingBox())!;
	expect(Math.abs(centre(held).x - over.x)).toBeLessThan(held.width / 2);
	expect(Math.abs(centre(held).y - over.y)).toBeLessThan(held.height / 2);
	// ...and it is the topmost thing there, not the current page lying over it.
	const topmost = await page.evaluate(({ x, y }) => {
		const hit = document.elementFromPoint(x, y);
		return hit?.closest('[data-item-id]')?.getAttribute('data-item-id') ?? hit?.className ?? null;
	}, over);
	expect(topmost).toBe('e2e-a');
	// At full strength: nothing between it and the eye is translucent, though its page is dimmed.
	const strength = await item.evaluate((el) => {
		let opacity = 1;
		for (let node: Element | null = el; node; node = node.parentElement) {
			opacity *= Number(getComputedStyle(node).opacity);
		}
		const veil = getComputedStyle(el.closest('[data-paper]')!, '::after');
		return {
			opacity,
			veil: Number(veil.opacity),
			veilZ: Number(veil.zIndex),
			z: Number(getComputedStyle(el).zIndex)
		};
	});
	expect(strength.opacity).toBe(1);
	expect(strength.z).toBeGreaterThan(strength.veilZ);
	await page.screenshot({ path: testInfo.outputPath('held-over-current.png') });

	await page.mouse.up();
	await expect
		.poll(async () => (await savedPages(page)).map((items) => items.map((it) => it.id)))
		.toEqual([['e2e-b'], ['e2e-a']]);
});

test('a click on a neighbour’s chart, without a drag, turns to that page', async ({ page }) => {
	const editor = await seedAndOpen(page);
	await editor.getByRole('button', { name: 'Show page 2, no charts' }).click();
	const side = editor.locator('.slot[data-role="prev"] [data-item-id="e2e-a"] .chart');
	await page.mouse.click(...(Object.values(centre(await settledBox(side))) as [number, number]));
	await expect(editor.getByRole('group', { name: 'Page 1, A4 portrait, 2 charts' })).toBeVisible();
	expect((await savedPages(page)).map((items) => items.length)).toEqual([2, 0]);
});

test('opening the editor puts the focus on the editor, not on its close button', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	await expect(editor).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(editor.getByRole('button', { name: 'Close' })).toBeFocused();
});

test('a chart let go off every page goes back where it was', async ({ page }) => {
	const editor = await seedAndOpen(page);
	const chart = editor.getByRole('button', { name: /^Chart 1 of 2,/ });
	const from = centre((await chart.boundingBox())!);
	const viewport = page.viewportSize()!;
	await drag(page, from, { x: from.x, y: viewport.height - 4 });

	// Give a save the time it would take, then check nothing moved.
	await page.waitForTimeout(400);
	expect(await savedFrame(page, 'e2e-a')).toEqual({ x: 12, y: 12, w: 60, h: 60 });
	await expect(editor).toBeVisible();
});

test('a chart in the hand follows the pointer off the paper, and is brought onto the page when let go', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	const item = editor.locator('.slot[data-role="current"] [data-item-id="e2e-a"]');
	const paper = (await settledBox(editor.locator('.slot[data-role="current"] [data-paper]')))!;
	const from = centre((await item.boundingBox())!);
	// Its centre a little past the page's left edge: off the paper, within reach of it.
	const to = { x: paper.x - 20, y: from.y + 30 };

	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.waitForTimeout(100);
	// Held: it is where the pointer is, half off the paper, not stopped at the margin...
	const held = (await item.boundingBox())!;
	expect(Math.abs(centre(held).x - to.x)).toBeLessThan(1.5);
	expect(Math.abs(centre(held).y - to.y)).toBeLessThan(1.5);
	expect(held.x).toBeLessThan(paper.x);
	// ...with nothing drawn for it on the pages: no guides, no margins, no outline.
	await expect(editor.locator('.guides')).toHaveCount(0);
	// Shift held shows the lines it would snap to, here the margin it will be brought to;
	// let go of, they are gone again. The pointer has not moved.
	await page.keyboard.down('Shift');
	await expect.poll(() => editor.locator('.guides line').count()).toBeGreaterThan(0);
	await expect(editor.locator('.guides .margin')).toHaveCount(0);
	await page.keyboard.up('Shift');
	await expect(editor.locator('.guides')).toHaveCount(0);
	// Its shadow is a box-shadow on a layer of its own, not a filter (which smears in Safari).
	const look = await item.evaluate((el) => ({
		filter: getComputedStyle(el).filter,
		shadow: getComputedStyle(el.querySelector('.chart')!).boxShadow
	}));
	expect(look.filter).toBe('none');
	expect(look.shadow).not.toBe('none');

	await page.mouse.up();
	// Let go, it is on the page at the nearest place it may be: against the left margin.
	const box = contentBox('portrait');
	await expect.poll(async () => (await savedFrame(page, 'e2e-a'))?.x).toBeCloseTo(box.x, 6);
	const rest = await settledBox(item);
	expect(rest.x).toBeGreaterThan(paper.x);
	expect((await savedPages(page)).map((items) => items.map((it) => it.id))).toEqual([
		['e2e-a', 'e2e-b'],
		[]
	]);
});

test('a chart let go just short of another page lands on that page', async ({ page }) => {
	const editor = await seedAndOpen(page);
	const item = editor.locator('.slot[data-role="current"] [data-item-id="e2e-a"]');
	const next = (await settledBox(editor.locator('.slot[data-role="next"] [data-paper]')))!;
	const from = centre((await item.boundingBox())!);
	// Carried across page 2 and out past its far edge, by less than the catch zone.
	await drag(page, from, { x: next.x + next.width + 25, y: next.y + next.height / 2 });

	await expect
		.poll(async () => (await savedPages(page)).map((items) => items.map((it) => it.id)))
		.toEqual([['e2e-b'], ['e2e-a']]);
	const box = contentBox('portrait');
	const frame = (await savedFrame(page, 'e2e-a'))!;
	expect(frame.x + frame.w).toBeCloseTo(box.x + box.w, 6);
	expect(frame.y).toBeGreaterThanOrEqual(box.y);
	expect(frame.y + frame.h).toBeLessThanOrEqual(box.y + box.h);
});

test('an empty page is deleted from the editor, a page with charts is not offered', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	// Page 1 has two charts: no delete on its label. Page 2 is empty: it has one.
	await expect(editor.getByRole('button', { name: 'Delete page 1' })).toHaveCount(0);
	await editor.getByRole('button', { name: 'Delete page 2' }).click();
	await expect.poll(async () => (await savedPages(page)).length).toBe(1);
	await expect(editor.getByRole('group', { name: 'Page 1, A4 portrait, 2 charts' })).toBeVisible();

	// The toast's Undo brings the page back and shows it.
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(async () => (await savedPages(page)).length).toBe(2);
	await expect(editor.getByRole('group', { name: 'Page 2, A4 portrait, no charts' })).toBeVisible();
});

test('the toast clears the strip of mini pages, so a click on a page reaches it', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	await editor.getByRole('button', { name: /^Chart 1 of 2,/ }).focus();
	await page.keyboard.press('Delete');
	const toast = page.locator('.toast').filter({ hasText: 'Chart removed' });
	await expect(toast).toBeVisible();
	const toastBox = (await toast.boundingBox())!;
	const stripBox = (await editor.getByRole('navigation', { name: 'All pages' }).boundingBox())!;
	expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(stripBox.y);

	// The top of a mini page is the mini page's, not the toast's.
	const mini = editor.getByRole('button', { name: 'Go to page 2, no charts' });
	const miniBox = (await mini.boundingBox())!;
	await page.mouse.click(miniBox.x + miniBox.width / 2, miniBox.y + 4);
	await expect(mini).toHaveAttribute('aria-current', 'page');
});

test('on a touch screen a tap near a chart corner selects it: the hidden ⊖ does nothing', async ({
	browser
}) => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true
	});
	const page = await context.newPage();
	try {
		await seedFirstShape(page, DOCUMENT);
		// Collapsed on a phone: open the panel, then the page.
		await page.getByRole('button', { name: /^PDF pages/ }).click();
		await page.getByRole('button', { name: 'Page 1, 2 charts' }).click();
		const editor = page.getByRole('dialog', { name: 'PDF document' });
		await expect(editor).toBeVisible();

		const item = editor.locator('.slot[data-role="current"] [data-item-id="e2e-b"]');
		const box = (await item.boundingBox())!;
		// Where the ⊖ sits once the chart is selected.
		await page.touchscreen.tap(box.x + 30, box.y + 30);
		await expect(editor.getByRole('button', { name: /^Chart 2 of 2,/ })).toBeFocused();
		await page.waitForTimeout(400);
		expect((await savedPages(page)).map((items) => items.map((it) => it.id))).toEqual([
			['e2e-a', 'e2e-b'],
			[]
		]);
		// Selected, its toolbar is there for whoever cannot drag.
		await expect(item.getByRole('button', { name: 'Make chart 2 larger' })).toBeVisible();
	} finally {
		await context.close();
	}
});
