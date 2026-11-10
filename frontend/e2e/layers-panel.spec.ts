import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The layers panel: on a screen with room beside the chart the dock's Layers
 * button shows a panel on the right, which the chart keeps clear of and which
 * stays open while the sky is turned. A phone keeps the popover above the dock.
 */

async function gotoGenerator(page: Page) {
	await page.goto('/');
	await page.waitForSelector('canvas');
	// Hydration done: the Layers button only gets its handler once the app is live.
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** Click the Layers button until `target` shows: a click before hydration is lost. */
async function openLayers(trigger: Locator, target: Locator) {
	await expect(async () => {
		if (!(await target.isVisible())) await trigger.click();
		await expect(target).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 15000 });
}

async function box(locator: Locator) {
	const rect = await locator.boundingBox();
	if (!rect) throw new Error('no bounding box');
	return rect;
}

test('Layers opens a panel beside the chart, which stays where it was and uncovered', async ({
	page
}) => {
	await gotoGenerator(page);
	const trigger = page.getByRole('button', { name: /^Layers/ });
	const panel = page.getByRole('complementary', { name: 'Layers' });
	const canvas = page.locator('canvas');
	const before = await box(canvas);

	await openLayers(trigger, panel);
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	// No popover over the chart any more.
	await expect(page.getByRole('dialog', { name: 'Layers' })).toHaveCount(0);

	const chart = await box(canvas);
	const side = await box(panel);
	// At 1280 px there is room for both: the chart has not moved or shrunk...
	expect(chart).toEqual(before);
	// ...and the panel starts to the right of it.
	expect(side.x).toBeGreaterThanOrEqual(chart.x + chart.width);

	// A switch shows its effect; the count on the button follows.
	await panel.getByRole('switch', { name: 'Ecliptic' }).click();
	await expect(page.getByRole('button', { name: 'Layers, 1 on' })).toBeVisible();

	// Turning the sky, or Escape pressed elsewhere, does not close it: it is no menu.
	await page.mouse.move(chart.x + chart.width / 2, chart.y + chart.height / 2);
	await page.mouse.down();
	await page.mouse.move(chart.x + chart.width / 2 + 60, chart.y + chart.height / 2 + 30, {
		steps: 4
	});
	await page.mouse.up();
	await page.keyboard.press('Escape');
	await expect(panel).toBeVisible();
});

test('the panel is remembered across a reload, and closed it stays closed', async ({ page }) => {
	await gotoGenerator(page);
	const trigger = page.getByRole('button', { name: /^Layers/ });
	const panel = page.getByRole('complementary', { name: 'Layers' });
	await openLayers(trigger, panel);

	await page.reload();
	await page.waitForSelector('canvas');
	await expect(panel).toBeVisible();

	await panel.getByRole('button', { name: 'Hide layers' }).click();
	await expect(panel).toBeHidden();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');

	await page.reload();
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
	await expect(panel).toBeHidden();
});

test('controls clicked with the mouse do not take the arrow keys from the sky', async ({
	page
}) => {
	await page.goto('/#p=stereo&ra=80&dec=10&pa=0&fov=120');
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
	const hash = () => new URL(page.url()).hash;
	const nothingFocused = () => page.evaluate(() => document.activeElement === document.body);
	/** Hold an arrow for a moment; the address follows the sky once it has come to rest. */
	const turn = async (key: string) => {
		const before = hash();
		await page.keyboard.down(key);
		await page.waitForTimeout(250);
		await page.keyboard.up(key);
		await expect.poll(hash).not.toBe(before);
		return hash();
	};

	// A projection: the click switches it, and the arrows still turn the sky after.
	await page.getByRole('radio', { name: 'Pinhole projection' }).click();
	await expect(page.getByRole('radio', { name: 'Pinhole projection' })).toBeChecked();
	expect(await nothingFocused()).toBe(true);
	await page.waitForTimeout(800);
	expect(await turn('ArrowRight')).toMatch(/^#p=pinhole&/);
	expect(await turn('ArrowLeft')).toMatch(/^#p=pinhole&/);
	await expect(page.getByRole('radio', { name: 'Pinhole projection' })).toBeChecked();

	// The Layers button and a switch in its panel: ↑/↓ are the sky's, not the list's.
	const panel = page.getByRole('complementary', { name: 'Layers' });
	await openLayers(page.getByRole('button', { name: /^Layers/ }), panel);
	await panel.getByRole('switch', { name: 'Ecliptic' }).click();
	await expect(page.getByRole('button', { name: 'Layers, 1 on' })).toBeVisible();
	expect(await nothingFocused()).toBe(true);
	await turn('ArrowUp');
	await expect(panel).toBeVisible();

	// The panel's close button: closed with the mouse, the focus does not land on the Layers button.
	await panel.getByRole('button', { name: 'Hide layers' }).click();
	await expect(panel).toBeHidden();
	expect(await nothingFocused()).toBe(true);
	await turn('ArrowDown');
	await expect(panel).toBeHidden();

	// A page opened in the editor with a click, and the editor closed with one: its
	// thumbnail does not come back holding the focus, where ↑/↓ would walk the pages.
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	const thumb = page.getByRole('button', { name: 'Page 1, 1 chart' });
	await expect(thumb).toBeVisible();
	await expect(page.locator('.pdf-flight')).toHaveCount(0);
	await thumb.click();
	const editor = page.getByRole('dialog', { name: 'PDF document' });
	await expect(editor).toBeVisible();
	await editor.getByRole('button', { name: 'Close' }).click();
	await expect(editor).toBeHidden();
	await expect(thumb).not.toBeFocused();
	await turn('ArrowUp');
});

test('from the keyboard the projection is still stepped with the arrows, and the panel gives the focus back', async ({
	page
}) => {
	await gotoGenerator(page);
	const stereo = page.getByRole('radio', { name: 'Stereographic projection' });
	const pinhole = page.getByRole('radio', { name: 'Pinhole projection' });
	// Tabbed to, the radio group takes the arrows, as a radio group does.
	await expect(async () => {
		await stereo.focus();
		await page.keyboard.press('ArrowRight');
		await expect(pinhole).toBeChecked({ timeout: 500 });
	}).toPass({ timeout: 15000 });
	await expect(pinhole).toBeFocused();

	// Opened and closed from the keyboard, the panel returns the focus to its button.
	const trigger = page.getByRole('button', { name: /^Layers/ });
	const panel = page.getByRole('complementary', { name: 'Layers' });
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(panel).toBeVisible();
	await panel.getByRole('button', { name: 'Hide layers' }).focus();
	await page.keyboard.press('Enter');
	await expect(panel).toBeHidden();
	await expect(trigger).toBeFocused();
});

test('from the keyboard the focus goes into the panel, and Escape there closes it', async ({
	page
}) => {
	await gotoGenerator(page);
	const trigger = page.getByRole('button', { name: /^Layers/ });
	const panel = page.getByRole('complementary', { name: 'Layers' });

	await expect(async () => {
		if (!(await panel.isVisible())) {
			await trigger.focus();
			await page.keyboard.press('Enter');
		}
		await expect(panel).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 15000 });
	const first = panel.getByRole('switch').first();
	await expect(first).toBeFocused();

	// The arrows walk the rows instead of turning the sky.
	await page.keyboard.press('ArrowDown');
	await expect(panel.getByRole('switch').nth(1)).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
	await expect(trigger).toBeFocused();
});

test('in a narrower window the chart moves over rather than slide under the panel', async ({
	page
}) => {
	await page.setViewportSize({ width: 1000, height: 760 });
	await gotoGenerator(page);
	const canvas = page.locator('canvas');
	const before = await box(canvas);

	const panel = page.getByRole('complementary', { name: 'Layers' });
	await openLayers(page.getByRole('button', { name: /^Layers/ }), panel);
	const side = await box(panel);
	// The chart glides to its new place: wait for it to come to rest clear of the panel.
	await expect
		.poll(async () => {
			const moving = await box(canvas);
			return moving.x + moving.width;
		})
		.toBeLessThanOrEqual(side.x);
	await page.waitForTimeout(350);
	const chart = await box(canvas);
	expect(chart.x + chart.width).toBeLessThanOrEqual(side.x);
	// It moved left to make the room, and kept its size.
	expect(chart.x).toBeLessThan(before.x);
	expect(chart.width).toBeCloseTo(before.width, 3);
});

test('on a phone Layers is still the popover above the dock', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 780 });
	await gotoGenerator(page);
	const popover = page.getByRole('dialog', { name: 'Layers' });
	await openLayers(page.getByRole('button', { name: /^Layers/ }), popover);
	await expect(page.getByRole('complementary', { name: 'Layers' })).toHaveCount(0);
	await popover.getByRole('switch', { name: 'Ecliptic' }).click();
	await expect(page.getByRole('button', { name: 'Layers, 1 on' })).toBeVisible();
});
