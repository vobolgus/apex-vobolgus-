import { expect, test } from '@playwright/test';

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

		await exportToggle.click();

		const svgOption = page.locator('button.export-option:has-text("SVG")');
		await expect(svgOption).toBeVisible();
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