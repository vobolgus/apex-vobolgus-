import { expect, test, type Page } from '@playwright/test';

/**
 * The PDF document from the generator: Add to PDF fills the pages panel, a page
 * deleted from the panel comes back with the toast's Undo, a thumbnail opens the
 * page editor, and the export menu's "PDF document" row posts the whole document.
 */

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
	await expect(page.getByRole('status').filter({ hasText: 'Added to page 1' })).toHaveCount(1);
	await add.click();
	// The first chart fills the page's width; the second fits under it.
	await expect(page.getByRole('button', { name: 'Page 1, 2 charts' })).toBeVisible();
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
