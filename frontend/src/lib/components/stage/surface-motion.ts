/**
 * The chart's move to its new place when a panel opens or closes beside it.
 *
 * A panel changes what room the chart has, and the chart is laid out in its new
 * place at once. It is then played there from where it was (first, last, invert,
 * play): a transform alone, which the compositor runs without laying the page out
 * or scaling the canvas again on every frame. A window resize changes no reserve
 * and so moves the chart directly, as it should.
 */

import { tick } from 'svelte';

/** How long the chart takes to move to its new place when a panel opens or closes. */
const CHART_MOVE_MS = 260;

/** Play `surface` from where it is now to where the next update lays it out. */
export function moveToNextLayout(surface: HTMLElement): void {
	// Before the DOM takes the new reserves: where the chart is now, mid-move or not.
	const first = surface.getBoundingClientRect();
	void tick().then(() => {
		surface.getAnimations().forEach((animation) => animation.cancel());
		const last = surface.getBoundingClientRect();
		if (last.width <= 0) return;
		const scale = first.width / last.width;
		const dx = first.left + first.width / 2 - (last.left + last.width / 2);
		const dy = first.top + first.height / 2 - (last.top + last.height / 2);
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.002) return;
		surface.animate(
			[{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }],
			{ duration: CHART_MOVE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
		);
	});
}
