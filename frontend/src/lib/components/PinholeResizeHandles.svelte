<script lang="ts">
	import {
		CHART_RADIUS_FRAC,
		MAX_FOV_DEG_PINHOLE,
		MIN_FOV_DEG_PINHOLE,
		PINHOLE_ASPECT_RATIO_MAX,
		PINHOLE_ASPECT_RATIO_MIN,
		PINHOLE_HEIGHT_FRAC_MAX,
		PINHOLE_HEIGHT_FRAC_MIN
	} from '$lib/constants';
	import { clamp } from '$lib/math/easing';
	import { resizePinholeWidthKeepStars } from '$lib/math/projection';
	import { view } from '$lib/stores.svelte';
	import { onDestroy } from 'svelte';

	interface Props {
		viewportWidthPx: number;
		viewportHeightPx: number;
		visible: boolean;
		onChange: () => void;
	}

	const props: Props = $props();

	let frameEl: HTMLDivElement | null = $state(null);
	let moveable: MoveableHandle | null = null;
	let shiftHeld = $state(false);

	type MoveableResizeStartEvent = {
		setFixedDirection?: (dir: number[]) => void;
	};
	type MoveableResizeEvent = {
		width: number;
		height: number;
		inputEvent?: { shiftKey?: boolean };
	};
	type MoveableHandle = {
		on: (event: string, listener: (e: never) => void) => void;
		updateRect: () => void;
		destroy: () => void;
	};
	type MoveableCtor = new (
		container: HTMLElement,
		options: Record<string, unknown>
	) => MoveableHandle;

	function clampFov(fov: number) {
		return clamp(fov, MIN_FOV_DEG_PINHOLE, MAX_FOV_DEG_PINHOLE);
	}
	function clampAspect(aspect: number) {
		return clamp(aspect, PINHOLE_ASPECT_RATIO_MIN, PINHOLE_ASPECT_RATIO_MAX);
	}

	const MAX_DIMENSION_FRAC = 1 / CHART_RADIUS_FRAC;

	function applyWidthFracKeepingStars(desiredWidthFrac: number) {
		const clampedWidthFrac = Math.min(desiredWidthFrac, MAX_DIMENSION_FRAC);
		const startFov = view.pinholeFovDeg;
		const startAspect = view.pinholeAspectRatio;
		const startHeightFrac = view.pinholeHeightFrac;
		const resized = resizePinholeWidthKeepStars(
			startFov,
			startAspect,
			startHeightFrac,
			clampedWidthFrac,
			clampFov,
			clampAspect
		);
		view.pinholeFovDeg = resized.pinholeFovDeg;
		const appliedWidthFrac = resized.pinholeAspectRatio * startHeightFrac;
		view.pinholeAspectRatio = appliedWidthFrac / startHeightFrac;
	}

	function applyHeightFrac(nextHeightFrac: number) {
		const clamped = clamp(
			nextHeightFrac,
			PINHOLE_HEIGHT_FRAC_MIN,
			Math.min(PINHOLE_HEIGHT_FRAC_MAX, MAX_DIMENSION_FRAC)
		);
		const currentWidthFrac = view.pinholeAspectRatio * view.pinholeHeightFrac;
		view.pinholeHeightFrac = clamped;
		view.pinholeAspectRatio = currentWidthFrac / clamped;
	}

	let dragSnapshot: {
		startWidthFrac: number;
		startHeightFrac: number;
		startFov: number;
		startAspect: number;
		startWidthPx: number;
		startHeightPx: number;
		pxPerWidthFrac: number;
		pxPerHeightFrac: number;
	} | null = null;

	function handleResizeStart(event: MoveableResizeStartEvent) {
		const startWidthFrac = view.pinholeAspectRatio * view.pinholeHeightFrac;
		const startHeightFrac = view.pinholeHeightFrac;
		const startWidthPx = props.viewportWidthPx;
		const startHeightPx = props.viewportHeightPx;
		dragSnapshot = {
			startWidthFrac,
			startHeightFrac,
			startFov: view.pinholeFovDeg,
			startAspect: view.pinholeAspectRatio,
			startWidthPx,
			startHeightPx,
			pxPerWidthFrac: startWidthFrac > 0 ? startWidthPx / startWidthFrac : 1,
			pxPerHeightFrac: startHeightFrac > 0 ? startHeightPx / startHeightFrac : 1
		};
		// Fix the geometric center → both opposing edges grow/shrink symmetrically,
		// so the frame stays centered no matter which handle is grabbed.
		event.setFixedDirection?.([0, 0]);
	}

	function handleResize(event: MoveableResizeEvent) {
		if (!dragSnapshot) return;
		shiftHeld = !!event.inputEvent?.shiftKey;

		const nextWidthPx = Math.max(event.width, 4);
		const nextHeightPx = Math.max(event.height, 4);

		let nextWidthFrac = nextWidthPx / dragSnapshot.pxPerWidthFrac;
		let nextHeightFrac = nextHeightPx / dragSnapshot.pxPerHeightFrac;

		if (shiftHeld) {
			const widthDeltaAbs = Math.abs(nextWidthPx - dragSnapshot.startWidthPx);
			const heightDeltaAbs = Math.abs(nextHeightPx - dragSnapshot.startHeightPx);
			const target = widthDeltaAbs > heightDeltaAbs ? nextWidthFrac : nextHeightFrac;
			nextWidthFrac = target;
			nextHeightFrac = target;
		}

		// applyWidthFracKeepingStars and applyHeightFrac both read current state,
		// so reset to the drag-start baseline first to keep conversions deterministic.
		view.pinholeFovDeg = dragSnapshot.startFov;
		view.pinholeAspectRatio = dragSnapshot.startAspect;
		view.pinholeHeightFrac = dragSnapshot.startHeightFrac;
		applyWidthFracKeepingStars(nextWidthFrac);
		applyHeightFrac(nextHeightFrac);
		// Moveable re-reads target.getBoundingClientRect() on every pointermove.
		// Write the computed pixel size directly to the DOM so Moveable sees the
		// update immediately, without a full Svelte flushSync() (which forces
		// layout reflow on every pointermove and causes visible lag).
		const finalWidthPx =
			view.pinholeAspectRatio * view.pinholeHeightFrac * dragSnapshot.pxPerWidthFrac;
		const finalHeightPx = view.pinholeHeightFrac * dragSnapshot.pxPerHeightFrac;
		if (frameEl) {
			frameEl.style.width = `${finalWidthPx}px`;
			frameEl.style.height = `${finalHeightPx}px`;
		}
		props.onChange();
	}

	function handleResizeEnd() {
		dragSnapshot = null;
		shiftHeld = false;
		moveable?.updateRect();
	}

	let MoveableCtorCache: MoveableCtor | null = null;

	async function setupMoveable() {
		if (!frameEl) return;
		if (!MoveableCtorCache) {
			const mod = await import('moveable');
			MoveableCtorCache = (mod.default ?? mod) as unknown as MoveableCtor;
		}
		teardownMoveable();
		const container = frameEl.parentElement ?? document.body;
		moveable = new MoveableCtorCache(container, {
			target: frameEl,
			resizable: true,
			draggable: false,
			origin: false,
			keepRatio: false,
			renderDirections: ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'],
			edge: ['n', 'w', 's', 'e'],
			throttleResize: 0,
			hideDefaultLines: false
		});
		moveable.on('resizeStart', handleResizeStart as never);
		moveable.on('resize', handleResize as never);
		moveable.on('resizeEnd', handleResizeEnd as never);
	}

	function teardownMoveable() {
		if (moveable) {
			try {
				moveable.destroy();
			} catch (err) {
				console.warn('Moveable destroy failed', err);
			}
			moveable = null;
		}
	}

	$effect(() => {
		if (props.visible && frameEl) {
			void setupMoveable();
		} else {
			teardownMoveable();
		}
	});

	// External size changes (viewport resize, projection switch) don't go through
	// Moveable, so push an updateRect when they happen outside of an active drag.
	$effect(() => {
		void props.viewportWidthPx;
		void props.viewportHeightPx;
		if (moveable && !dragSnapshot) {
			moveable.updateRect();
		}
	});

	onDestroy(() => {
		teardownMoveable();
	});
