import { expect, test } from '@playwright/test';

/**
 * The app is one screen. A pinch zooms the sky on the chart and nothing anywhere
 * else: left to the browser it would zoom the page itself, which then pans under
 * two fingers with its far edges out of the window.
 */
test('a pinch off the chart is not left to the browser, which would zoom the page; a scroll is', async ({
	page
}) => {
	await page.goto('/');
	await page.waitForSelector('canvas');

	const pinched = () =>
		page.evaluate(() => {
			const event = new Event('gesturestart', { bubbles: true, cancelable: true });
			document.body.dispatchEvent(event);
			return event.defaultPrevented;
		});
	// Once the app is up and listening.
	await expect.poll(pinched).toBe(true);

	const taken = await page.evaluate(() => {
		const fire = (target: Element, event: Event) => {
			target.dispatchEvent(event);
			return event.defaultPrevented;
		};
		const off = document.querySelector('aside') ?? document.body;
		const options = { bubbles: true, cancelable: true };
		return {
			// Safari tells of a pinch in gesture events of its own.
			gestures: ['gesturestart', 'gesturechange', 'gestureend'].map((type) =>
				fire(off, new Event(type, options))
			),
			// The others, as a wheel with Ctrl held.
			pinch: fire(off, new WheelEvent('wheel', { ...options, ctrlKey: true, deltaY: -12 })),
			scroll: fire(off, new WheelEvent('wheel', { ...options, deltaY: 12 }))
		};
	});

	expect(taken.gestures).toEqual([true, true, true]);
	expect(taken.pinch).toBe(true);
	expect(taken.scroll).toBe(false);
});
