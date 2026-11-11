import { expect, test, type Page } from '@playwright/test';

/**
 * Page templates: the button on a page's thumbnail (across from its ⊖) and by its
 * name in the editor opens the picker, whose tiles show what each template makes of
 * that page; a click lays the page out, on more pages when its charts need them, and
 * the toast's Undo puts everything back.
 */

const STORAGE_KEY = 'skycharts.document.v1';

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

const PINHOLE = {
	...STEREO,
	view: { ...STEREO.view, projection: 'pinhole', pinholeFovDeg: 40 },
	aspect: 1.6
};

/** A frame and a disc on the first page (the frame first), a lone disc on the second, an empty third. */
const DOCUMENT = {
	pages: [
		{
			id: 'e2e-page-1',
			orientation: 'portrait',
			items: [
				{ id: 'e2e-frame', chart: PINHOLE, frame: { x: 12, y: 12, w: 90, h: 56.25 } },
				{ id: 'e2e-disc', chart: STEREO, frame: { x: 108, y: 12, w: 90, h: 90 } }
			]
		},
		{
			id: 'e2e-page-2',
			orientation: 'portrait',
			items: [{ id: 'e2e-lone', chart: STEREO, frame: { x: 12, y: 55.5, w: 186, h: 186 } }]
		},
		{ id: 'e2e-page-3', orientation: 'portrait', items: [] }
	]
};

interface SavedPage {
	id: string;
	orientation: string;
	manual?: boolean;
	items: { id: string; frame: { x: number; y: number; w: number; h: number } }[];
	texts?: { role?: string; text: string; chartId?: string; rotation?: number }[];
}

async function seed(page: Page) {
	await page.goto('/');
	await page.evaluate(([key, doc]) => localStorage.setItem(key as string, JSON.stringify(doc)), [
		STORAGE_KEY,
		DOCUMENT
	] as const);
	await page.reload();
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function savedPages(page: Page): Promise<SavedPage[]> {
	return page.evaluate((key) => {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw).pages : [];
	}, STORAGE_KEY);
}

const roles = (saved: SavedPage) => (saved.texts ?? []).map((text) => text.role);

test('a page is laid out as a template from its thumbnail, and Undo puts it back', async ({
	page
}) => {
	await seed(page);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });

	// The button is across from the ⊖, on pages with charts only.
	await panel.getByRole('button', { name: 'Page 1, 2 charts' }).hover();
	const open = panel.getByRole('button', { name: 'Lay page 1 out as a template' });
	await expect(open).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Lay page 3 out as a template' })).toHaveCount(0);
	const remove = (await panel.getByRole('button', { name: 'Delete page 1' }).boundingBox())!;
	const across = (await open.boundingBox())!;
	expect(across.x).toBeGreaterThan(remove.x + 60);
	// (The thumbnail is still growing under the pointer: level to within its lift.)
	expect(Math.abs(across.y - remove.y)).toBeLessThan(6);

	await open.click();
	const picker = page.getByRole('dialog', { name: 'Lay page 1 out as' });
	await expect(picker).toBeVisible();
	// Beside the panel, in the window.
	const box = (await picker.boundingBox())!;
	expect(box.x).toBeGreaterThan((await panel.boundingBox())!.x + 100);
	expect(box.y).toBeGreaterThanOrEqual(0);

	// Every template is offered with what it makes of this page: its two charts on each tile.
	const tiles = picker.getByRole('listitem');
	await expect(tiles).toHaveCount(5);
	await expect(picker.getByRole('button', { name: 'Charts only: No text' })).toBeEnabled();
	await expect(
		picker.getByRole('button', { name: 'With a caption: One to a page · 2 pages' })
	).toBeEnabled();
	await expect(
		picker.getByRole('button', { name: 'Worksheet: Tasks, and a key · 2 pages' })
	).toBeEnabled();
	const pair = picker.getByRole('button', { name: 'Two skies: Side by side' });
	await expect(pair.locator('[data-item-id="e2e-disc"]')).toHaveCount(1);
	await expect(pair.locator('[data-item-id="e2e-frame"]')).toHaveCount(1);

	// Two skies: both charts under a title, each with a caption that reads it.
	await pair.click();
	await expect(picker).toHaveCount(0);
	await expect
		.poll(async () => roles((await savedPages(page))[0]))
		.toEqual(['title', 'caption', 'caption']);
	const [laid] = await savedPages(page);
	expect(laid.items.map((item) => item.id)).toEqual(['e2e-frame', 'e2e-disc']);
	expect(laid.items[1].frame.y).toBeGreaterThan(laid.items[0].frame.y + laid.items[0].frame.h);
	expect(laid.items[1].frame.w).toBeGreaterThan(90);
	expect(laid.texts!.map((text) => text.chartId)).toEqual([undefined, 'e2e-frame', 'e2e-disc']);
	expect(laid.manual).toBe(true);
	expect((await savedPages(page)).length).toBe(3);

	const toast = page.getByRole('status').filter({ hasText: 'Page 1 laid out as “Two skies”' });
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(async () => (await savedPages(page))[0]).toEqual(DOCUMENT.pages[0]);
});

