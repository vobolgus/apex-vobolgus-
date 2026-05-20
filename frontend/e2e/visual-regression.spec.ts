import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Baseline visual regression suite for the generator page.
 *
 * Five baselines guard the projection morph animation and the arcball drag:
 *   1. stereographic-initial   — default load (stereographic disc)
 *   2. pinhole-initial         — after stereo → pinhole, animation settled
 *   3. stereo-to-pinhole-mid   — mid-transition (~t=0.5 of 620ms)
 *   4. pinhole-to-stereo-mid   — mid-transition while returning to stereo
 *   5. rotated                 — stereographic + arcball drag applied
 *
 * Subsequent refactor passes MUST keep these screenshots stable
 * (within the configured maxDiffPixelRatio).
 */

const VIEWPORT = { width: 1280, height: 800 } as const;
const CATALOG_LOAD_MS = 2500;
const ANIMATION_TOTAL_MS = 1200;
const ANIMATION_MID_MS = 310;

async function gotoGenerator(page: Page): Promise<Locator> {
	await page.setViewportSize({ ...VIEWPORT });
	await page.goto('/generator');
	await page.waitForSelector('canvas');
	const canvas = page.locator('canvas').first();
	await expect(canvas).toBeVisible();

	// Allow `/api/catalog/full` to load (~9000 stars) and the first frame to
	// settle. The page issues catalog requests on mount and only paints once
	// the layered loader resolves.
	await page.waitForLoadState('networkidle').catch(() => undefined);
	await page.waitForTimeout(CATALOG_LOAD_MS);

	return canvas;
}

async function openProjectionMenu(page: Page) {
	const trigger = page.locator('button[aria-haspopup="listbox"]');
	await expect(trigger).toBeVisible();
	const expanded = await trigger.getAttribute('aria-expanded');
	if (expanded !== 'true') {
		await trigger.click();
	}
	await page.waitForSelector('[role="option"]');
}

async function selectProjection(page: Page, name: 'stereographic' | 'pinhole') {
	await openProjectionMenu(page);
	const target = name.toLowerCase();
	const option = page
		.locator('[role="option"]')
		.filter({ hasText: new RegExp(target, 'i') })
		.first();
	await expect(option).toBeVisible();
	await option.click();
}

async function dragCanvas(page: Page, canvas: Locator) {
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	const startX = box.x + box.width / 2;
	const startY = box.y + box.height / 2;

	await page.mouse.move(startX, startY);
	await page.mouse.down();
	for (let i = 1; i <= 5; i += 1) {
		await page.mouse.move(startX + i * 30, startY + i * 14, { steps: 4 });
	}
	await page.mouse.up();
}

test.describe('generator visual regression', () => {
	test('stereographic-initial', async ({ page }) => {
		await gotoGenerator(page);
		await expect(page).toHaveScreenshot('stereographic-initial.png', {
			maxDiffPixelRatio: 0.001
		});
	});

	test('pinhole-initial', async ({ page }) => {
		await gotoGenerator(page);
		await selectProjection(page, 'pinhole');
		await page.waitForTimeout(ANIMATION_TOTAL_MS);
		await expect(page).toHaveScreenshot('pinhole-initial.png', {
			maxDiffPixelRatio: 0.001
		});
	});

	test('stereo-to-pinhole-mid', async ({ page }) => {
		await gotoGenerator(page);
		await selectProjection(page, 'pinhole');
		await page.waitForTimeout(ANIMATION_MID_MS);
		const buffer = await page.screenshot({ animations: 'allow' });
		expect(buffer).toMatchSnapshot('stereo-to-pinhole-mid.png', {
			// Mid-transition screenshot lands on a slightly different animation frame
			// run-to-run; observed natural diff is ~5400 px (ratio 0.01). The 0.02 budget
			// keeps it stable while still catching real regressions.
			maxDiffPixelRatio: 0.02
		});
	});

	test('pinhole-to-stereo-mid', async ({ page }) => {
		await gotoGenerator(page);
		await selectProjection(page, 'pinhole');
		await page.waitForTimeout(ANIMATION_TOTAL_MS);
		await selectProjection(page, 'stereographic');
		await page.waitForTimeout(ANIMATION_MID_MS);
		const buffer = await page.screenshot({ animations: 'allow' });
		expect(buffer).toMatchSnapshot('pinhole-to-stereo-mid.png', {
			// Same mid-transition flake budget as stereo-to-pinhole-mid (see above).
			maxDiffPixelRatio: 0.02
		});
	});

	test('rotated', async ({ page }) => {
		const canvas = await gotoGenerator(page);
		await dragCanvas(page, canvas);
		await page.waitForTimeout(200);
		await expect(page).toHaveScreenshot('rotated.png', {
			maxDiffPixelRatio: 0.001
		});
	});
});
