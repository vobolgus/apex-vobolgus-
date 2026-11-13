import { expect, test, type Page } from '@playwright/test';

/**
 * What moves by itself: the sky's glide after a drag, the eased wheel zoom, the
 * flight to a pasted link, stars fading in, the layers panel's slide with the
 * chart beside it, the export button's states, the toast's exit and the chart's
 * flight to its page. Each is caught in motion, then at rest; and with less
 * motion asked for, none of it happens.
 */

const VIEW = '#p=stereo&ra=80&dec=10&pa=0&fov=120';
const OTHER_VIEW = '#p=stereo&ra=200&dec=-30&pa=40&fov=60';

async function gotoGenerator(page: Page, hash = '') {
	await page.goto(`/${hash}`);
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
	// The stars have arrived and finished fading in.
	await page.waitForTimeout(500);
}

/** A number that changes when the chart's pixels do, and how much ink is on it. */
async function chartInk(page: Page): Promise<{ sum: number; ink: number }> {
	return page.evaluate(() => {
		const canvas = document.querySelector('canvas')!;
		const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
		let sum = 0;
		let ink = 0;
		// Every pixel of every third row: fine enough to see one star move.
		for (let y = 0; y < canvas.height; y += 3) {
			for (let x = 0; x < canvas.width; x += 1) {
				const i = (y * canvas.width + x) * 4;
				const dark = 255 - data[i];
				ink += dark;
				sum = (sum + dark * ((x % 251) + 1) * ((y % 241) + 1)) % 2147483647;
			}
		}
		return { sum, ink };
	});
}

async function flick(page: Page) {
	const box = (await page.locator('canvas').boundingBox())!;
	const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
	await page.mouse.move(cx - 80, cy);
	await page.mouse.down();
	for (let i = 1; i <= 8; i += 1) await page.mouse.move(cx - 80 + i * 18, cy + i * 4);
	await page.mouse.up();
}

test('the sky glides on after a flick and comes to rest', async ({ page }) => {
	await gotoGenerator(page, VIEW);
	await flick(page);
	const justAfter = await chartInk(page);
	await page.waitForTimeout(150);
	const gliding = await chartInk(page);
	expect(gliding.sum).not.toBe(justAfter.sum);

	await page.waitForTimeout(1800);
	const rested = await chartInk(page);
	await page.waitForTimeout(250);
	expect((await chartInk(page)).sum).toBe(rested.sum);
});

test('a drag that stops before it is let go leaves the sky where it was put', async ({ page }) => {
	await gotoGenerator(page, VIEW);
	const box = (await page.locator('canvas').boundingBox())!;
	const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
	await page.mouse.move(cx - 80, cy);
	await page.mouse.down();
	await page.mouse.move(cx + 60, cy + 20, { steps: 8 });
	await page.waitForTimeout(250);
	await page.mouse.up();
	const released = await chartInk(page);
	await page.waitForTimeout(300);
	expect((await chartInk(page)).sum).toBe(released.sum);
});

test('the wheel zooms smoothly to where it was sent', async ({ page }) => {
	await gotoGenerator(page, VIEW);
	const box = (await page.locator('canvas').boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const before = await chartInk(page);
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, -300);
	await page.keyboard.up('Control');
	await page.waitForTimeout(40);
	const easing = await chartInk(page);
	await page.waitForTimeout(700);
	const landed = await chartInk(page);
	// It was on its way a moment after the wheel turned, and went further.
	expect(easing.sum).not.toBe(before.sum);
	expect(landed.sum).not.toBe(easing.sum);
	// 120° · e^(−0.75), written to the address once it has come to rest.
	await expect.poll(() => new URL(page.url()).hash).toContain('fov=56.68');
});

test('a link pasted into the open tab is flown to, and lands exactly on it', async ({
	page,
	context
}) => {
	await gotoGenerator(page, VIEW);
	const start = await chartInk(page);
	await page.evaluate((hash) => (window.location.hash = hash), OTHER_VIEW);
	await page.waitForTimeout(200);
	const inFlight = await chartInk(page);
	expect(inFlight.sum).not.toBe(start.sum);

	await page.waitForTimeout(1000);
	const landed = await chartInk(page);
	expect(landed.sum).not.toBe(inFlight.sum);

	// The same chart as a page opened straight on that link.
	const direct = await context.newPage();
	await gotoGenerator(direct, OTHER_VIEW);
	expect(landed.sum).toBe((await chartInk(direct)).sum);
});