test("charts past a template's places go on new pages; swapping and turning redraw the tiles", async ({
	page
}) => {
	await seed(page);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	await panel.getByRole('button', { name: 'Page 1, 2 charts' }).hover();
	await panel.getByRole('button', { name: 'Lay page 1 out as a template' }).click();
	const picker = page.getByRole('dialog', { name: 'Lay page 1 out as' });

	// Swapped, the charts go in the other order: the disc over the frame on the tile of two skies.
	const finder = picker.getByRole('button', { name: /^Two skies/ });
	const top = async (id: string) =>
		(await finder.locator(`[data-item-id="${id}"]`).boundingBox())!.y;
	expect(await top('e2e-frame')).toBeLessThan(await top('e2e-disc'));
	await picker.getByRole('button', { name: 'Swap charts' }).click();
	await expect(picker.getByRole('button', { name: 'Swap charts' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect.poll(async () => (await top('e2e-disc')) < (await top('e2e-frame'))).toBe(true);

	// Turned, the tiles are landscape pages, and so are the pages they make.
	const sheet = async () => (await finder.locator('span.sheet').boundingBox())!;
	expect((await sheet()).height).toBeGreaterThan((await sheet()).width);
	await picker.getByRole('radio', { name: 'Landscape' }).click();
	await expect.poll(async () => (await sheet()).width > (await sheet()).height).toBe(true);

	// A worksheet a chart: two pages for this one, the second new, after it.
	await picker.getByRole('button', { name: 'Worksheet: Tasks, and a key · 2 pages' }).click();
	await expect.poll(async () => (await savedPages(page)).length).toBe(4);
	const pages = await savedPages(page);
	expect(pages.map((saved) => saved.items.map((item) => item.id))).toEqual([
		['e2e-disc'],
		['e2e-frame'],
		['e2e-lone'],
		[]
	]);
	expect(pages[0].id).toBe('e2e-page-1');
	expect(pages.slice(0, 2).map((saved) => saved.orientation)).toEqual(['landscape', 'landscape']);
	for (const saved of pages.slice(0, 2)) {
		expect(roles(saved)).toEqual(['header', 'number', 'tasks', 'key']);
		expect(saved.texts![3].rotation).toBe(180);
	}
	expect(pages.slice(0, 2).map((saved) => saved.texts![1].text)).toEqual(['№ 1', '№ 2']);
	await expect(panel.getByRole('button', { name: /^Page \d,/ })).toHaveCount(4);
	await expect(
		page.getByRole('status').filter({ hasText: 'Page 1 laid out as “Worksheet”, on 2 pages' })
	).toBeVisible();

	// ⌘Z takes the new page away and puts the first back as it was.
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(async () => await savedPages(page)).toEqual(DOCUMENT.pages);
});

test('the editor lays its page out too, keeping what was typed in a title; Escape leaves the page alone', async ({
	page
}) => {
	await seed(page);
	await page.getByRole('button', { name: 'Page 2, 1 chart' }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await page.evaluate(() => document.fonts.ready);
	const open = editor.getByRole('button', { name: 'Lay page 2 out as a template' });
	await open.click();
	const picker = page.getByRole('dialog', { name: 'Lay page 2 out as' });
	await expect(picker).toBeVisible();
	// With one chart a template for two is not on offer, and says why.
	await expect(picker.getByRole('button', { name: 'Two skies: Needs 2 charts' })).toBeDisabled();
	await expect(picker.getByRole('button', { name: 'Swap charts' })).toHaveCount(0);

	// Escape closes the picker, not the editor, and nothing has changed.
	await page.keyboard.press('Escape');
	await expect(picker).toHaveCount(0);
	await expect(editor).toBeVisible();
	await expect(open).toBeFocused();
	expect((await savedPages(page))[1]).toEqual(DOCUMENT.pages[1]);

	await open.click();
	await picker.getByRole('button', { name: 'With a caption: One to a page' }).click();
	const title = editor.getByRole('button', { name: /^Text 1 of 2: Sky chart$/ });
	await expect(title).toBeVisible();
	await expect(
		editor.getByRole('button', {
			name: /^Text 2 of 2: Latitude \d+° [NS] · sidereal time \d+h \d\dm$/
		})
	).toBeVisible();

	// The title typed over, then the page laid out as a worksheet: it has no title, the words go;
	// back to a caption page they are not remembered, but a caption page laid out again keeps them.
	await title.click();
	await page.keyboard.press('Enter');
	await page.keyboard.type('Orion in winter');
	await page.keyboard.press('Escape');
	await expect
		.poll(async () => (await savedPages(page))[1].texts?.[0]?.text)
		.toBe('Orion in winter');
	await open.click();
	await picker.getByRole('radio', { name: 'Landscape' }).click();
	await picker.getByRole('button', { name: 'With a caption: One to a page' }).click();
	await expect.poll(async () => (await savedPages(page))[1].orientation).toBe('landscape');
	const again = (await savedPages(page))[1];
	expect(again.texts!.map((text) => [text.role, text.text])).toEqual([
		['title', 'Orion in winter'],
		['caption', 'Latitude {lat} · sidereal time {lst}']
	]);
	await expect(
		editor.getByRole('group', { name: 'Page 2, A4 landscape, 1 chart, 2 texts' })
	).toBeFocused();
});

test('a finder card is made of one sky and an object chosen on it: a close-up, and its place ringed', async ({
	page
}) => {
	await seed(page);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	await panel.getByRole('button', { name: 'Page 2, 1 chart' }).hover();
	await panel.getByRole('button', { name: 'Lay page 2 out as a template' }).click();
	const picker = page.getByRole('dialog', { name: 'Lay page 2 out as' });

	// One chart is enough: the tile shows the card with a close-up of the brightest object there.
	const tile = picker.getByRole('button', { name: 'Finder card: A sky and a close-up' });
	await expect(tile).toBeEnabled();
	await expect(tile.locator('.chart[data-item-id]')).toHaveCount(2);

	// It asks what the close-up is of: the objects on this sky, brightest first.
	await tile.click();
	const objects = page.getByRole('dialog', { name: 'Finder card of page 2: a close-up of' });
	await expect(objects).toBeVisible();
	const search = objects.getByRole('searchbox', { name: 'Find an object' });
	await expect(search).toBeFocused();
	const rows = objects.getByRole('list', { name: 'Objects on this sky' }).getByRole('button');
	await expect(rows.first()).toContainText('M 45 · Pleiades');
	expect(await rows.count()).toBeGreaterThan(10);
	expect(await rows.count()).toBeLessThan(110);

	// Narrowed by what is typed: a number, a name, a kind.
	await search.fill('andromeda');
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText('M 31 · Andromeda Galaxy');
	await search.fill('m 44');
	await expect(rows).toHaveText([/^M 44 · Beehive Cluster/]);
	// The card beside the list is drawn for it: the sky, and the close-up under it.
	await expect(objects.locator('.card .chart[data-item-id]')).toHaveCount(2);

	// Escape goes back to the templates, not out; then in again, at 10°.
	await page.keyboard.press('Escape');
	await expect(picker).toBeVisible();
	await expect(tile).toBeFocused();
	await tile.click();
	await objects.getByRole('button', { name: '10 degrees' }).click();
	await search.fill('pleia');
	await expect(rows).toHaveCount(1);
	// Enter in the search takes the first found.
	await search.press('Enter');
	await expect(objects).toHaveCount(0);

	await expect.poll(async () => (await savedPages(page))[1].items.length).toBe(2);
	interface SavedChart {
		view: { projection: string; pinholeFovDeg: number };
		marks?: { raDeg: number; decDeg: number; radiusDeg: number }[];
		createdAt: string;
	}
	const card = (await savedPages(page))[1] as SavedPage & {
		items: { id: string; closeUpOf?: string; chart: SavedChart }[];
	};
	const [sky, close] = card.items;
	expect(sky.id).toBe('e2e-lone');
	expect(sky.chart.marks).toHaveLength(1);
	expect(sky.chart.marks![0].radiusDeg).toBe(5);
	expect(sky.chart.marks![0].raDeg).toBeCloseTo(56.85, 0);
	expect(sky.chart.marks![0].decDeg).toBeCloseTo(24.1, 0);
	expect(close.closeUpOf).toBe('e2e-lone');
	expect(close.chart.view).toMatchObject({ projection: 'pinhole', pinholeFovDeg: 10 });
	expect(close.chart.createdAt).toBe(STEREO.createdAt);
	expect(close.frame.y).toBeGreaterThan(sky.frame.y + sky.frame.h);
	expect(card.texts!.map((text) => [text.role, text.text, text.chartId])).toEqual([
		['title', 'Finder card', undefined],
		['caption', 'Latitude {lat} · sidereal time {lst}', 'e2e-lone'],
		['caption', 'M 45 · Pleiades · field {fov}', close.id]
	]);
	// One page: nothing else was on it to move on.
	expect((await savedPages(page)).length).toBe(3);

	// The PDF is told the ring on the sky, and none on the close-up.
	let body: { pages: { items: { config: { marks?: unknown[]; projection: string } }[] }[] } | null =
		null;
	await page.route('**/api/export/document', async (route) => {
		body = route.request().postDataJSON();
		await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF\n' });
	});
	await page.getByRole('button', { name: 'Choose export format' }).click();
	const download = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'PDF document' }).click();
	await download;
	const sent = body!.pages[1].items.map((item) => item.config);
	expect(sent.map((config) => config.projection)).toEqual(['stereo', 'pinhole']);
	expect(sent[0].marks).toEqual([
		{ ra_deg: sky.chart.marks![0].raDeg, dec_deg: sky.chart.marks![0].decDeg, radius_deg: 5 }
	]);
	expect(sent[1]).not.toHaveProperty('marks');

	// Another object for the same sky: the close-up is replaced, not added to.
	await panel.getByRole('button', { name: 'Page 2, 2 charts' }).hover();
	await panel.getByRole('button', { name: 'Lay page 2 out as a template' }).click();
	await picker.getByRole('button', { name: /^Finder card/ }).click();
	await search.fill('m 31');
	await rows.first().click();
	await expect
		.poll(async () => (await savedPages(page))[1].texts?.[2]?.text)
		.toBe('M 31 · Andromeda Galaxy · field {fov}');
	const replaced = (await savedPages(page))[1];
	expect(replaced.items).toHaveLength(2);
	expect(replaced.items[1].id).not.toBe(close.id);
});
