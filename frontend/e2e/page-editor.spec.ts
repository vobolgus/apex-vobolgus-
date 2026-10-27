import { expect, test, type Locator, type Page } from '@playwright/test';
import { contentBox, gridLines } from '../src/lib/document/geometry';

/**
 * The page editor, opened from the pages panel: a chart dragged near a grid line
 * snaps onto it, a chart dragged onto the next page moves there, one on a
 * neighbouring page can be dragged onto the current one, one let go off every
 * page goes back, and Escape closes the editor.
 */

const STORAGE_KEY = 'skycharts.document.v1';

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

/** Two portrait pages: two discs on the first, none on the second. */
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

interface SavedItem {
	id: string;
	frame: { x: number; y: number; w: number; h: number };
}

async function seedAndOpen(page: Page) {
	await page.goto('/');
	await page.evaluate(([key, doc]) => localStorage.setItem(key as string, JSON.stringify(doc)), [
		STORAGE_KEY,
		DOCUMENT
	] as const);
	await page.reload();
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
	await page.getByRole('button', { name: 'Page 1, 2 charts' }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await expect(editor).toBeVisible();
	return editor;
}

/** The saved charts of each page (saves are debounced: poll this). */
async function savedPages(page: Page): Promise<SavedItem[][]> {
	return page.evaluate((key) => {
		const raw = localStorage.getItem(key);
		const doc = raw ? JSON.parse(raw) : { pages: [] };
		return doc.pages.map((p: { items: SavedItem[] }) => p.items);
	}, STORAGE_KEY);
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
		await page.goto('/');
		await page.evaluate(([key, doc]) => localStorage.setItem(key as string, JSON.stringify(doc)), [
			STORAGE_KEY,
			DOCUMENT
		] as const);
		await page.reload();
		await page.waitForSelector('canvas');
		await page.waitForLoadState('networkidle').catch(() => undefined);
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
