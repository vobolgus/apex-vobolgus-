import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	chartsOf,
	documentOf,
	savedPages,
	seedDocument,
	typesetOf,
	type Frame,
	type SavedChart as SavedChartBlock,
	type SavedPage
} from './saved-document';

/**
 * Page templates: the button on a page's thumbnail (across from its ⊖) and by its
 * name in the editor opens the picker, whose tiles show what each template makes of
 * that page; a click lays the page out, on more pages when its charts need them, and
 * the toast's Undo puts everything back.
 */

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
const DOCUMENT = documentOf([
	{
		id: 'e2e-page-1',
		orientation: 'portrait',
		blocks: [
			{ kind: 'chart', id: 'e2e-frame', chart: PINHOLE, frame: { x: 12, y: 12, w: 90, h: 56.25 } },
			{ kind: 'chart', id: 'e2e-disc', chart: STEREO, frame: { x: 108, y: 12, w: 90, h: 90 } }
		]
	},
	{
		id: 'e2e-page-2',
		orientation: 'portrait',
		blocks: [
			{ kind: 'chart', id: 'e2e-lone', chart: STEREO, frame: { x: 12, y: 55.5, w: 186, h: 186 } }
		]
	},
	{ id: 'e2e-page-3', orientation: 'portrait', blocks: [] }
]);

async function seed(page: Page) {
	await seedDocument(page, DOCUMENT);
}

const roles = (saved: SavedPage) => typesetOf(saved).map((text) => text.role);

/** Where everything is on a saved page: its charts, and its texts by part. */
function layoutOf(saved: SavedPage) {
	return {
		orientation: saved.orientation,
		items: chartsOf(saved).map(({ id, frame }) => ({ id, frame })),
		texts: typesetOf(saved).map(({ role, text, chartId, rotation, frame }) => ({
			part: [role, text, chartId, rotation].join('|'),
			frame
		}))
	};
}

/** Whether two layouts are the same, every frame to a hundredth of a millimetre. */
function sameLayout(a: ReturnType<typeof layoutOf>, b: ReturnType<typeof layoutOf>): boolean {
	const near = (p: Frame, q: Frame) =>
		(['x', 'y', 'w', 'h'] as const).every((side) => Math.abs(p[side] - q[side]) < 0.01);
	return (
		a.orientation === b.orientation &&
		a.items.length === b.items.length &&
		a.texts.length === b.texts.length &&
		a.items.every((item, i) => item.id === b.items[i].id && near(item.frame, b.items[i].frame)) &&
		a.texts.every((text, i) => text.part === b.texts[i].part && near(text.frame, b.texts[i].frame))
	);
}

/** How many pixels of a thumbnail's canvas are the accent's red: a ring drawn on it. */
async function accentPixels(canvas: Locator): Promise<number> {
	return canvas.evaluate((node) => {
		const el = node as HTMLCanvasElement;
		const { data } = el.getContext('2d')!.getImageData(0, 0, el.width, el.height);
		let count = 0;
		for (let i = 0; i < data.length; i += 4) {
			// Antialiased on white or on nothing: red well over green and blue.
			if (
				data[i + 3] > 40 &&
				data[i] > 150 &&
				data[i] - data[i + 1] > 60 &&
				data[i] - data[i + 2] > 60
			) {
				count += 1;
			}
		}
		return count;
	});
}

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
	const laidCharts = chartsOf(laid);
	expect(laidCharts.map((item) => item.id)).toEqual(['e2e-frame', 'e2e-disc']);
	expect(laidCharts[1].frame.y).toBeGreaterThan(laidCharts[0].frame.y + laidCharts[0].frame.h);
	expect(laidCharts[1].frame.w).toBeGreaterThan(90);
	expect(typesetOf(laid).map((text) => text.chartId)).toEqual([undefined, 'e2e-frame', 'e2e-disc']);
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
	expect(pages.map((saved) => chartsOf(saved).map((item) => item.id))).toEqual([
		['e2e-disc'],
		['e2e-frame'],
		['e2e-lone'],
		[]
	]);
	expect(pages[0].id).toBe('e2e-page-1');
	expect(pages.slice(0, 2).map((saved) => saved.orientation)).toEqual(['landscape', 'landscape']);
	for (const saved of pages.slice(0, 2)) {
		expect(roles(saved)).toEqual(['header', 'number', 'tasks', 'stars', 'messier', 'key']);
		expect(typesetOf(saved)[5].rotation).toBe(180);
	}
	expect(pages.slice(0, 2).map((saved) => typesetOf(saved)[1].text)).toEqual(['№ 1', '№ 2']);
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
		.poll(async () => typesetOf((await savedPages(page))[1])[0]?.text)
		.toBe('Orion in winter');
	await open.click();
	await picker.getByRole('radio', { name: 'Landscape' }).click();
	await picker.getByRole('button', { name: 'With a caption: One to a page' }).click();
	await expect.poll(async () => (await savedPages(page))[1].orientation).toBe('landscape');
	const again = (await savedPages(page))[1];
	expect(typesetOf(again).map((text) => [text.role, text.text])).toEqual([
		['title', 'Orion in winter'],
		['caption', 'Latitude {lat} · sidereal time {lst}']
	]);
	await expect(
		editor.getByRole('group', { name: 'Page 2, A4 landscape, 1 chart, 2 texts' })
	).toBeFocused();
});

