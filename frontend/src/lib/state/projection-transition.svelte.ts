/**
 * Stereographic ↔ pinhole transition state.
 *
 * `blend` is the 0..1 morph parameter consumed by the renderer; the animation
 * itself is evaluated by `getProjectionBlend` on every frame. Switching mode
 * also carries the field of view across, so the visible scale does not jump.
 */

import {
	PINHOLE_FOV_DEG_DEFAULT,
	PROJECTION_TRANSITION_MIN_MS,
	PROJECTION_TRANSITION_MS
} from '$lib/constants';
import { pinholeFovToStereoFov, stereoFovToPinholeFov } from '$lib/math/projection';
import { getProjectionBlend } from '$lib/renderer/canvas-renderer';
import type { ProjectionAnimationState } from '$lib/renderer/types';
import { view } from '$lib/stores.svelte';

export const PROJECTION_OPTIONS = ['stereographic', 'pinhole'] as const;
export type ProjectionMode = (typeof PROJECTION_OPTIONS)[number];

/** Blend deltas below this are snapped instead of animated. */
const BLEND_EPSILON = 0.001;

export class ProjectionTransition {
	mode = $state<ProjectionMode>('stereographic');
	blend = $state(0);
	animating = $state(false);

	private from = 0;
	private to = 0;
	private startMs = 0;
	private durationMs = PROJECTION_TRANSITION_MS;
	/**
	 * What the last switch carried: the field of view it set in `mode` and the one
	 * it left in the other mode. Switching straight back, with no zoom or frame
	 * resize in between, restores the left one, because the carry is clamped at
	 * wide angles and would not round-trip (stereo 180° → pinhole → stereo 123°).
	 */
	private carried: { mode: ProjectionMode; fovDeg: number; leftFovDeg: number } | null = null;

	private get animation(): ProjectionAnimationState {
		return {
			animating: this.animating,
			from: this.from,
			to: this.to,
			startMs: this.startMs,
			durationMs: this.durationMs
		};
	}

	/** True once the pinhole viewport is fully settled (resize handles are live). */
	get isPinholeSettled(): boolean {
		return this.mode === 'pinhole' && this.blend >= 1 - BLEND_EPSILON && !this.animating;
	}

	/** Advance the blend to `nowMs`. Safe to call when idle. */
	tick(nowMs: number) {
		const { blend, animating } = getProjectionBlend(nowMs, this.animation, this.blend);
		this.blend = blend;
		this.animating = animating;
	}

	/** The mode that `toggle()` would switch to. */
	get otherMode(): ProjectionMode {
		return this.mode === 'stereographic' ? 'pinhole' : 'stereographic';
	}

	/**
	 * Start morphing towards `nextMode`, picking the duration from the remaining
	 * blend distance so an interrupted transition does not restart at full length.
	 */
	start(nextMode: ProjectionMode) {
		const targetBlend = nextMode === 'pinhole' ? 1 : 0;
		const nowMs = performance.now();
		this.tick(nowMs);
		const currentBlend = this.blend;

		if (nextMode !== this.mode) this.carryFov(nextMode);
		this.mode = nextMode;

		if (Math.abs(targetBlend - currentBlend) <= BLEND_EPSILON) {
			this.animating = false;
			this.blend = targetBlend;
			return;
		}

		this.from = currentBlend;
		this.to = targetBlend;
		this.startMs = nowMs;
		this.durationMs = Math.max(
			PROJECTION_TRANSITION_MIN_MS,
			PROJECTION_TRANSITION_MS * Math.abs(targetBlend - currentBlend)
		);
		this.animating = true;
		this.blend = currentBlend;
	}

	/**
	 * Carry the field of view into `nextMode` by matching the central scale. Into
	 * pinhole it is capped at the default, which a full-sky stereo view would
	 * exceed: the frame then opens with room to widen, at the cost of a zoom-in
	 * during the morph.
	 */
	private carryFov(nextMode: ProjectionMode) {
		const leftFovDeg = fovDeg(this.mode);
		const carried = this.carried;
		const nextFovDeg =
			carried && carried.mode === this.mode && carried.fovDeg === leftFovDeg
				? carried.leftFovDeg
				: nextMode === 'pinhole'
					? Math.min(stereoFovToPinholeFov(leftFovDeg), PINHOLE_FOV_DEG_DEFAULT)
					: pinholeFovToStereoFov(leftFovDeg);
		if (nextMode === 'pinhole') view.pinholeFovDeg = nextFovDeg;
		else view.stereoFovDeg = nextFovDeg;
		this.carried = { mode: nextMode, fovDeg: nextFovDeg, leftFovDeg };
	}
}

function fovDeg(mode: ProjectionMode): number {
	return mode === 'pinhole' ? view.pinholeFovDeg : view.stereoFovDeg;
}