</script>

{#if props.visible}
	<div
		bind:this={frameEl}
		class="resize-frame"
		class:is-square-snap={shiftHeld}
		style="width: {props.viewportWidthPx}px; height: {props.viewportHeightPx}px;"
		aria-hidden="true"
	></div>
{/if}

<style>
	.resize-frame {
		/* Standard transform-based centering. We use `transform: translate(...)`
		   rather than the modern `translate:` individual property because Moveable
		   parses the legacy transform string when computing the target's matrix;
		   the new individual property collapsed the handle box to (0,0). */
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 4;
		background: transparent;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	:global(.moveable-control-box) {
		--moveable-color: transparent;
		z-index: 5;
	}
	:global(.moveable-control-box .moveable-line) {
		background: transparent !important;
	}
	:global(.moveable-control-box .moveable-control) {
		width: 24px !important;
		height: 24px !important;
		margin-top: -12px !important;
		margin-left: -12px !important;
		background: transparent !important;
		border: none !important;
		border-radius: 0 !important;
		box-shadow: none !important;
	}
	:global(.moveable-control-box .moveable-control)::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 16px;
		height: 2px;
		transform: translate(-50%, -50%);
		background: rgba(220, 224, 232, 0.92);
		border-radius: 1px;
		box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
		opacity: 0;
		transition: opacity 0.15s ease;
		pointer-events: none;
	}
	:global(.moveable-control-box .moveable-control:hover)::after {
		opacity: 1;
	}
	:global(.moveable-control-box .moveable-control[data-direction='e'])::after,
	:global(.moveable-control-box .moveable-control[data-direction='w'])::after {
		transform: translate(-50%, -50%) rotate(90deg);
	}
	:global(.moveable-control-box .moveable-control[data-direction='nw'])::after,
	:global(.moveable-control-box .moveable-control[data-direction='ne'])::after,
	:global(.moveable-control-box .moveable-control[data-direction='sw'])::after,
	:global(.moveable-control-box .moveable-control[data-direction='se'])::after {
		width: 14px;
		height: 14px;
		background: transparent;
		border: 2px solid rgba(220, 224, 232, 0.92);
		border-radius: 0;
		box-shadow: none;
		filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.5));
		transform: translate(-50%, -50%);
	}
	:global(.moveable-control-box .moveable-control[data-direction='nw'])::after {
		border-right: none;
		border-bottom: none;
		border-top-left-radius: 10px;
	}
	:global(.moveable-control-box .moveable-control[data-direction='ne'])::after {
		border-left: none;
		border-bottom: none;
		border-top-right-radius: 10px;
	}
	:global(.moveable-control-box .moveable-control[data-direction='sw'])::after {
		border-right: none;
		border-top: none;
		border-bottom-left-radius: 10px;
	}
	:global(.moveable-control-box .moveable-control[data-direction='se'])::after {
		border-left: none;
		border-top: none;
		border-bottom-right-radius: 10px;
	}
</style>
