/**
 * What the renderer fades by itself, frame by frame: the stars as they arrive, and
 * each reference line as it is switched on or off. Plain state advanced with the
 * frame's time; the renderer keeps one of each and asks for frames while they run.
 */

import { clamp, easeInOutCubic, lerp } from '../math/easing';

/** A reference line fades in or out over this as it is switched. */
const LINE_ANIM_DURATION_MS = 720;
/** Stars that arrive (the first load, then the faint ones of the full catalog) fade in over this. */
export const STAR_FADE_MS = 320;

/**
 * Which stars are fading in, and how far along. The catalog arrives in two stages,
 * brightest first, and the second is the first with the fainter stars appended, so
 * "the new ones" are those from `from` on.
 */
interface StarFade {
	/** How many stars the last frame had. */
	count: number;
	/** Stars from this index on are the ones fading in. */
	from: number;
	startedAt: number;
	/** 0..1; 1 when every star is fully there. */
	progress: number;
}

export function makeStarFade(): StarFade {
	return { count: 0, from: 0, startedAt: 0, progress: 1 };
}

/**
 * Advance `fade` for a frame at `nowMs` drawing `count` stars. More stars than
 * the last frame had start a fade of the new ones; with `reduceMotion` they are
 * simply there.
 */
export function advanceStarFade(
	fade: StarFade,
	count: number,
	nowMs: number,
	reduceMotion: boolean
): void {
	if (count !== fade.count) {
		if (count > fade.count && !reduceMotion) {
			fade.from = fade.count;
			fade.startedAt = nowMs;
			fade.progress = 0;
		} else {
			// Fewer stars (a reload that failed half way), or no animation wanted.
			fade.progress = 1;
		}
		fade.count = count;
	}
	if (fade.progress < 1) {
		const t = clamp((nowMs - fade.startedAt) / STAR_FADE_MS, 0, 1);
		// Ease out: most of the light comes up early, the tail is gentle.
		fade.progress = 1 - (1 - t) * (1 - t);
	}
}

/** A reference line's fade in or out, as it is switched on or off. */
export interface LineAnimState {
	target: boolean;
	progress: number;
	animating: boolean;
	startedAt: number;
	fromProgress: number;
}

export function makeLineAnim(): LineAnimState {
	return {
		target: false,
		progress: 0,
		animating: false,
		startedAt: 0,
		fromProgress: 0
	};
}

/** Advance `anim` for a frame at `nowMs`, its line now switched to `target`. */
export function updateLineAnim(anim: LineAnimState, target: boolean, nowMs: number): void {
	if (anim.target !== target) {
		anim.target = target;
		anim.fromProgress = anim.progress;
		anim.startedAt = nowMs;
		anim.animating = true;
	}
	if (!anim.animating) return;
	const elapsed = nowMs - anim.startedAt;
	const t = clamp(elapsed / LINE_ANIM_DURATION_MS, 0, 1);
	const eased = easeInOutCubic(t);
	const targetProgress = target ? 1 : 0;
	anim.progress = lerp(anim.fromProgress, targetProgress, eased);
	if (t >= 1) {
		anim.progress = targetProgress;
		anim.animating = false;
	}
}