test('the full catalogue fades in over the bright stars', async ({ page }) => {
	// Hold the full catalogue back, so the two stages can be told apart.
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/api/catalog/full*', async (route) => {
		await held;
		await route.continue();
	});
	await page.goto(`/${VIEW}`);
	await page.waitForSelector('canvas');
	await expect.poll(async () => (await chartInk(page)).ink, { timeout: 15000 }).toBeGreaterThan(0);
	await page.waitForTimeout(500);
	const bright = await chartInk(page);

	release();
	// More ink than the bright stars alone, and less than the full sky: the faint ones are part way in.
	let partWay = bright.ink;
	await expect
		.poll(async () => (partWay = (await chartInk(page)).ink), { intervals: [20], timeout: 5000 })
		.toBeGreaterThan(bright.ink);
	await page.waitForTimeout(600);
	const full = await chartInk(page);
	expect(full.ink).toBeGreaterThan(partWay);
});

test('the layers panel slides in, and in a narrow window the chart moves with it', async ({
	page
}) => {
	await page.setViewportSize({ width: 1000, height: 760 });
	await gotoGenerator(page, VIEW);
	const canvas = page.locator('canvas');
	const panel = page.locator('#layers-panel');
	const before = (await canvas.boundingBox())!;

	await page.getByRole('button', { name: /^Layers/ }).click();
	await page.waitForTimeout(70);
	const midChart = (await canvas.boundingBox())!;
	const midPanel = (await panel.boundingBox())!;
	await page.waitForTimeout(400);
	const endChart = (await canvas.boundingBox())!;
	const endPanel = (await panel.boundingBox())!;

	// Both were between where they started and where they ended.
	expect(midPanel.x).toBeGreaterThan(endPanel.x);
	expect(midChart.x).toBeLessThan(before.x);
	expect(midChart.x).toBeGreaterThan(endChart.x);
	expect(endChart.x + endChart.width).toBeLessThanOrEqual(endPanel.x);
});

test('the export button turns only for a slow export, and shows a check when a file is saved', async ({
	page
}) => {
	let delayMs = 0;
	await page.route('**/api/export?*', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg/>' });
	});
	await gotoGenerator(page, VIEW);
	const main = page.locator('button.export-main');
	const svg = page.locator('button.export-option:has-text("SVG")');
	await expect(async () => {
		if (!(await svg.isVisible())) await page.locator('button.export-toggle').click();
		await expect(svg).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 15000 });

	// A quick export, as nearly all are: the ring never shows, the check does.
	const sawRing = main.evaluate(
		(button) =>
			new Promise<boolean>((resolve) => {
				let seen = false;
				const observer = new MutationObserver(() => {
					if (button.querySelector('.export-spinner')) seen = true;
					if (button.querySelector('.export-done')) {
						observer.disconnect();
						resolve(seen);
					}
				});
				observer.observe(button, { childList: true, subtree: true });
			})
	);
	await svg.click();
	expect(await sawRing).toBe(false);
	await expect(main.locator('.export-done')).toBeVisible();
	await expect(main.locator('.export-done')).toBeHidden({ timeout: 4000 });

	// One that takes its time: the ring turns until the file is there.
	delayMs = 1500;
	await main.click();
	await expect(main.locator('.export-spinner')).toBeVisible();
	await expect(main).toHaveAttribute('aria-busy', 'true');
	await expect(main.locator('.export-done')).toBeVisible();
	await expect(main).toHaveAttribute('aria-busy', 'false');
});

test('the layer count bumps, the notice arrives and the toast leaves', async ({ page }) => {
	await page.route('**/api/constellations', (route) => route.fulfill({ status: 502, body: '' }));
	await gotoGenerator(page, VIEW);
	// The catalogue notice came in with its entrance animation.
	const notice = page.locator('.catalog-notice');
	await expect(notice).toBeVisible();
	expect(await notice.evaluate((el) => getComputedStyle(el).animationName)).toContain(
		'catalog-notice-in'
	);

	// A layer turned on from the link of another view: the count animates.
	const badge = page.locator('.badge');
	await page.evaluate(
		() => (window.location.hash = '#p=stereo&ra=80&dec=10&pa=0&fov=120&layers=ecliptic')
	);
	await expect
		.poll(() => badge.evaluate((el) => el.getAnimations().length), { intervals: [10] })
		.toBeGreaterThan(0);
	await expect(badge).toHaveText('1');

	// A toast that is dismissed leaves, then is gone.
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	const toast = page.locator('.toast');
	await expect(toast).toBeVisible();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('.toast.leaving')).toBeVisible();
	await expect(toast).toHaveCount(0);
});