test('a page a template laid out turns as the template lays it out the other way, and back', async ({
	page
}) => {
	await seed(page);
	await page.getByRole('button', { name: 'Page 1, 2 charts' }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await page.evaluate(() => document.fonts.ready);
	const open = editor.getByRole('button', { name: 'Lay page 1 out as a template' });
	const picker = page.getByRole('dialog', { name: 'Lay page 1 out as' });
	const first = async () => (await savedPages(page))[0];

	// Two skies on the portrait page, one over the other, and the page remembers the template.
	await open.click();
	await picker.getByRole('button', { name: 'Two skies: Side by side' }).click();
	await expect.poll(async () => roles(await first())).toEqual(['title', 'caption', 'caption']);
	const upright = layoutOf(await first());
	expect(upright.items[1].frame.y).toBeGreaterThan(
		upright.items[0].frame.y + upright.items[0].frame.h
	);
	expect((await first()).template).toEqual({ id: 'pair', language: 'en' });

	// What the template makes of the same charts on a landscape page: side by side.
	await open.click();
	await picker.getByRole('radio', { name: 'Landscape' }).click();
	await picker.getByRole('button', { name: 'Two skies: Side by side' }).click();
	await expect.poll(async () => (await first()).orientation).toBe('landscape');
	const across = layoutOf(await first());
	expect(across.items[1].frame.x).toBeGreaterThan(
		across.items[0].frame.x + across.items[0].frame.w
	);
	expect(across.texts[0].frame).toMatchObject({ x: 12, y: 12, w: 273 });

	// Turned with the page's own toggle, it is the template's portrait page again, not the
	// arranger's turn of two charts with the text carried along.
	const toggle = editor.getByRole('radiogroup', { name: 'Page 1 orientation' });
	await toggle.getByRole('radio', { name: 'Portrait' }).click();
	await expect.poll(async () => (await first()).orientation).toBe('portrait');
	await expect.poll(async () => sameLayout(layoutOf(await first()), upright)).toBe(true);
	expect((await first()).template).toEqual({ id: 'pair', language: 'en' });
	await expect(editor.getByRole('button', { name: /^Text 1 of 3: Two skies$/ })).toBeVisible();

	// And turned back, the landscape page the picker made.
	await toggle.getByRole('radio', { name: 'Landscape' }).click();
	await expect.poll(async () => (await first()).orientation).toBe('landscape');
	await expect.poll(async () => sameLayout(layoutOf(await first()), across)).toBe(true);
	expect((await first()).template).toEqual({ id: 'pair', language: 'en' });
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
	// The object's place is ringed on the sky there, and not on the close-up.
	const cardSky = objects.locator('.card .chart[data-item-id="e2e-lone"] canvas');
	const cardCloseUp = objects.locator('.card .chart:not([data-item-id="e2e-lone"]) canvas');
	await expect.poll(async () => accentPixels(cardSky)).toBeGreaterThan(10);
	expect(await accentPixels(cardCloseUp)).toBe(0);

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

	await expect.poll(async () => chartsOf((await savedPages(page))[1]).length).toBe(2);
	interface SavedChart {
		view: { projection: string; pinholeFovDeg: number };
		marks?: { raDeg: number; decDeg: number; radiusDeg: number }[];
		createdAt: string;
	}
	const card = (await savedPages(page))[1];
	const [sky, close] = chartsOf(card) as (Omit<SavedChartBlock, 'chart'> & { chart: SavedChart })[];
	expect(sky.id).toBe('e2e-lone');
	expect(sky.chart.marks).toHaveLength(1);
	expect(sky.chart.marks![0].radiusDeg).toBe(5);
	expect(sky.chart.marks![0].raDeg).toBeCloseTo(56.85, 0);
	expect(sky.chart.marks![0].decDeg).toBeCloseTo(24.1, 0);
	expect(close.closeUpOf).toBe('e2e-lone');
	expect(close.chart.view).toMatchObject({ projection: 'pinhole', pinholeFovDeg: 10 });
	expect(close.chart.createdAt).toBe(STEREO.createdAt);
	expect(close.frame.y).toBeGreaterThan(sky.frame.y + sky.frame.h);
	expect(typesetOf(card).map((text) => [text.role, text.text, text.chartId])).toEqual([
		['title', 'Finder card', undefined],
		['caption', 'Latitude {lat} · sidereal time {lst}', 'e2e-lone'],
		['caption', 'M 45 · Pleiades · field {fov}', close.id]
	]);
	// One page: nothing else was on it to move on.
	expect((await savedPages(page)).length).toBe(3);
	// The page's thumbnail in the panel shows the ring on the sky; a page with no card has none.
	const thumb = (id: string) => panel.locator(`.chart[data-item-id="${id}"] canvas`);
	await expect.poll(async () => accentPixels(thumb('e2e-lone'))).toBeGreaterThan(10);
	expect(await accentPixels(thumb(close.id))).toBe(0);
	expect(await accentPixels(thumb('e2e-disc'))).toBe(0);

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
		.poll(async () => typesetOf((await savedPages(page))[1])[2]?.text)
		.toBe('M 31 · Andromeda Galaxy · field {fov}');
	const replaced = (await savedPages(page))[1];
	expect(chartsOf(replaced)).toHaveLength(2);
	expect(chartsOf(replaced)[1].id).not.toBe(close.id);
});

test('a template writes in the language chosen under the tiles: Russian, or English', async ({
	page
}) => {
	await seed(page);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	await panel.getByRole('button', { name: 'Page 2, 1 chart' }).hover();
	await panel.getByRole('button', { name: 'Lay page 2 out as a template' }).click();
	const picker = page.getByRole('dialog', { name: 'Lay page 2 out as' });
	const language = picker.getByRole('group', { name: 'Language of the text' });
	await expect(language.getByRole('button')).toHaveText(['EN', 'RU']);
	// This browser is set to English, so the templates begin in it.
	await expect(language.getByRole('button', { name: 'EN' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const tile = picker.getByRole('button', { name: 'With a caption: One to a page' });
	await expect(tile.locator('.text').first()).toHaveText('Sky chart');

	// Russian redraws the tiles in it.
	await language.getByRole('button', { name: 'RU' }).click();
	await expect(language.getByRole('button', { name: 'RU' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(language.getByRole('button', { name: 'EN' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await expect(tile.locator('.text').first()).toHaveText('Карта неба');
	const sheet = picker.getByRole('button', { name: /^Worksheet/ });
	await expect(sheet.locator('.text').first()).toHaveText(/^Фамилия, имя/);

	// The page is laid out in it: the words are Russian, what the fields show is as it was.
	await tile.click();
	await expect
		.poll(async () => typesetOf((await savedPages(page))[1]).map((text) => [text.role, text.text]))
		.toEqual([
			['title', 'Карта неба'],
			['caption', 'Широта {lat} · звёздное время {lst}']
		]);
	await panel.getByRole('button', { name: 'Page 2, 1 chart' }).click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await expect(
		editor.getByRole('button', {
			name: /^Text 2 of 2: Широта \d+° [NS] · звёздное время \d+h \d\dm$/
		})
	).toBeVisible();
});

test.describe('in a browser set to Russian', () => {
	test.use({ locale: 'ru-RU' });

	test('the templates begin in Russian, and English is a click away', async ({ page }) => {
		await seed(page);
		const panel = page.getByRole('complementary', { name: 'PDF pages' });
		await panel.getByRole('button', { name: 'Page 2, 1 chart' }).hover();
		await panel.getByRole('button', { name: 'Lay page 2 out as a template' }).click();
		const picker = page.getByRole('dialog', { name: 'Lay page 2 out as' });
		const language = picker.getByRole('group', { name: 'Language of the text' });
		await expect(language.getByRole('button', { name: 'RU' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		const tile = picker.getByRole('button', { name: 'With a caption: One to a page' });
		await expect(tile.locator('.text').first()).toHaveText('Карта неба');
		await language.getByRole('button', { name: 'EN' }).click();
		await expect(tile.locator('.text').first()).toHaveText('Sky chart');
		await tile.click();
		await expect
			.poll(async () => typesetOf((await savedPages(page))[1]).map((text) => text.text))
			.toEqual(['Sky chart', 'Latitude {lat} · sidereal time {lst}']);
	});
});
