import { expect, test, type Page } from '@playwright/test';

/**
 * The About dialog (after ray.so): the header button and `?` open it, Escape,
 * the backdrop and `?` again close it, and the page shortcuts it lists work.
 */

async function gotoGenerator(page: Page) {
	await page.goto('/');
	await page.waitForSelector('canvas');
	// Hydration done: the About button only gets its handler once the app is live.
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

test('About opens the dialog, Escape closes it and gives the focus back', async ({ page }) => {
	await gotoGenerator(page);
	const about = page.getByRole('button', { name: 'About' });
	await about.click();

	const dialog = page.getByRole('dialog', { name: 'About' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'Shortcuts' })).toBeVisible();
	await expect(dialog.getByText('Switch projection')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(about).toBeFocused();
});

test('? toggles the dialog, and the page keys do nothing under it', async ({ page }) => {
	await gotoGenerator(page);
	const dialog = page.getByRole('dialog', { name: 'About' });

	await page.keyboard.press('Shift+Slash');
	await expect(dialog).toBeVisible();

	// Shift+P would switch the projection; under the modal it must not.
	await page.keyboard.press('Shift+KeyP');
	await page.keyboard.press('Shift+Slash');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('radio', { name: /stereographic/i })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});

test('a click on the backdrop closes the dialog, a click inside does not', async ({ page }) => {
	await gotoGenerator(page);
	await page.getByRole('button', { name: 'About' }).click();
	const dialog = page.getByRole('dialog', { name: 'About' });

	await dialog.getByText('Contribute').click();
	await expect(dialog).toBeVisible();

	await page.mouse.click(8, 8);
	await expect(dialog).toBeHidden();
});

test('⌘K opens the export menu on the selected format, arrows move, Escape returns', async ({
	page
}) => {
	await gotoGenerator(page);
	const menu = page.getByRole('menu', { name: 'Export format' });

	await page.keyboard.press('ControlOrMeta+KeyK');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitemradio', { name: 'PNG' })).toBeFocused();

	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitemradio', { name: 'SVG' })).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(page.getByRole('button', { name: 'Choose export format' })).toBeFocused();

	await page.keyboard.press('ControlOrMeta+KeyK');
	await expect(menu).toBeVisible();
	await page.keyboard.press('ControlOrMeta+KeyK');
	await expect(menu).toBeHidden();
});

test('⌘S saves a PNG', async ({ page }) => {
	await gotoGenerator(page);
	const download = page.waitForEvent('download');
	await page.keyboard.press('ControlOrMeta+KeyS');
	expect((await download).suggestedFilename()).toMatch(/^skychart-\d+\.png$/);
});