test('Add to PDF flies a copy of the chart to its place on the page, which is drawn as it lands', async ({
	page
}) => {
	await gotoGenerator(page, VIEW);
	const chart = (await page.locator('canvas').first().boundingBox())!;
	const add = page.getByRole('button', { name: 'Add to PDF' });
	await add.click();

	// The page is there at once, with the chart's place on it still empty.
	const copy = page.locator('.pdf-flight');
	const place = page.locator('.chart-area ol .chart');
	await expect(copy).toBeVisible();
	await expect(place).toHaveCount(1);
	await expect(place.locator('canvas')).toHaveCount(0);

	await page.waitForTimeout(250);
	const midAir = (await copy.boundingBox())!;
	// On its way to the pages panel on the left, and smaller than the chart it left.
	expect(midAir.x + midAir.width / 2).toBeLessThan(chart.x + chart.width / 2);
	expect(midAir.width).toBeLessThan(chart.width * 0.92);

	// It lands and is gone, and the thumbnail has drawn the chart.
	await expect(copy).toHaveCount(0);
	await expect(place.locator('canvas')).toHaveCount(1);

	// A second chart goes to its own place on the same page: the copy stops exactly there.
	const landed = page.evaluate(
		() =>
			new Promise<number[]>((resolve) => {
				const watch = () => {
					const flying = document.querySelector('.pdf-flight');
					if (!flying) return requestAnimationFrame(watch);
					const move = flying.getAnimations().find((animation) => {
						const effect = animation.effect as KeyframeEffect | null;
						return effect?.getKeyframes().some((frame) => 'transform' in frame);
					});
					move!.finished.then(() => {
						const r = flying.getBoundingClientRect();
						resolve([r.x, r.y, r.width, r.height]);
					});
				};
				watch();
			})
	);
	// The chart already on the page has the sheet to itself; it will move up to make room.
	const first = place.first();
	const alone = (await first.boundingBox())!;
	await add.click();
	await page.waitForTimeout(220);
	const making = (await first.boundingBox())!;
	const copyBox = await landed;
	await expect(copy).toHaveCount(0);
	await expect(place.locator('canvas')).toHaveCount(2);
	// Its place is measured at rest: as the copy lands the page is bumped (to 1.08 of
	// its size and back), and a place read then is off by as much as the bump has got
	// to, which is the machine's pace and not the flight's aim.
	await expect
		.poll(async () => {
			const at = (await place.last().boundingBox())!;
			const placeBox = [at.x, at.y, at.width, at.height];
			return Math.max(...copyBox.map((side, i) => Math.abs(side - placeBox[i])));
		})
		.toBeLessThan(1.5);
	// It moved as the copy flew: part of the way while the copy was in the air, the rest by landing.
	await page.waitForTimeout(700);
	const settled = (await first.boundingBox())!;
	expect(settled.y).toBeLessThan(alone.y);
	expect(settled.width).toBeLessThan(alone.width);
	expect(making.width).toBeLessThan(alone.width);
	expect(making.width).toBeGreaterThan(settled.width);
});

test('hovering a page does not move its neighbours', async ({ page }) => {
	await gotoGenerator(page, VIEW);
	const add = page.getByRole('button', { name: 'Add to PDF' });
	// Wide frames take a page each.
	await page.keyboard.press('Shift+P');
	await page.waitForTimeout(900);
	for (let i = 0; i < 3; i += 1) {
		await add.click();
		await expect(page.locator('.pdf-flight')).toHaveCount(0);
	}
	const list = page.locator('.chart-area ol');
	const thumbs = list.locator('.thumb');
	await expect(thumbs).toHaveCount(3);
	await page.waitForTimeout(1300);
	const widths = () => list.evaluate((el) => [el.scrollWidth, el.clientWidth]);
	const xs = () => thumbs.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
	const [restWidths, rest] = [await widths(), await xs()];

	await thumbs.nth(1).hover();
	await page.waitForTimeout(350);
	// The lifted page and its ⊖ stay inside the list: its scrollable width does not grow,
	// which is what shifted the other pages.
	expect(await widths()).toEqual(restWidths);
	const hovered = await xs();
	expect(hovered[0]).toBe(rest[0]);
	expect(hovered[2]).toBe(rest[2]);
});

