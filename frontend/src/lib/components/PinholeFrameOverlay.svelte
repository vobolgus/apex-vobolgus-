<script lang="ts">
	/**
	 * Resize handles for the pinhole frame, drawn in the DOM over the canvas
	 * (so they never reach an export): concentric corner brackets and edge
	 * pills in one SVG, separate HTML hit areas on top, and a readout pill.
	 *
	 * Geometry is a pure function of the view state (`$lib/math/pinhole-frame`),
	 * so nothing is measured or synced back from the DOM. The root ignores the
	 * pointer, so dragging inside the frame still rotates the sky; only the hit
	 * areas take events.
	 *
	 * The page drives two things from outside: `flush()` from its render loop,
	 * which applies the latest drag position once per frame right before the
	 * canvas draws it, and `trackPointer()` from its pointermove, which lights the
	 * handles up when the pointer comes near the frame.
	 */
	import { onDestroy, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import {
		PINHOLE_CORNER_HIT_COARSE_PX,
		PINHOLE_CORNER_HIT_PX,
		PINHOLE_CROSSHAIR_PX,
		PINHOLE_EDGE_HIT_COARSE_PX,
		PINHOLE_EDGE_HIT_INSET_COARSE_PX,
		PINHOLE_EDGE_HIT_INSET_PX,
		PINHOLE_EDGE_HIT_PX,
		PINHOLE_HANDLE_STROKE_PX,
		PINHOLE_NEAR_MARGIN_PX,
		PINHOLE_READOUT_HEIGHT_PX,
		PINHOLE_READOUT_LINGER_MS
	} from '$lib/constants';
	import {
		CORNER_HANDLES,
		EDGE_HANDLES,
		HANDLE_CURSOR,
		axisFovDeg,
		beginPinholeDrag,
		formatPinholeReadout,
		isNearRect,
		pinholeDragRequest,
		pinholeFovRange,
		pinholeFrameRect,
		pinholeHandleLayout,
		pinholeHandleState,
		pinholeKeyRequest,
		pinholeKeyStep,
		pinholeLimitState,
		pinholeLimits,
		pxPerFrac,
		readoutPlacement,
		resolvePinholeResize,
		type EdgeHandle,
		type FrameHandle,
		type HandleState,
		type HitSizes,
		type PinholeDragOrigin,
		type PinholeLimits,
		type PinholeShape
	} from '$lib/math/pinhole-frame';
	import { view } from '$lib/stores.svelte';

	interface Props {
		/** Side of the square chart surface, CSS px. */
		surfaceSizePx: number;
		/** Size of the clipping chart area around the surface, CSS px. */
		clipWidthPx: number;
		clipHeightPx: number;
		/** True only while the pinhole projection is settled. */
		visible: boolean;
		/** The view changed and the canvas needs a frame. */
		onChange: () => void;
	}

	let { surfaceSizePx, clipWidthPx, clipHeightPx, visible, onChange }: Props = $props();

	/** Class on <html> while a handle is dragged; pins the cursor page-wide. */
	const RESIZING_CLASS = 'pinhole-resizing';

	interface DragSession {
		origin: PinholeDragOrigin;
		pointerId: number;
		target: HTMLElement;
		start: PinholeShape;
		limits: PinholeLimits;
		pointerX: number;
		pointerY: number;
		shift: boolean;
		/** A pointer or Shift change waiting for the next `flush()`. */
		pending: boolean;
	}

	let rootEl: HTMLDivElement | null = $state(null);
	let session: DragSession | null = null;
	let activeHandle = $state<FrameHandle | null>(null);
	let dragLimits = $state.raw<PinholeLimits | null>(null);
	let squareSnap = $state(false);
	let hoveredHandle = $state<FrameHandle | null>(null);
	let focusedHandle = $state<EdgeHandle | null>(null);
	let near = $state(false);
	let lingering = $state(false);
	let lingerTimer: ReturnType<typeof setTimeout> | undefined;

	const coarsePointer = new MediaQuery('(pointer: coarse)', false);
	const hitSizes = $derived<HitSizes>(
		coarsePointer.current
			? {
					edge: PINHOLE_EDGE_HIT_COARSE_PX,
					edgeInset: PINHOLE_EDGE_HIT_INSET_COARSE_PX,
					corner: PINHOLE_CORNER_HIT_COARSE_PX
				}
			: {
					edge: PINHOLE_EDGE_HIT_PX,
					edgeInset: PINHOLE_EDGE_HIT_INSET_PX,
					corner: PINHOLE_CORNER_HIT_PX
				}
	);

	const shape = $derived<PinholeShape>({
		fovDeg: view.pinholeFovDeg,
		aspectRatio: view.pinholeAspectRatio,
		heightFrac: view.pinholeHeightFrac
	});
	const frame = $derived(pinholeFrameRect(surfaceSizePx, shape.aspectRatio, shape.heightFrac));
	const layout = $derived(pinholeHandleLayout(frame, hitSizes));
	// During a drag the bounds stay the ones it started with.
	const limits = $derived(
		dragLimits ?? pinholeLimits(surfaceSizePx, clipWidthPx, clipHeightPx, shape)
	);
	const fovRanges = $derived({
		x: pinholeFovRange(shape, 'x', limits),
		y: pinholeFovRange(shape, 'y', limits)
	});
	const readout = $derived(
		formatPinholeReadout(shape, pinholeLimitState(shape, limits), squareSnap)
	);
	const readoutAt = $derived(readoutPlacement(frame, surfaceSizePx, clipHeightPx));
	/** The handle that leads the styling: the dragged one, else the keyboard-focused one. */
	const leadHandle = $derived<FrameHandle | null>(activeHandle ?? focusedHandle);
	const readoutVisible = $derived(leadHandle !== null || near || lingering);
	/** Crosshair on the frame centre, the fixed point of the symmetric resize. */
	const crosshairPath = $derived.by(() => {
		const c = surfaceSizePx / 2;
		const half = PINHOLE_CROSSHAIR_PX / 2;
		return `M ${c - half} ${c} H ${c + half} M ${c} ${c - half} V ${c + half}`;
	});

	function edgeAxis(handle: EdgeHandle): 'x' | 'y' {
		return handle === 'e' || handle === 'w' ? 'x' : 'y';
	}

	function handleState(handle: FrameHandle): HandleState {
		return pinholeHandleState(
			handle,
			{ lead: leadHandle, hovered: hoveredHandle, near },
			layout.pills
		);
	}

	function writeShape(next: PinholeShape) {
		view.pinholeFovDeg = next.fovDeg;
		view.pinholeAspectRatio = next.aspectRatio;
		view.pinholeHeightFrac = next.heightFrac;
	}

	function lingerReadout() {
		lingering = true;
		clearTimeout(lingerTimer);
		lingerTimer = setTimeout(() => (lingering = false), PINHOLE_READOUT_LINGER_MS);
	}

	/** Apply the latest drag position. Called by the page's render loop, once per frame. */
	export function flush(): boolean {
		if (!session?.pending) return false;
		session.pending = false;
		applyDrag(session);
		return true;
	}

	function applyDrag(drag: DragSession) {
		const request = pinholeDragRequest(drag.origin, drag.pointerX, drag.pointerY, drag.shift);
		const next = resolvePinholeResize(drag.start, request, drag.limits);
		writeShape(next);
		squareSnap = request.square && Math.abs(next.aspectRatio - 1) < 1e-6;
	}

	/** Light the handles up while a mouse or pen is over or near the frame. */
	export function trackPointer(event: PointerEvent) {
		if (!visible || !rootEl || event.pointerType === 'touch') {
			near = false;
			return;
		}
		const box = rootEl.getBoundingClientRect();
		near = isNearRect(
			event.clientX - box.left,
			event.clientY - box.top,
			frame,
			PINHOLE_NEAR_MARGIN_PX
		);
	}

	export function clearPointer() {
		near = false;
	}

	function requestFrame(drag: DragSession) {
		drag.pending = true;
		onChange();
	}

	function onHitPointerDown(event: PointerEvent, handle: FrameHandle) {
		if (event.button !== 0 || !event.isPrimary || session || !rootEl) return;
		// The sky's InputController already ignores non-canvas targets; this also
		// keeps the page from treating the press as anything but a resize.
		event.stopPropagation();
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		const box = rootEl.getBoundingClientRect();
		const start: PinholeShape = { ...shape };
		session = {
			origin: beginPinholeDrag(
				handle,
				event.clientX,
				event.clientY,
				box.left + box.width / 2,
				box.top + box.height / 2,
				frame,
				pxPerFrac(surfaceSizePx)
			),
			pointerId: event.pointerId,
			target,
			start,
			limits: pinholeLimits(surfaceSizePx, clipWidthPx, clipHeightPx, start),
			pointerX: event.clientX,
			pointerY: event.clientY,
			shift: event.shiftKey,
			pending: false
		};
		dragLimits = session.limits;
		activeHandle = handle;
		const html = document.documentElement;
		html.style.setProperty('--pinhole-resize-cursor', HANDLE_CURSOR[handle]);
		html.classList.add(RESIZING_CLASS);
		target.addEventListener('pointermove', onDragPointerMove);
		target.addEventListener('pointerup', onDragPointerUp);
		target.addEventListener('pointercancel', onDragPointerEnd);
		target.addEventListener('lostpointercapture', onDragPointerEnd);
		window.addEventListener('pointerdown', onOtherPointerDown, true);
		window.addEventListener('keydown', onDragKey);
		window.addEventListener('keyup', onDragKey);
		window.addEventListener('blur', onWindowBlur);
		document.addEventListener('visibilitychange', onVisibilityChange);
	}

	function onDragPointerMove(event: PointerEvent) {
		if (!session || event.pointerId !== session.pointerId) return;
		session.pointerX = event.clientX;
		session.pointerY = event.clientY;
		session.shift = event.shiftKey;
		requestFrame(session);
	}

	function onDragPointerUp(event: PointerEvent) {
		if (!session || event.pointerId !== session.pointerId) return;
		if (event.clientX !== session.pointerX || event.clientY !== session.pointerY) {
			session.pointerX = event.clientX;
			session.pointerY = event.clientY;
			session.pending = true;
		}
		endDrag(true);
	}

	function onDragPointerEnd(event: PointerEvent) {
		if (session && event.pointerId === session.pointerId) endDrag(true);
	}

	/** A second finger (or pen) during a handle drag must not start a sky drag. */
	function onOtherPointerDown(event: PointerEvent) {
		if (session && event.pointerId !== session.pointerId) {
			event.stopPropagation();
			event.preventDefault();
		}
	}

	/** Shift is re-read on its own key events, so pressing it without moving snaps at once. */
	function onDragKey(event: KeyboardEvent) {
		if (!session) return;
		if (event.key === 'Escape' && event.type === 'keydown') {
			endDrag(false);
			return;
		}
		if (event.key !== 'Shift') return;
		const shift = event.type === 'keydown';
		if (session.shift === shift) return;
		session.shift = shift;
		requestFrame(session);
	}

	// Losing the window or the tab mid-drag cancels the resize.
	function onWindowBlur() {
		endDrag(false);
	}

	function onVisibilityChange() {
		if (document.hidden) endDrag(false);
	}

	/** Finish the drag, keeping the result (`commit`) or restoring the start state. */
	function endDrag(commit: boolean) {
		const drag = session;
		if (!drag) return;
		session = null;
		if (!commit) {
			writeShape(drag.start);
		} else if (drag.pending) {
			applyDrag(drag);
		}
		const { target } = drag;
		target.removeEventListener('pointermove', onDragPointerMove);
		target.removeEventListener('pointerup', onDragPointerUp);
		target.removeEventListener('pointercancel', onDragPointerEnd);
		target.removeEventListener('lostpointercapture', onDragPointerEnd);
		window.removeEventListener('pointerdown', onOtherPointerDown, true);
		window.removeEventListener('keydown', onDragKey);
		window.removeEventListener('keyup', onDragKey);
		window.removeEventListener('blur', onWindowBlur);
		document.removeEventListener('visibilitychange', onVisibilityChange);
		if (target.hasPointerCapture(drag.pointerId)) target.releasePointerCapture(drag.pointerId);
		const html = document.documentElement;
		html.classList.remove(RESIZING_CLASS);
		html.style.removeProperty('--pinhole-resize-cursor');
		activeHandle = null;
		dragLimits = null;
		squareSnap = false;
		lingerReadout();
		onChange();
	}

	function onHitPointerEnter(event: PointerEvent, handle: FrameHandle) {
		if (event.pointerType !== 'touch') hoveredHandle = handle;
	}

	function onHitPointerLeave(handle: FrameHandle) {
		if (hoveredHandle === handle) hoveredHandle = null;
	}

	function onEdgeKeyDown(event: KeyboardEvent, handle: EdgeHandle) {
		if (session || event.altKey || event.ctrlKey || event.metaKey) return;
		const step = pinholeKeyStep(event.key, event.shiftKey);
		if (step === null) return;
		// The page's window keydown would otherwise rotate the sky on the same arrow.
		event.preventDefault();
		event.stopPropagation();
		const axis = edgeAxis(handle);
		writeShape(resolvePinholeResize(shape, pinholeKeyRequest(shape, axis, step), limits));
		lingerReadout();
		onChange();
	}

	function onEdgeFocus(event: FocusEvent, handle: EdgeHandle) {
		let focusVisible = true;
		try {
			focusVisible = (event.currentTarget as HTMLElement).matches(':focus-visible');
		} catch {
			// Engines without :focus-visible: treat every focus as keyboard focus.
		}
		focusedHandle = focusVisible ? handle : null;
	}

	function onEdgeBlur(handle: EdgeHandle) {
		if (focusedHandle === handle) focusedHandle = null;
	}

	// Pinch, ctrl+wheel and Shift+I/O change the fov with the frame held still;
	// flash the readout for those as well.
	let lastFovDeg: number | null = null;
	$effect(() => {
		const fovDeg = view.pinholeFovDeg;
		untrack(() => {
			if (lastFovDeg !== null && fovDeg !== lastFovDeg && visible && !session) lingerReadout();
			lastFovDeg = fovDeg;
		});
	});

	// Hidden the moment a projection switch starts: drop any drag and hover state.
	$effect(() => {
		if (visible) return;
		untrack(() => {
			endDrag(true);
			near = false;
			hoveredHandle = null;
			focusedHandle = null;
		});
	});

	onDestroy(() => {
		clearTimeout(lingerTimer);
		endDrag(true);
	});
</script>

{#if visible}
	<div
		bind:this={rootEl}
		class="pinhole-overlay"
		class:is-dragging={activeHandle !== null}
		class:is-square-snap={squareSnap}
		data-near={near ? '' : undefined}
	>
		<svg
			class="handle-visuals"
			viewBox="0 0 {surfaceSizePx} {surfaceSizePx}"
			stroke-width={PINHOLE_HANDLE_STROKE_PX}
			aria-hidden="true"
		>
			{#each CORNER_HANDLES as handle (handle)}
				<path class="bracket" data-state={handleState(handle)} d={layout.brackets[handle]} />
			{/each}
			{#each EDGE_HANDLES as handle (handle)}
				{@const pill = layout.pills[handle]}
				{#if pill}
					<rect
						class="pill"
						data-state={handleState(handle)}
						x={pill.x}
						y={pill.y}
						width={pill.width}
						height={pill.height}
						rx={PINHOLE_HANDLE_STROKE_PX / 2}
					/>
				{/if}
			{/each}
			{#if activeHandle}
				<path class="crosshair" d={crosshairPath} />
			{/if}
		</svg>

		<!-- Edge hits first so the corner hits, later in the DOM, win where they overlap. -->
		{#each EDGE_HANDLES as handle (handle)}
			{@const hit = layout.hits[handle]}
			{@const axis = edgeAxis(handle)}
			{@const fov = axisFovDeg(shape, axis)}
			<div
				class="hit"
				data-handle={handle}
				role="slider"
				tabindex="0"
				aria-label={axis === 'x' ? 'Frame width' : 'Frame height'}
				aria-orientation={axis === 'x' ? 'horizontal' : 'vertical'}
				aria-valuemin={Math.round(fovRanges[axis].min)}
				aria-valuemax={Math.round(fovRanges[axis].max)}
				aria-valuenow={Math.round(fov)}
				aria-valuetext="FOV {Math.round(fov)}°"
				style:left="{hit.x}px"
				style:top="{hit.y}px"
				style:width="{hit.width}px"
				style:height="{hit.height}px"
				style:cursor={HANDLE_CURSOR[handle]}
				onpointerdown={(event) => onHitPointerDown(event, handle)}
				onpointerenter={(event) => onHitPointerEnter(event, handle)}
				onpointerleave={() => onHitPointerLeave(handle)}
				onmousedown={(event) => event.preventDefault()}
				onkeydown={(event) => onEdgeKeyDown(event, handle)}
				onfocus={(event) => onEdgeFocus(event, handle)}
				onblur={() => onEdgeBlur(handle)}
			></div>
		{/each}
		{#each CORNER_HANDLES as handle (handle)}
			{@const hit = layout.hits[handle]}
			<div
				class="hit"
				data-handle={handle}
				aria-hidden="true"
				style:left="{hit.x}px"
				style:top="{hit.y}px"
				style:width="{hit.width}px"
				style:height="{hit.height}px"
				style:cursor={HANDLE_CURSOR[handle]}
				onpointerdown={(event) => onHitPointerDown(event, handle)}
				onpointerenter={(event) => onHitPointerEnter(event, handle)}
				onpointerleave={() => onHitPointerLeave(handle)}
				onmousedown={(event) => event.preventDefault()}
			></div>
		{/each}

		<div
			class="readout"
			class:is-visible={readoutVisible}
			class:is-inside={readoutAt.inside}
			style:top="{readoutAt.top}px"
			style:height="{PINHOLE_READOUT_HEIGHT_PX}px"
			style:max-width={readoutAt.maxWidth === null ? undefined : `${readoutAt.maxWidth}px`}
			aria-hidden="true"
		>
			<span class="readout-size">{readout.size}</span>
			<span class="readout-tail">
				<span class="readout-separator">·</span>
				<span class="readout-ratio">{readout.ratio}</span>
			</span>
		</div>
	</div>
{/if}

<style>
	.pinhole-overlay {
		position: absolute;
		inset: 0;
		z-index: 4;
		/* Only the hit areas take the pointer: a drag inside the frame rotates the sky. */
		pointer-events: none;
		animation: pinhole-overlay-in 150ms ease-out;
	}

	@keyframes pinhole-overlay-in {
		from {
			opacity: 0;
		}
	}

	.handle-visuals {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* At full width the brackets sit just outside the surface. */
		overflow: visible;
	}

	.bracket {
		fill: none;
		stroke: #ffffff;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.pill {
		fill: #ffffff;
	}

	.bracket,
	.pill {
		opacity: 0.45;
		transition: opacity 120ms ease;
	}

	.bracket[data-state='near'],
	.pill[data-state='near'],
	.bracket[data-state='mirror'],
	.pill[data-state='mirror'] {
		opacity: 0.7;
	}

	.bracket[data-state='hover'],
	.pill[data-state='hover'],
	.bracket[data-state='active'],
	.pill[data-state='active'] {
		opacity: 1;
	}

	.bracket[data-state='dim'],
	.pill[data-state='dim'] {
		opacity: 0.25;
	}

	/* No hover to discover them with: keep the handles plainly visible at rest. */
	@media (hover: none) {
		.bracket[data-state='idle'],
		.pill[data-state='idle'] {
			opacity: 0.7;
		}
	}

	/* Marks the fixed centre of the symmetric resize. Snapped to the pixel grid:
	   the centre often lands on a pixel boundary, where an antialiased 1 px line
	   smears into two faint ones at DPR 1. */
	.crosshair {
		fill: none;
		stroke: rgba(10, 10, 11, 0.35);
		stroke-width: 1px;
		shape-rendering: crispEdges;
	}

	.hit {
		position: absolute;
		pointer-events: auto;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
		/* Keyboard focus shows on the handle itself (styled as active), not the hit box. */
		outline: none;
	}

	.readout {
		position: absolute;
		left: 50%;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 10px;
		border-radius: 12px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(24, 24, 27, 0.92);
		color: #eceef1;
		font-size: 12px;
		font-weight: 500;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transform: translateX(-50%);
		opacity: 0;
		transition: opacity 120ms ease;
		pointer-events: none;
	}

	.readout.is-visible {
		opacity: 1;
	}

	.readout-tail {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	/* Inside a frame too narrow for the whole pill, the ratio wraps onto a second
	   line that the fixed height clips away, leaving "72° × 44°". */
	.readout.is-inside {
		width: max-content;
		flex-wrap: wrap;
		justify-content: center;
		align-content: flex-start;
		row-gap: 0;
		overflow: hidden;
	}

	/* Each part fills the line, so the first line stays centred in the pill. */
	.readout.is-inside > * {
		display: flex;
		align-items: center;
		height: 100%;
	}

	.readout-separator,
	.readout-ratio {
		color: #8f939a;
	}

	.is-square-snap .readout-ratio {
		color: #ffffff;
	}

	@media (prefers-reduced-motion: reduce) {
		.pinhole-overlay {
			animation: none;
		}

		.bracket,
		.pill,
		.readout {
			transition: none;
		}
	}

	/* While a handle is dragged the cursor stays the resize one everywhere,
	   instead of flickering to the canvas's grab when the pointer leaves the strip. */
	:global(html.pinhole-resizing),
	:global(html.pinhole-resizing *) {
		cursor: var(--pinhole-resize-cursor) !important;
		user-select: none;
		-webkit-user-select: none;
	}
</style>
