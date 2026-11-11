import { expect, test, type Page } from '@playwright/test';
import { chartsOf, savedPages, type SavedChart } from './saved-document';

/**
 * The PDF document from the generator: Add to PDF fills the pages panel (laying a
 * page out again to make room, which the toast's Undo takes back), a page deleted
 * from the panel comes back with the toast's Undo, a thumbnail opens the page
 * editor, and the export menu's "PDF document" row posts the whole document.
 */

/** The charts of the saved page `at` (saves are debounced: poll this). */
async function savedCharts(page: Page, at = 0): Promise<SavedChart[] | undefined> {
	const saved = (await savedPages(page))[at];
	return saved && chartsOf(saved);
}

async function gotoGenerator(page: Page) {
	await page.goto('/');
	await page.waitForSelector('canvas');
	// Hydration done: the header buttons only get their handlers once the app is live.
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

function thumbnails(page: Page) {
	return page.getByRole('complementary', { name: 'PDF pages' }).getByRole('button', {
		name: /^Page \d+, /
	});
}

test('Add to PDF fills the panel; a deleted page comes back with Undo; the document exports', async ({
	page
}) => {
	await gotoGenerator(page);
	await expect(page.getByRole('complementary', { name: 'PDF pages' })).toHaveCount(0);
	const add = page.getByRole('button', { name: 'Add to PDF' });

	await add.click();
	await expect(thumbnails(page)).toHaveCount(1);
	// Read out, and shown in the toast with an Undo.
	await expect(page.getByRole('status').filter({ hasText: /^Added to page 1$/ })).toHaveCount(1);
	const added = page.locator('.toast').filter({ hasText: 'Added to page 1' });
	await expect(added.getByRole('button', { name: 'Undo' })).toBeVisible();
	await add.click();
	// The first disc filled the page; the two now share it.
	await expect(page.getByRole('button', { name: 'Page 1, 2 charts' })).toBeVisible();
	await expect(page.locator('.toast')).toContainText('Added to page 1, layout updated');
	await expect(page.getByRole('button', { name: 'Page 1, 2 charts' })).toHaveAttribute(
		'aria-current',
		'true'
	);

	await page.getByRole('button', { name: 'Add page' }).click();
	await expect(thumbnails(page)).toHaveCount(2);
	await expect(page.getByRole('button', { name: 'Page 2, no charts' })).toBeVisible();

	// Delete page 1 from its ⊖ (shown on hover) and take it back.
	await page.getByRole('button', { name: 'Page 1, 2 charts' }).hover();
	await page.getByRole('button', { name: 'Delete page 1' }).click();
	await expect(thumbnails(page)).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Page 1, no charts' })).toBeVisible();
	const toast = page.getByRole('status').filter({ hasText: 'Page 1 deleted' });
	await expect(toast).toBeVisible();
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(toast).toHaveCount(0);
	await expect(thumbnails(page)).toHaveCount(2);
	await expect(page.getByRole('button', { name: 'Page 1, 2 charts' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Page 2, no charts' })).toBeVisible();

	// The export row posts every page; the response is stubbed, the request is what matters.
	let body: { pages: { width_mm: number; height_mm: number; items: unknown[] }[] } | null = null;
	await page.route('**/api/export/document', async (route) => {
		body = route.request().postDataJSON();
		await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF\n' });
	});
	await page.getByRole('button', { name: 'Choose export format' }).click();
	const row = page.getByRole('menuitem', { name: 'PDF document' });
	await expect(row).toBeEnabled();
	await expect(row).toHaveAccessibleDescription('2 pages · A4');
	const download = page.waitForEvent('download');
	await row.click();
	expect((await download).suggestedFilename()).toMatch(/^skycharts-\d+\.pdf$/);
	expect(body).not.toBeNull();
	const pages = body!.pages;
	expect(pages).toHaveLength(2);
	expect(pages.map((p) => [p.width_mm, p.height_mm])).toEqual([
		[210, 297],
		[210, 297]
	]);
	expect(pages.map((p) => p.items.length)).toEqual([2, 0]);
});

test('the toast’s Undo takes an Add back, and the page is laid out as before', async ({ page }) => {
	await gotoGenerator(page);
	const add = page.getByRole('button', { name: 'Add to PDF' });
	await add.click();
	await expect(thumbnails(page)).toHaveCount(1);
	await expect
		.poll(async () => (await savedCharts(page))?.[0]?.frame)
		.toEqual({
			x: 12,
			y: 55.5,
			w: 186,
			h: 186
		});
	await add.click();
	const toast = page.locator('.toast').filter({ hasText: 'Added to page 1, layout updated' });
	await expect(toast).toBeVisible();
	await expect
		.poll(async () => (await savedCharts(page))?.map((it) => it.frame.w))
		.toEqual([133.5, 133.5]);

	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(toast).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Page 1, 1 chart' })).toBeVisible();
	await expect
		.poll(async () => (await savedCharts(page))?.map((it) => it.frame))
		.toEqual([{ x: 12, y: 55.5, w: 186, h: 186 }]);
});

test('a wide pinhole gets a landscape page of its own', async ({ page }) => {
	await gotoGenerator(page);
	await page.getByRole('radio', { name: /pinhole/i }).click();
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await expect(thumbnails(page)).toHaveCount(1);
	await expect.poll(async () => (await savedPages(page))[0]?.orientation).toBe('landscape');
	const [saved] = await savedPages(page);
	// The default pinhole (1.61:1) across the full landscape width, centred.
	expect(chartsOf(saved)[0].frame.w).toBeCloseTo(273, 6);
	expect(chartsOf(saved)[0].frame.x).toBeCloseTo(12, 6);
});

test('a landscape page fits the width of the panel: the panel does not widen, the chart does not move', async ({
	page
}) => {
	await gotoGenerator(page);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	const canvas = page.locator('canvas').first();
	// A wide frame takes a landscape page of its own.
	await page.getByRole('radio', { name: /pinhole/i }).click();
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await expect(thumbnails(page)).toHaveCount(1);
	await expect.poll(async () => (await savedPages(page))[0]?.orientation).toBe('landscape');
	await page.waitForTimeout(900);
	const landscapePanel = (await panel.boundingBox())!;
	const landscapeChart = (await canvas.boundingBox())!;

	// An empty page is portrait.
	await panel.getByRole('button', { name: 'Add page' }).click();
	await expect(thumbnails(page)).toHaveCount(2);
	await expect.poll(async () => (await savedPages(page))[1]?.orientation).toBe('portrait');
	// Off the panel: a page under the pointer is lifted, 6 % larger.
	await page.mouse.move(640, 400);
	await page.waitForTimeout(600);
	const [landscape, portrait] = [
		(await thumbnails(page).nth(0).boundingBox())!,
		(await thumbnails(page).nth(1).boundingBox())!
	];
	// The landscape page is as wide as the portrait one, and lower.
	expect(landscape.width).toBeCloseTo(portrait.width, 1);
	expect(landscape.height).toBeLessThan(portrait.height);
	// So the panel is one width whatever it holds, and the chart beside it stays put.
	expect((await panel.boundingBox())!.width).toBeCloseTo(landscapePanel.width, 1);
	expect((await canvas.boundingBox())!.x).toBeCloseTo(landscapeChart.x, 1);
});

test('a long list fades only at the edge pages run under, and has no scrollbar', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 620 });
	await gotoGenerator(page);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	await page.getByRole('radio', { name: /pinhole/i }).click();
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await expect(thumbnails(page)).toHaveCount(1);
	for (let count = 2; count <= 6; count += 1) {
		await panel.getByRole('button', { name: 'Add page' }).click();
		await expect(thumbnails(page)).toHaveCount(count);
	}
	const list = panel.getByRole('list');
	const fades = () =>
		list.evaluate((el) => [
			parseFloat((el as HTMLElement).style.getPropertyValue('--fade-top')),
			parseFloat((el as HTMLElement).style.getPropertyValue('--fade-bottom'))
		]);
	const scrollTo = (top: number) => list.evaluate((el, y) => el.scrollTo(0, y), top);
	// It does scroll, without a bar of the system's down its side.
	expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	expect(await list.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');

	// The last page added is still being scrolled to, smoothly: let that come to rest first.
	await page.waitForTimeout(900);
	// At the top nothing is above to fade: the first page's ⊖ is at full strength.
	await scrollTo(0);
	await expect.poll(fades).toEqual([0, 20]);
	// A little way down the fade has come in by that much; further, in full at both edges.
	await scrollTo(6);
	await expect.poll(fades).toEqual([6, 20]);
	await scrollTo(60);
	await expect.poll(fades).toEqual([20, 20]);
	// At the bottom nothing is below.
	await scrollTo(100000);
	await expect.poll(fades).toEqual([20, 0]);
});

test('the PDF document row is disabled while the document is empty, and the arrows skip it', async ({
	page
}) => {
	await gotoGenerator(page);
	await page.keyboard.press('ControlOrMeta+KeyK');
	const menu = page.getByRole('menu', { name: 'Export format' });
	const row = menu.getByRole('menuitem', { name: 'PDF document' });
	await expect(row).toBeDisabled();
	await expect(row).toHaveAccessibleDescription('Add a chart first');

	await expect(menu.getByRole('menuitemradio', { name: 'PNG' })).toBeFocused();
	await page.keyboard.press('End');
	await expect(menu.getByRole('menuitemradio', { name: 'PDF' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitemradio', { name: 'PNG' })).toBeFocused();
});

test('a thumbnail opens the page editor, which Escape closes', async ({ page }) => {
	await gotoGenerator(page);
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	const thumbnail = page.getByRole('button', { name: 'Page 1, 1 chart' });
	await thumbnail.click();
	await expect(page.locator('dialog[open]')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('the toast stays on top of the page editor, and its Undo still works there', async ({
	page
}) => {
	await gotoGenerator(page);
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await page.getByRole('button', { name: 'Add page' }).click();
	await page.getByRole('button', { name: 'Page 2, no charts' }).hover();
	await page.getByRole('button', { name: 'Delete page 2' }).click();
	const toast = page.getByRole('status').filter({ hasText: 'Page 2 deleted' });
	await expect(toast).toBeVisible();

	// The editor is a modal dialog, which makes the page behind it inert.
	await page.getByRole('button', { name: 'Page 1, 1 chart' }).click();
	await expect(page.locator('dialog[open]')).toHaveCount(1);
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(toast).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(thumbnails(page)).toHaveCount(2);
});

test('the tab collapses the panel to the page count and opens it again', async ({ page }) => {
	await gotoGenerator(page);
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	const tab = page.getByRole('button', { name: 'PDF pages, 1' });
	await expect(tab).toHaveAttribute('aria-expanded', 'true');
	await tab.click();
	await expect(tab).toHaveAttribute('aria-expanded', 'false');
	await expect(thumbnails(page)).toHaveCount(0);
	await tab.click();
	await expect(thumbnails(page)).toHaveCount(1);
});

test('on a phone the panel starts collapsed, and the document survives a reload', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await gotoGenerator(page);
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	// Adding opens the panel, even on a phone.
	await expect(thumbnails(page)).toHaveCount(1);

	await page.reload();
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
	const tab = page.getByRole('button', { name: 'PDF pages, 1' });
	await expect(tab).toHaveAttribute('aria-expanded', 'false');
	await tab.click();
	await expect(page.getByRole('button', { name: 'Page 1, 1 chart' })).toBeVisible();
});
