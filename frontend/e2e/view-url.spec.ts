import { expect, test, type Page } from '@playwright/test';

/**
 * The view in the address bar, and what the page says when the backend lets it
 * down: the catalogue notice with its Try again, and the export's failure toast.
 */

const ORION =
	'#p=pinhole&ra=83.82&dec=-1.2&pa=0&fov=40&ar=1.5&size=1.3&layers=lines,bounds,equator';

async function gotoGenerator(page: Page, hash = '') {
	await page.goto(`/${hash}`);
	await page.waitForSelector('canvas');
	// Hydration done: the view in the address is only read once the app is live.
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

function hashOf(page: Page): string {
	return new URL(page.url()).hash;
}

test('a link opens its view: projection, layers and all', async ({ page }) => {
	await gotoGenerator(page, ORION);
	await expect(page.getByRole('radio', { name: 'Pinhole projection' })).toBeChecked();
	await expect(page.getByRole('button', { name: 'Layers, 3 on' })).toBeVisible();
	// Read, not rewritten: the address stays as it was given.
	expect(hashOf(page)).toBe(ORION);
});

test('a plain visit keeps a plain address until the view changes, and a reload keeps the view', async ({
	page
}) => {
	await gotoGenerator(page);
	expect(hashOf(page)).toBe('');

	const box = (await page.locator('canvas').boundingBox())!;
	const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
	await expect(async () => {
		await page.mouse.move(cx, cy);
		await page.mouse.down();
		await page.mouse.move(cx + 90, cy + 40, { steps: 6 });
		await page.mouse.up();
		await expect.poll(() => hashOf(page), { timeout: 2000 }).toMatch(/^#p=stereo&ra=/);
	}).toPass({ timeout: 15000 });
	await page.keyboard.press('Shift+P');
	await expect.poll(() => hashOf(page)).toMatch(/^#p=pinhole&ra=.*&ar=.*&size=/);

	const hash = hashOf(page);
	await page.reload();
	await page.waitForSelector('canvas');
	await expect(page.getByRole('radio', { name: 'Pinhole projection' })).toBeChecked();
	// The same view writes the same address: nothing drifted on the way through it.
	await page.keyboard.press('Shift+P');
	await page.keyboard.press('Shift+P');
	await expect(page.getByRole('radio', { name: 'Pinhole projection' })).toBeChecked();
	expect(hashOf(page)).toBe(hash);
});

test('another link pasted into the same tab takes over the view', async ({ page }) => {
	await gotoGenerator(page);
	await expect(page.getByRole('radio', { name: 'Stereographic projection' })).toBeChecked();
	await page.evaluate((hash) => (window.location.hash = hash), ORION);
	await expect(page.getByRole('radio', { name: 'Pinhole projection' })).toBeChecked();
	await expect(page.getByRole('button', { name: 'Layers, 3 on' })).toBeVisible();
});

test('a catalogue that fails to load says so, and Try again loads it', async ({ page }) => {
	let down = true;
	await page.route('**/api/catalog/**', (route) =>
		down ? route.fulfill({ status: 502, body: 'down' }) : route.continue()
	);
	await gotoGenerator(page);

	const notice = page.getByText('Couldn’t load the star catalogue.');
	await expect(notice).toBeVisible();

	down = false;
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(notice).toBeHidden();
	await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
});

test('missing constellation lines are named, with the stars still drawn', async ({ page }) => {
	await page.route('**/api/constellations', (route) => route.fulfill({ status: 502, body: '' }));
	await gotoGenerator(page);
	await expect(page.getByText('Couldn’t load the constellation lines.')).toBeVisible();
});

test('a failed SVG export says so in a toast', async ({ page }) => {
	// With the `?`: in dev the bare pattern would also catch the module `src/lib/api/export.ts`.
	await page.route('**/api/export?*', (route) => route.fulfill({ status: 500, body: 'boom' }));
	await gotoGenerator(page);

	const svg = page.getByRole('menuitemradio', { name: 'SVG' });
	await expect(async () => {
		if (!(await svg.isVisible())) await page.locator('button.export-toggle').click();
		await expect(svg).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 15000 });
	await svg.click();
	await expect(page.getByText('Couldn’t export the SVG. Try again in a moment.')).toBeVisible();
});
