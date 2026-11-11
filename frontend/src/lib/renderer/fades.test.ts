import { describe, expect, it } from 'vitest';

import { advanceStarFade, makeStarFade, STAR_FADE_MS } from './fades';

describe('advanceStarFade', () => {
	it('fades in the stars a frame brings, from none to all of them', () => {
		const fade = makeStarFade();
		advanceStarFade(fade, 500, 1000, false);
		expect(fade).toMatchObject({ count: 500, from: 0, progress: 0 });

		advanceStarFade(fade, 500, 1000 + STAR_FADE_MS / 2, false);
		expect(fade.progress).toBeGreaterThan(0.5);
		expect(fade.progress).toBeLessThan(1);

		advanceStarFade(fade, 500, 1000 + STAR_FADE_MS, false);
		expect(fade.progress).toBe(1);
	});

	it('fades in only the fainter stars when the full catalog replaces the bright one', () => {
		const fade = makeStarFade();
		advanceStarFade(fade, 500, 0, false);
		advanceStarFade(fade, 500, STAR_FADE_MS, false);
		expect(fade.progress).toBe(1);

		advanceStarFade(fade, 8870, 2000, false);
		// The 500 already on the chart stay as they are.
		expect(fade).toMatchObject({ count: 8870, from: 500, progress: 0 });
		advanceStarFade(fade, 8870, 2000 + STAR_FADE_MS, false);
		expect(fade.progress).toBe(1);
	});

	it('never goes backwards while it runs', () => {
		const fade = makeStarFade();
		advanceStarFade(fade, 100, 0, false);
		let last = fade.progress;
		for (let now = 16; now <= STAR_FADE_MS + 32; now += 16) {
			advanceStarFade(fade, 100, now, false);
			expect(fade.progress).toBeGreaterThanOrEqual(last);
			last = fade.progress;
		}
		expect(last).toBe(1);
	});

	it('shows the stars at once when the system asks for less motion, or when stars are taken away', () => {
		const reduced = makeStarFade();
		advanceStarFade(reduced, 500, 0, true);
		expect(reduced.progress).toBe(1);

		const fewer = makeStarFade();
		advanceStarFade(fewer, 500, 0, false);
		advanceStarFade(fewer, 100, 10, false);
		expect(fewer).toMatchObject({ count: 100, progress: 1 });
	});
});
