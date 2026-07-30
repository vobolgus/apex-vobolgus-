import { expect, test, type Locator } from '@playwright/test';

/**
 * Open a menu, tolerating a not-yet-hydrated page.
 *
 * The dev server compiles /generator lazily, so on a cold start (exactly what CI
 * does: boot the server, run Playwright immediately) the SSR markup — canvas and
 * buttons included — is on the page before Svelte hydrates. A click that lands in
 * that window hits an element with no handler attached yet and is silently lost,
 * which made this spec fail on the first run after every server start.
 *
 * Waiting on an element is therefore not enough; we retry until the menu really
 * opens. The `isVisible` guard keeps a retry from toggling an already-open menu
 * back shut. This still fails loudly if the menu never opens.
 */
async function openMenu(trigger: Locator, item: Locator): Promise<void> {
	await expect(async () => {
		if (!(await item.isVisible())) {
			await trigger.click();
		}
		await expect(item).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 15000 });
}

test.describe('planets toggle and export', () => {
	test('exports with layers.planets reflecting toggle state', async ({ page }) => {
		await page.route('**/api/catalog/full*', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([])
			});
		});

		await page.goto('/generator');
		await page.waitForSelector('canvas');

		const exportToggle = page.locator('button.export-toggle');
		await expect(exportToggle).toBeVisible();
		await expect(exportToggle).toBeEnabled();

		let interceptedRequest: any = null;
		await page.route('**/api/export', async (route) => {
			const req = route.request();
			if (req.method() === 'POST') {
				interceptedRequest = JSON.parse(req.postData() || '{}');
			}
			await route.fulfill({
				status: 200,
				contentType: 'image/svg+xml',
				body: '<svg><circle id="planet-mars" data-planet="mars"/></svg>'
			});
		});

		const svgOption = page.locator('button.export-option:has-text("SVG")');
		await openMenu(exportToggle, svgOption);
		await svgOption.click();

		await expect(async () => {
			expect(interceptedRequest).not.toBeNull();
		}).toPass({ timeout: 5000 });

		expect(interceptedRequest?.format).toBe('svg');
		expect(interceptedRequest?.layers?.planets).toBe(false);

		interceptedRequest = null;

		const planetsToggle = page.locator('button[role="switch"]', { hasText: 'Planets' });
		await expect(planetsToggle).toBeVisible();
		await planetsToggle.click();
		await expect(planetsToggle).toHaveAttribute('aria-checked', 'true');

		const exportMain = page.locator('button.export-main');
		await expect(exportMain).toBeVisible();
		await exportMain.click();

		await expect(async () => {
			expect(interceptedRequest).not.toBeNull();
		}).toPass({ timeout: 5000 });

		expect(interceptedRequest?.format).toBe('svg');
		expect(interceptedRequest?.layers?.planets).toBe(true);
	});
});
