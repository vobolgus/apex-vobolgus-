import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Tables on a page, in the page editor: added from the page's name, a table lists
 * what is on the chart it reads, as on a SkyGen worksheet: a title over the names of
 * the Messier objects or of the bright stars, three to a row. Its toolbar says what
 * it lists, in how many rows, and whether with details; nothing in it is typed; it
 * goes on reading its chart from another page; and it goes to the backend a line a
 * cell.
 */

const STORAGE_KEY = 'skycharts.document.v1';
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

/** A disc in the lower part of the first page, room over it; an empty second page. */
const DOCUMENT = {
	pages: [
		{
			id: 'e2e-page-1',
			orientation: 'portrait',
			items: [{ id: 'e2e-a', chart: STEREO, frame: { x: 30, y: 90, w: 150, h: 150 } }]
		},
		{ id: 'e2e-page-2', orientation: 'portrait', items: [] }
	]
};

interface SavedText {
	id: string;
	text: string;
	table?: { source: string; look?: string; rows: number };
	chartId?: string;
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
	await page.getByRole('button', { name: /^Page 1,/ }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await expect(editor).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	return editor;
}

async function savedTexts(page: Page, at = 0): Promise<SavedText[]> {
	return page.evaluate(
		([key, index]) => {
			const raw = localStorage.getItem(key as string);
			return raw ? (JSON.parse(raw).pages[index as number]?.texts ?? []) : [];
		},
		[STORAGE_KEY, at] as const
	);
}

/** What a block shows, cell by cell. */
function cells(block: Locator) {
	return block.locator('xpath=..').locator('svg text').allTextContents();
}

const LINE_MM = 12 * MM_PER_PT * 1.35;

test('a table is a title over the names of what is on its chart, three to a row; two stand side by side', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	const add = editor.getByRole('button', { name: 'Add a table to page 1' });
	await add.click();

	// The names of the Messier objects on this sky, brightest first, under a title in bold.
	const messier = editor.getByRole('button', {
		name: 'Table 1 of 1: Messier objects, names, 5 rows'
	});
	await expect(messier).toBeFocused();
	await expect.poll(async () => (await cells(messier)).length).toBe(1 + 5 * 3);
	const shown = await cells(messier);
	expect(shown[0]).toBe('Messier objects');
	expect(shown.slice(1, 4)).toEqual(['M 45', 'M 44', 'M 31']);
	expect(shown.slice(1).every((name) => /^M \d+$/.test(name))).toBe(true);
	// No rules: a list of what to find, not a table of figures.
	await expect(messier.locator('xpath=..').locator('svg line')).toHaveCount(0);

	// At the top left, as wide as its names, six lines tall.
	await expect.poll(async () => (await savedTexts(page)).length).toBe(1);
	const [first] = await savedTexts(page);
	expect(first.text).toBe('');
	expect(first.table).toEqual({ source: 'messier', look: 'names', rows: 5 });
	expect(first.frame).toMatchObject({ x: 12, y: 12 });
	expect(first.frame.w).toBeGreaterThan(30);
	expect(first.frame.w).toBeLessThan(70);
	await expect.poll(async () => (await savedTexts(page))[0].frame.h).toBeCloseTo(6 * LINE_MM, 1);

	// Nothing in it is typed: Enter and a double click open no field.
	await page.keyboard.press('Enter');
	await messier.dblclick();
	await expect(editor.getByRole('textbox')).toHaveCount(0);

	// A second goes beside it, at the right margin; told to list stars, it names the bright ones.
	await add.click();
	const tools = editor.getByRole('group', { name: 'Text 2', exact: true });
	await tools.getByRole('button', { name: 'Stars', exact: true }).click();
	const stars = editor.getByRole('button', { name: 'Table 2 of 2: Stars, names, 5 rows' });
	await expect(stars).toBeFocused();
	await expect
		.poll(async () => (await cells(stars)).slice(0, 4))
		.toEqual(['Stars', 'Sirius', 'Arcturus', 'Capella']);
	await expect.poll(async () => (await savedTexts(page))[1]?.table?.source).toBe('stars');
	const [, second] = await savedTexts(page);
	expect(second.frame.y).toBe(12);
	expect(second.frame.x).toBeGreaterThan(first.frame.x + first.frame.w);
	expect(second.frame.x + second.frame.w).toBeCloseTo(198, 3);

	// Fewer rows, a larger size; and it is removed and brought back as a text is.
	await tools.getByRole('button', { name: 'Fewer rows' }).click();
	await tools.getByRole('button', { name: 'Fewer rows' }).click();
	const fewer = editor.getByRole('button', { name: 'Table 2 of 2: Stars, names, 3 rows' });
	await expect.poll(async () => (await cells(fewer)).length).toBe(1 + 3 * 3);
	await expect.poll(async () => (await savedTexts(page))[1].frame.h).toBeCloseTo(4 * LINE_MM, 1);
	await expect(tools.getByRole('button', { name: 'Bold' })).toHaveCount(0);
	await page.keyboard.press('Delete');
	await expect.poll(async () => (await savedTexts(page)).length).toBe(1);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(fewer).toBeFocused();
});

