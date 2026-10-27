import { expect, test, type Page } from '@playwright/test';
import { contentBox, gridLines } from '../src/lib/document/geometry';

/**
 * The page editor, opened from the pages panel: a chart dragged near a grid line
 * snaps onto it, a chart dragged onto the next page moves there, one let go off
 * every page goes back, and Escape closes the editor.
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
	const next = editor.getByRole('button', { name: 'Show page 2, 0 charts' });
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
