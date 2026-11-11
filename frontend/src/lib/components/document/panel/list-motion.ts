/**
 * How the pages panel moves: a page grows into the list as it comes and closes up
 * as it goes, so the panel lengthens and shortens instead of jumping; the panel
 * slides in from the window's edge with its first page and out with its last; a
 * page that Add to PDF went to is flashed and bumped, so the eye finds it; and the
 * charts already on it part for the one flying in.
 *
 * Each is a Web Animation on the element, played from the script. None plays where
 * less motion is asked for, or where there are no animations (jsdom).
 */

import { PDF_FLIGHT_EASING, settleKeyframes, type Landing } from '$lib/document/flight';

/** The list's gap between pages, px, as in the CSS. */
const LIST_GAP_PX = 12;
/** A page's entrance and exit, and the panel's own when its first page brings it. */
const GROW_MS = 260;
const ENTRANCE_MS = 300;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** The panel slid out past the window's left edge, as the CSS has it collapsed. */
const AWAY = 'translateX(calc(-100% - 12px))';

export function reducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The margin a cell's height animation takes the list's gap back through: the one
 * towards its neighbour. Null for a page alone in the list, which has no gap, and
 * whose coming and going is the panel's own slide.
 */
function gapMargin(cell: HTMLElement): 'marginTop' | 'marginBottom' | null {
	if (cell.previousElementSibling) return 'marginTop';
	return cell.nextElementSibling ? 'marginBottom' : null;
}

/**
 * A page that was just added (or brought back by Undo) makes its entrance: its
 * cell grows from nothing, so the panel lengthens instead of jumping. In a list
 * that already scrolls, where a growing cell would fight the scroll position, it
 * fades and scales in instead.
 */
export function growIn(cell: HTMLElement, list: HTMLElement | undefined): void {
	const margin = gapMargin(cell);
	if (!margin || typeof cell.animate !== 'function') return;
	const options = { duration: GROW_MS, easing: EASE };
	const scrolls = list ? list.scrollHeight > list.clientHeight + 1 : false;
	if (scrolls) {
		cell.animate(
			[
				{ opacity: 0, transform: 'scale(0.9)' },
				{ opacity: 1, transform: 'none' }
			],
			options
		);
		return;
	}
	const height = cell.getBoundingClientRect().height;
	// The negative margin takes the list's gap back, so the panel starts from the height it had.
	cell.style.overflow = 'clip';
	const grow = cell.animate(
		[
			{ height: '0px', [margin]: `-${LIST_GAP_PX}px`, opacity: 0 },
			{ height: `${height}px`, [margin]: '0px', opacity: 1 }
		],
		options
	);
	const done = () => (cell.style.overflow = '');
	grow.onfinish = done;
	grow.oncancel = done;
}

/**
 * A page being deleted makes its exit, the entrance run backwards: its cell closes
 * up to nothing and the panel shortens with it. The last page takes the panel
 * along, which slides away to the left as it came. Resolves when the page may be
 * removed; null when there is nothing to show (less motion asked for, or no
 * animations here) and it may go at once.
 */
export function shrinkOut(cell: HTMLElement): Promise<unknown> | null {
	if (reducedMotion() || typeof cell.animate !== 'function') return null;
	const margin = gapMargin(cell);
	let exit: Animation;
	if (!margin) {
		const dock = cell.closest<HTMLElement>('.dock');
		if (!dock) return null;
		exit = dock.animate([{ transform: 'none' }, { transform: AWAY }], {
			duration: ENTRANCE_MS,
			easing: EASE,
			fill: 'forwards'
		});
	} else {
		const height = cell.getBoundingClientRect().height;
		cell.style.overflow = 'clip';
		// Nothing on a page that is going takes a click.
		cell.style.pointerEvents = 'none';
		exit = cell.animate(
			[
				{ height: `${height}px`, [margin]: '0px', opacity: 1 },
				{ height: '0px', [margin]: `-${LIST_GAP_PX}px`, opacity: 0 }
			],
			{ duration: GROW_MS, easing: EASE, fill: 'forwards' }
		);
	}
	// Cancelled (the panel went away under it) is as good as finished.
	return exit.finished.catch(() => undefined);
}

/** The panel's own entrance: it slides out from the window's left edge. */
export function slideIn(dock: HTMLElement): void {
	if (reducedMotion() || typeof dock.animate !== 'function') return;
	dock.animate([{ transform: AWAY }, { transform: 'none' }], {
		duration: ENTRANCE_MS,
		easing: EASE
	});
}

/** A page's ring lit, and its thumbnail bumped (with more motion allowed), after `delay` ms. */
export function flash(cell: HTMLElement, delay: number, bump: boolean): void {
	cell
		.querySelector<HTMLElement>('.flash')
		?.animate?.(
			[{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
			{ duration: 1100, delay, easing: 'ease-out' }
		);
	if (!bump) return;
	cell
		.querySelector<HTMLElement>('.thumb-wrap')
		?.animate?.(
			[
				{ transform: 'scale(1)' },
				{ transform: 'scale(1.08)', offset: 0.35 },
				{ transform: 'scale(1)' }
			],
			{ duration: 560, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
		);
}

/**
 * The charts already on a page make room for the one flying in: each that the
 * Add moved is played from its old place to its new one, over the flight and on
 * its curve, so they part as the copy arrives between them.
 */
export function makeRoom(cell: HTMLElement, landing: Landing): void {
	if (!landing.before) return;
	for (const chart of cell.querySelectorAll<HTMLElement>('.chart')) {
		const id = chart.dataset.itemId;
		const before = id && id !== landing.itemId ? landing.before[id] : undefined;
		if (!before || typeof chart.animate !== 'function') continue;
		const frames = settleKeyframes(before, chart.getBoundingClientRect());
		if (frames) chart.animate(frames, { duration: landing.ms, easing: PDF_FLIGHT_EASING });
	}
}