test('with details a table is a row an object under a ruled header; moved to a page of its own it keeps its sky', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	await editor.getByRole('button', { name: 'Add a table to page 1' }).click();
	const tools = editor.getByRole('group', { name: 'Text 1', exact: true });
	await expect(tools.getByRole('button', { name: 'Names' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await tools.getByRole('button', { name: 'Details' }).click();

	const table = editor.getByRole('button', {
		name: 'Table 1 of 1: Messier objects, details, 5 rows'
	});
	await expect(table).toBeFocused();
	await expect
		.poll(async () => (await cells(table)).slice(0, 11))
		.toEqual([
			'Messier objects',
			'Object',
			'Name',
			'Type',
			'Constellation',
			'Mag',
			'M 45',
			'Pleiades',
			'Open Cluster',
			'Taurus',
			'1.6'
		]);
	await expect(table.locator('xpath=..').locator('svg line')).toHaveCount(3);
	// It is wider for it: as wide as its columns like to be.
	await expect.poll(async () => (await savedTexts(page))[0]?.frame.w ?? 0).toBeGreaterThan(110);
	await expect
		.poll(async () => (await savedTexts(page))[0].frame.h)
		.toBeCloseTo((7 + 0.9) * LINE_MM, 1);

	// The stars with details: their names, their places, their magnitudes.
	await tools.getByRole('button', { name: 'Stars', exact: true }).click();
	const stars = editor.getByRole('button', { name: 'Table 1 of 1: Stars, details, 5 rows' });
	await expect
		.poll(async () => (await cells(stars)).slice(1, 11))
		.toEqual(['№', 'Name', 'RA', 'Dec', 'Mag', '1', 'Sirius', '6h 45.1m', '−16° 43′', '−1.4']);
	const listed = await cells(stars);

	// With one chart on the page and none elsewhere there is nothing to choose it from.
	await expect(editor.getByRole('group', { name: 'The chart the fields read' })).toHaveCount(0);

	// To the next page, which has no chart: it lists the same sky, read from the first page.
	await page.keyboard.press('PageDown');
	const moved = editor.getByRole('button', { name: 'Table 1 of 1: Stars, details, 5 rows' });
	await expect(moved).toBeFocused();
	await expect(editor.getByRole('group', { name: /^Page 2, A4 portrait/ })).toBeVisible();
	await expect.poll(() => cells(moved)).toEqual(listed);
	await expect.poll(async () => (await savedTexts(page, 1))[0]?.chartId).toBe('e2e-a');
	expect(await savedTexts(page, 0)).toEqual([]);

	// And says so: the chart of the other page is the one chosen in its toolbar.
	const reads = editor.getByRole('group', { name: 'The chart the fields read' });
	const other = reads.getByRole('combobox', { name: 'Read a chart on another page' });
	await expect(other).toHaveValue('e2e-a');
	await expect(other.locator('option:checked')).toHaveText('Page 1 · chart 1');
	// Told the nearest again, it has no chart on its own page to read.
	await reads.getByRole('button', { name: /^Read the nearest chart/ }).click();
	await expect.poll(async () => (await cells(moved)).at(-1)).toBe('No chart to read');
	// And the other page's chart again, from the list.
	await other.selectOption('e2e-a');
	await expect.poll(() => cells(moved)).toEqual(listed);
	await expect(moved).toBeFocused();
});

test('a table goes to the backend a line a cell: a title and names, or a ruled header and rows', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	const add = editor.getByRole('button', { name: 'Add a table to page 1' });
	await add.click();
	const names = editor.getByRole('button', { name: /^Table 1 of \d: Messier objects, names/ });
	await expect.poll(async () => (await cells(names)).length).toBe(16);
	await add.click();
	await editor
		.getByRole('group', { name: 'Text 2', exact: true })
		.getByRole('button', { name: 'Details' })
		.click();
	const details = editor.getByRole('button', { name: /^Table 2 of 2: Messier objects, details/ });
	await expect.poll(async () => (await cells(details)).length).toBeGreaterThan(20);
	const shownNames = await cells(names);
	const shownDetails = await cells(details);
	await page.keyboard.press('Escape');
	await expect(editor).toBeHidden();

	interface TextBody {
		bold: boolean;
		anchor: string;
		lines: { x_mm: number; y_mm: number; text: string; anchor?: string; bold?: boolean }[];
		rules?: { x1_mm: number; y1_mm: number; x2_mm: number; y2_mm: number; width_mm: number }[];
	}
	let body: { pages: { texts: TextBody[] }[] } | null = null;
	await page.route('**/api/export/document', async (route) => {
		body = route.request().postDataJSON();
		await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF\n' });
	});
	await page.getByRole('button', { name: 'Choose export format' }).click();
	const download = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'PDF document' }).click();
	await download;

	const [list, table] = body!.pages[0].texts;
	// The very cells the editor drew. The title is bold, in the middle; the names each in the
	// middle of one of three columns; no rules.
	expect(list.lines.map((line) => line.text)).toEqual(shownNames);
	expect(list.lines[0]).toMatchObject({ bold: true, anchor: 'middle' });
	expect(
		list.lines.slice(1).every((line) => line.anchor === 'middle' && line.bold === undefined)
	).toBe(true);
	expect(new Set(list.lines.slice(1).map((line) => line.x_mm.toFixed(3))).size).toBe(3);
	expect(list).not.toHaveProperty('rules');

	expect(table.lines.map((line) => line.text)).toEqual(shownDetails);
	expect(table.lines.slice(0, 6).every((line) => line.bold === true)).toBe(true);
	expect(table.lines.slice(6).every((line) => line.bold === undefined)).toBe(true);
	// Three rules across it: over its header, under it, and under its last row.
	expect(table.rules).toHaveLength(3);
	const [left, right] = [table.rules![0].x1_mm, table.rules![0].x2_mm];
	expect(table.rules!.every((rule) => rule.x1_mm === left && rule.x2_mm === right)).toBe(true);
	expect(table.rules![0].y1_mm).toBeGreaterThan(table.lines[0].y_mm);
	expect(table.rules![0].y1_mm).toBeLessThan(table.lines[1].y_mm);
	expect(table.rules![1].y1_mm).toBeLessThan(table.lines[6].y_mm);
	expect(table.rules![2].y1_mm).toBeGreaterThan(table.lines.at(-1)!.y_mm);
	// The magnitudes end at the table's right edge.
	const magnitudes = table.lines.filter((line) => line.anchor === 'end');
	expect(magnitudes.length).toBeGreaterThan(1);
	expect(magnitudes.every((line) => Math.abs(line.x_mm - right) < 1e-6)).toBe(true);
});