test('a deleted page closes up and the panel shortens with it; Undo brings it back the same way', async ({
	page
}) => {
	await gotoGenerator(page, VIEW);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	const pages = panel.getByRole('button', { name: /^Page \d+, / });
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await expect(page.locator('.pdf-flight')).toHaveCount(0);
	await panel.getByRole('button', { name: 'Add page' }).click();
	await expect(pages).toHaveCount(2);
	await page.waitForTimeout(700);
	const height = async () => (await panel.boundingBox())!.height;
	const tall = await height();

	await pages.nth(1).hover();
	await panel.getByRole('button', { name: 'Delete page 2' }).click();
	await page.waitForTimeout(110);
	// Part of the way: neither the height it had nor the one it ends at.
	const closing = await height();
	await expect(pages).toHaveCount(1);
	await page.waitForTimeout(150);
	const short = await height();
	expect(short).toBeLessThan(tall);
	expect(closing).toBeLessThan(tall);
	expect(closing).toBeGreaterThan(short);

	// Undo: it grows back in.
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(pages).toHaveCount(2);
	await page.waitForTimeout(110);
	const opening = await height();
	await page.waitForTimeout(400);
	expect(await height()).toBeCloseTo(tall, 0);
	expect(opening).toBeGreaterThan(short);
	expect(opening).toBeLessThan(tall);
});

test('⊕ adds a page quietly: it grows in, and is not hovered until the pointer moves', async ({
	page
}) => {
	await gotoGenerator(page, VIEW);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	const pages = panel.getByRole('button', { name: /^Page \d+, / });
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await expect(page.locator('.pdf-flight')).toHaveCount(0);
	await page.waitForTimeout(900);

	const plus = panel.getByRole('button', { name: 'Add page' });
	const at = (await plus.boundingBox())!;
	const [x, y] = [at.x + at.width / 2, at.y + at.height / 2];
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.up();
	await expect(pages).toHaveCount(2);
	await page.waitForTimeout(700);

	// The new page lies where ⊕ was, under a pointer that has not moved.
	const cell = panel.locator('li').nth(1);
	const state = () =>
		cell.evaluate((el) => {
			const wrap = el.querySelector('.thumb-wrap')!;
			const remove = el.querySelector('.remove')!;
			const r = el.getBoundingClientRect();
			return {
				hovered: el.matches(':hover'),
				lifted: getComputedStyle(wrap).transform,
				remove: Number(getComputedStyle(remove).opacity),
				// The flash and the bump are Add to PDF's: nothing of the kind runs here.
				running: [wrap, el.querySelector('.flash')!].flatMap((node) => node.getAnimations()).length,
				box: [r.left, r.top, r.right, r.bottom]
			};
		});
	const quiet = await state();
	expect(quiet.box[0] <= x && x <= quiet.box[2] && quiet.box[1] <= y && y <= quiet.box[3]).toBe(
		true
	);
	expect(quiet.hovered).toBe(true);
	expect(quiet.lifted).toBe('none');
	expect(quiet.remove).toBe(0);
	expect(quiet.running).toBe(0);

	// The pointer moves: now it is hovered like any page.
	await page.mouse.move(x + 8, y + 6, { steps: 3 });
	await expect.poll(async () => (await state()).remove).toBe(1);
	expect((await state()).lifted).not.toBe('none');
});

test('deleting the last page slides the panel away', async ({ page }) => {
	await gotoGenerator(page, VIEW);
	const panel = page.getByRole('complementary', { name: 'PDF pages' });
	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await expect(page.locator('.pdf-flight')).toHaveCount(0);
	await page.waitForTimeout(700);
	const rest = (await panel.boundingBox())!;

	await panel.getByRole('button', { name: /^Page 1, / }).hover();
	await panel.getByRole('button', { name: 'Delete page 1' }).click();
	await page.waitForTimeout(120);
	// On its way out to the left, still there.
	const leaving = await panel.boundingBox();
	expect(leaving).not.toBeNull();
	expect(leaving!.x).toBeLessThan(rest.x);
	await expect(panel).toHaveCount(0);
});

test('with less motion asked for, nothing glides, slides or flies', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 1000, height: 760 });
	await gotoGenerator(page, VIEW);

	await flick(page);
	const released = await chartInk(page);
	await page.waitForTimeout(250);
	expect((await chartInk(page)).sum).toBe(released.sum);

	// A pasted link is a cut, not a flight.
	await page.evaluate((hash) => (window.location.hash = hash), OTHER_VIEW);
	await page.waitForTimeout(80);
	const cut = await chartInk(page);
	await page.waitForTimeout(400);
	expect((await chartInk(page)).sum).toBe(cut.sum);

	// The panel and the chart are in place at once.
	const canvas = page.locator('canvas');
	await page.getByRole('button', { name: /^Layers/ }).click();
	await page.waitForTimeout(50);
	const soon = (await canvas.boundingBox())!;
	await page.waitForTimeout(350);
	expect((await canvas.boundingBox())!.x).toBe(soon.x);

	await page.getByRole('button', { name: 'Add to PDF' }).click();
	await expect(page.getByRole('button', { name: 'Page 1, 1 chart' })).toBeVisible();
	await expect(page.locator('.pdf-flight')).toHaveCount(0);
});