test('made narrower, a table gives way inside its frame; the lines it snaps to show only with Shift', async ({
	page
}) => {
	const editor = await seedAndOpen(page);
	await editor.getByRole('button', { name: 'Add a table to page 1' }).click();
	const table = editor.getByRole('button', { name: /^Table 1 of 1/ });
	await expect.poll(async () => (await cells(table)).length).toBe(16);
	await expect.poll(async () => (await savedTexts(page)).length).toBe(1);
	const liked = (await savedTexts(page))[0].frame.w;
	const whole = await cells(table);

	const paper = (await editor.getByRole('group', { name: /^Page 1, A4 portrait/ }).boundingBox())!;
	const mm = paper.width / 210;
	const guides = editor.locator('.slot[data-role="current"] .guides');
	const box = (await table.boundingBox())!;
	const handle = { x: box.x + box.width + 3, y: box.y + box.height / 2 };

	// Its right side to 25 mm: nothing is drawn on the page for it, and every name is still
	// inside the table, cut short where it must be.
	await page.mouse.move(handle.x, handle.y);
	await page.mouse.down();
	await page.mouse.move(box.x + 25 * mm, handle.y + 4, { steps: 10 });
	await expect(guides).toHaveCount(0);
	await expect.poll(async () => (await cells(table)).some((name) => name.endsWith('…'))).toBe(true);
	const frame = (await table.boundingBox())!;
	const names = table.locator('xpath=..').locator('svg text');
	for (const cell of await names.all()) {
		const at = (await cell.boundingBox())!;
		expect(at.x).toBeGreaterThanOrEqual(frame.x - 1);
		expect(at.x + at.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
	}

	// Far past its left side: it stops at the least width that holds all of it.
	await page.mouse.move(box.x - 60 * mm, handle.y + 4, { steps: 10 });
	const least = (await table.boundingBox())!;
	expect(least.width / mm).toBeGreaterThan(20);
	expect(least.width / mm).toBeLessThan(liked);

	// With Shift held the line it would snap to is there; let go, it is gone again.
	await page.keyboard.down('Shift');
	await page.mouse.move(box.x + 90.5 * mm, handle.y + 4, { steps: 10 });
	await expect(guides.locator('line')).not.toHaveCount(0);
	await expect(guides.locator('.margin')).toHaveCount(0);
	await page.keyboard.up('Shift');
	await expect(guides).toHaveCount(0);
	await page.mouse.up();

	// Wide again, its names are whole.
	await expect.poll(async () => (await savedTexts(page))[0].frame.w).toBeGreaterThan(liked);
	expect(await cells(table)).toEqual(whole);
});
