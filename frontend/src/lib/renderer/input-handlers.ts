import {
	EPSILON,
	MAX_FOV_DEG_PINHOLE,
	MAX_FOV_DEG_STEREO,
	MIN_FOV_DEG_PINHOLE,
	MIN_FOV_DEG_STEREO
} from '$lib/constants';
import { projectPointerToArcball } from '$lib/math/arcball';
import { clamp, easeInOutCubic } from '$lib/math/easing';
import type { ProjectionMode } from '$lib/math/projection';
import {
	multiplyQuaternions,
	normalizeQuaternion,
	quaternionBetweenVectors,
	quaternionFromAxisAngle,
	rotateVectorByQuaternion,
	slerpQuaternion,
	type Quaternion,
	type Vec3
} from '$lib/math/quaternion';
import { view } from '$lib/state/view.svelte';
import { prefersReducedMotion } from '$lib/ui/motion';

const PAN_SPEED_RAD_PER_S = (60 * Math.PI) / 180;
const ROLL_SPEED_RAD_PER_S = (60 * Math.PI) / 180;
const ZOOM_SPEED_PER_S = 1.0;
const NORTH_UP_DURATION_MS = 400;
/** A flight to a view that arrives whole (a link pasted into the open tab). */
const FLY_TO_DURATION_MS = 600;

// === Glide after a drag ===
/** The sky keeps the speed of the last stretch of the drag, measured over this long. */
const GLIDE_SAMPLE_WINDOW_MS = 100;
/** A pointer that rested this long before it was let go threw nothing. */
const GLIDE_MAX_REST_MS = 60;
/** The speed dies away with this time constant: most of the glide is over in half a second. */
const GLIDE_DECAY_MS = 280;
/** Slower than this at release there is no glide; below the lower one a glide ends. */
const GLIDE_MIN_START_RAD_PER_MS = (12 * Math.PI) / 180 / 1000;
const GLIDE_STOP_RAD_PER_MS = (1 * Math.PI) / 180 / 1000;
/** A flick is capped here, so a slip of the hand does not spin the sky round. */
const GLIDE_MAX_RAD_PER_MS = (360 * Math.PI) / 180 / 1000;

// === Wheel zoom ===
/** The field of view closes on what the wheel asked for with this time constant. */
const ZOOM_EASE_MS = 70;
/** Close enough to the target, in degrees, to land on it. */
const ZOOM_SNAP_DEG = 0.02;

const ROTATION_KEYS = new Set([
	'KeyW',
	'KeyA',
	'KeyS',
	'KeyD',
	'KeyQ',
	'KeyE',
	'ArrowUp',
	'ArrowLeft',
	'ArrowDown',
	'ArrowRight'
]);

function isInputElement(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** A timed move of the camera: a turn to north up, or a flight to another view. */
interface Flight {
	from: Quaternion;
	to: Quaternion;
	/** The field of view to change on the way, when the flight has one. */
	fov: { mode: ProjectionMode; from: number; to: number } | null;
	elapsedMs: number;
	durationMs: number;
}

/** One step of a drag: the rotation it applied, and when. */
interface DragSample {
	rotation: Quaternion;
	timeMs: number;
}

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** The axis and angle (radians, 0..π) of a unit quaternion; null for no rotation. */
function axisAngle(q: Quaternion): { axis: Vec3; angle: number } | null {
	// q and −q are the same rotation: take the one with the shorter angle.
	const sign = q.w < 0 ? -1 : 1;
	const sinHalf = Math.hypot(q.x, q.y, q.z);
	if (sinHalf < EPSILON) return null;
	return {
		axis: { x: (sign * q.x) / sinHalf, y: (sign * q.y) / sinHalf, z: (sign * q.z) / sinHalf },
		angle: 2 * Math.atan2(sinHalf, sign * q.w)
	};
}

export interface InputControllerOptions {
	canvas: () => HTMLCanvasElement | null;
	onChange: () => void;
	getMode: () => ProjectionMode;
}

export class InputController {
	private activePointers = new Map<number, { x: number; y: number }>();
	private dragging = false;
	private activePointerId: number | null = null;
	private lastArcballVector: Vec3 | null = null;
	private pinchStartDistance = 0;
	private pinchStartFovDeg = MAX_FOV_DEG_STEREO;
	private gestureStartFovDeg = MAX_FOV_DEG_STEREO;
	private pinchStartMode: ProjectionMode = 'stereographic';
	private gestureStartMode: ProjectionMode = 'stereographic';
	private pressedKeys = new Set<string>();
	private flight: Flight | null = null;
	/** The last stretch of the drag in progress, for the speed it is let go at. */
	private dragSamples: DragSample[] = [];
	/** The sky gliding on after a drag: turning about `axis`, slowing down. */
	private glide: { axis: Vec3; speedRadPerMs: number } | null = null;
	/** The field of view the wheel asked for, which `tick` eases towards. */
	private zoomTarget: { mode: ProjectionMode; fovDeg: number } | null = null;

	constructor(private readonly opts: InputControllerOptions) {}

	onPointerDown(event: PointerEvent) {
		if (!(event.target instanceof HTMLCanvasElement)) return;
		// A hand on the sky stops whatever was moving it.
		this.flight = null;
		this.glide = null;
		this.dragSamples = [];
		event.target.setPointerCapture(event.pointerId);
		this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (this.activePointers.size >= 2) {
			this.startPinchIfReady();
			return;
		}
		this.dragging = true;
		this.activePointerId = event.pointerId;
		const rect = event.target.getBoundingClientRect();
		this.lastArcballVector = projectPointerToArcball(event.clientX, event.clientY, rect);
	}

	onPointerMove(event: PointerEvent) {
		if (this.activePointers.has(event.pointerId)) {
			this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}
		if (this.activePointers.size === 2) {
			const currentDistance = Math.max(this.getPointersDistance(), EPSILON);
			const scale = currentDistance / Math.max(this.pinchStartDistance, EPSILON);
			this.setFov(this.pinchStartFovDeg / Math.max(scale, EPSILON), this.pinchStartMode);
			return;
		}
		if (!this.dragging || event.pointerId !== this.activePointerId) return;
		const canvas = this.opts.canvas();
		if (!canvas || !this.lastArcballVector) return;
		const rect = canvas.getBoundingClientRect();
		const currentArcballVector = projectPointerToArcball(event.clientX, event.clientY, rect);
		const rawDelta = quaternionBetweenVectors(this.lastArcballVector, currentArcballVector);
		const deltaRotation = slerpQuaternion({ x: 0, y: 0, z: 0, w: 1 }, rawDelta, this.fovScale());
		view.orientation = normalizeQuaternion(multiplyQuaternions(deltaRotation, view.orientation));
		this.lastArcballVector = currentArcballVector;
		this.dragSamples.push({ rotation: deltaRotation, timeMs: event.timeStamp });
		while (
			this.dragSamples.length > 1 &&
			event.timeStamp - this.dragSamples[0].timeMs > GLIDE_SAMPLE_WINDOW_MS
		) {
			this.dragSamples.shift();
		}
		this.opts.onChange();
	}

	onPointerUp(event: PointerEvent) {
		if (!this.activePointers.has(event.pointerId)) return;
		const canvas = this.opts.canvas();
		if (canvas?.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}
		this.activePointers.delete(event.pointerId);
		if (this.activePointers.size >= 2) {
			this.startPinchIfReady();
			return;
		}
		if (this.activePointers.size === 1 && canvas) {
			const [nextPointerId, point] = [...this.activePointers.entries()][0];
			this.dragging = true;
			this.activePointerId = nextPointerId;
			const rect = canvas.getBoundingClientRect();
			this.lastArcballVector = projectPointerToArcball(point.x, point.y, rect);
			return;
		}
		const wasDragging = this.dragging;
		this.dragging = false;
		this.activePointerId = null;
		this.lastArcballVector = null;
		this.pinchStartDistance = 0;
		if (wasDragging) this.startGlide(event.timeStamp);
		this.dragSamples = [];
	}

	/**
	 * Let the sky glide on at the speed the drag ended with. The speed is that of
	 * the last `GLIDE_SAMPLE_WINDOW_MS` of the drag, so a pointer that stopped
	 * before it was lifted leaves the sky where it put it.
	 */
	private startGlide(releaseMs: number) {
		const samples = this.dragSamples;
		if (samples.length < 2 || prefersReducedMotion()) return;
		const last = samples[samples.length - 1];
		if (releaseMs - last.timeMs > GLIDE_MAX_REST_MS) return;
		// The first sample only marks where the stretch began; the rest are its rotation.
		let total = IDENTITY;
		for (let i = 1; i < samples.length; i += 1) {
			total = multiplyQuaternions(samples[i].rotation, total);
		}
		const turn = axisAngle(normalizeQuaternion(total));
		const elapsedMs = last.timeMs - samples[0].timeMs;
		if (!turn || elapsedMs <= 0) return;
		const speed = Math.min(turn.angle / elapsedMs, GLIDE_MAX_RAD_PER_MS);
		if (speed < GLIDE_MIN_START_RAD_PER_MS) return;
		this.glide = { axis: turn.axis, speedRadPerMs: speed };
		this.opts.onChange();
	}

	onCanvasWheel(event: WheelEvent) {
		if (!event.ctrlKey) return;
		event.preventDefault();
		const mode = this.opts.getMode();
		const zoomFactor = Math.exp(event.deltaY * 0.0025);
		// Each notch builds on what the last one asked for, not on where the ease has got to.
		const base = this.zoomTarget?.mode === mode ? this.zoomTarget.fovDeg : this.getFov(mode);
		const target = this.clampFov(base * zoomFactor, mode);
		if (prefersReducedMotion()) {
			this.setFov(target, mode);
			return;
		}
		this.zoomTarget = { mode, fovDeg: target };
		this.opts.onChange();
	}

	onCanvasGestureStart(event: Event) {
		event.preventDefault();
		this.gestureStartMode = this.opts.getMode();
		this.gestureStartFovDeg = this.getFov(this.gestureStartMode);
	}

	onCanvasGestureChange(event: Event) {
		const gestureEvent = event as Event & { scale?: number };
		const scale = gestureEvent.scale;
		if (!scale || !Number.isFinite(scale)) return;
		event.preventDefault();
		this.setFov(this.gestureStartFovDeg / Math.max(scale, EPSILON), this.gestureStartMode);
	}

	private clampFov(fovDeg: number, mode: ProjectionMode): number {
		const [minFov, maxFov] =
			mode === 'stereographic'
				? [MIN_FOV_DEG_STEREO, MAX_FOV_DEG_STEREO]
				: [MIN_FOV_DEG_PINHOLE, MAX_FOV_DEG_PINHOLE];
		return clamp(fovDeg, minFov, maxFov);
	}

	private writeFov(fovDeg: number, mode: ProjectionMode) {
		if (mode === 'stereographic') {
			view.stereoFovDeg = fovDeg;
		} else {
			view.pinholeFovDeg = fovDeg;
		}
	}

	/** Set the field of view outright (a pinch, the keys): the wheel's ease gives way to it. */
	setFov(nextFovDeg: number, mode: ProjectionMode) {
		this.zoomTarget = null;
		const clampedFovDeg = this.clampFov(nextFovDeg, mode);
		const currentFovDeg = this.getFov(mode);
		if (Math.abs(clampedFovDeg - currentFovDeg) <= 0.01) return;
		this.writeFov(clampedFovDeg, mode);
		this.opts.onChange();
	}

	private getFov(mode: ProjectionMode): number {
		return mode === 'stereographic' ? view.stereoFovDeg : view.pinholeFovDeg;
	}

	private fovScale(): number {
		const mode = this.opts.getMode();
		const maxFov = mode === 'stereographic' ? MAX_FOV_DEG_STEREO : MAX_FOV_DEG_PINHOLE;
		const ratio = this.getFov(mode) / maxFov;
		return 0.1 + 0.9 * ratio;
	}

	private getPointersDistance() {
		const [a, b] = [...this.activePointers.values()];
		if (!a || !b) return 0;
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	onKeyDown(event: KeyboardEvent) {
		if (isInputElement(event.target)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const code = event.code;

		if (code === 'KeyN' && event.shiftKey) {
			event.preventDefault();
			if (event.repeat) return;
			this.startNorthUpAnimation();
			return;
		}

		if ((code === 'KeyI' || code === 'KeyO') && event.shiftKey) {
			event.preventDefault();
			if (event.repeat) return;
			this.pressedKeys.add(code);
			if (this.pressedKeys.size === 1) {
				this.opts.onChange();
			}
			return;
		}

		if (ROTATION_KEYS.has(code)) {
			event.preventDefault();
			if (event.repeat) return;
			this.flight = null;
			this.glide = null;
			this.pressedKeys.add(code);
			if (this.pressedKeys.size === 1) {
				this.opts.onChange();
			}
		}
	}

	onKeyUp(event: KeyboardEvent) {
		this.pressedKeys.delete(event.code);
	}

	onBlur() {
		this.pressedKeys.clear();
	}

	/**
	 * One frame of motion: a flight, a glide, an eased zoom and the held keys, each in
	 * turn. True while any of them still moves the view.
	 */
	tick(dtMs: number): boolean {
		const flying = this.stepFlight(dtMs);
		const gliding = this.stepGlide(dtMs);
		const zooming = this.stepZoomTarget(dtMs);
		const zoomKeys = this.stepZoomKeys(dtMs);
		const turnKeys = this.stepTurnKeys(dtMs);
		return flying || gliding || zooming || zoomKeys || turnKeys;
	}

	private stepFlight(dtMs: number): boolean {
		if (!this.flight) return false;
		const flight = this.flight;
		flight.elapsedMs += dtMs;
		const t = Math.min(flight.elapsedMs / flight.durationMs, 1);
		const eased = easeInOutCubic(t);
		view.orientation = slerpQuaternion(flight.from, flight.to, eased);
		if (flight.fov) {
			// Evenly in scale, not in degrees: half way there looks half way zoomed.
			const { mode, from, to } = flight.fov;
			this.writeFov(from * Math.pow(to / from, eased), mode);
		}
		if (t >= 1) {
			view.orientation = normalizeQuaternion(flight.to);
			if (flight.fov) this.writeFov(flight.fov.to, flight.fov.mode);
			this.flight = null;
		}
		return true;
	}

	private stepGlide(dtMs: number): boolean {
		if (!this.glide) return false;
		const glide = this.glide;
		const turn = quaternionFromAxisAngle(glide.axis, glide.speedRadPerMs * dtMs);
		view.orientation = normalizeQuaternion(multiplyQuaternions(turn, view.orientation));
		glide.speedRadPerMs *= Math.exp(-dtMs / GLIDE_DECAY_MS);
		if (glide.speedRadPerMs < GLIDE_STOP_RAD_PER_MS) this.glide = null;
		return true;
	}

	private stepZoomTarget(dtMs: number): boolean {
		if (!this.zoomTarget) return false;
		const { mode, fovDeg: target } = this.zoomTarget;
		if (mode !== this.opts.getMode()) {
			// The projection changed under it: the target was the other one's.
			this.zoomTarget = null;
			return false;
		}
		const current = this.getFov(mode);
		const next = current + (target - current) * (1 - Math.exp(-dtMs / ZOOM_EASE_MS));
		if (Math.abs(target - next) <= ZOOM_SNAP_DEG) {
			this.writeFov(target, mode);
			this.zoomTarget = null;
		} else {
			this.writeFov(next, mode);
		}
		return true;
	}

	private stepZoomKeys(dtMs: number): boolean {
		if (!this.pressedKeys.has('KeyI') && !this.pressedKeys.has('KeyO')) return false;
		const factor = Math.exp((ZOOM_SPEED_PER_S * dtMs) / 1000);
		const mode = this.opts.getMode();
		const fov = this.getFov(mode);
		this.setFov(this.pressedKeys.has('KeyI') ? fov / factor : fov * factor, mode);
		return true;
	}

	/** The held keys pan and roll the view; not during a flight. */
	private stepTurnKeys(dtMs: number): boolean {
		if (this.pressedKeys.size === 0 || this.flight) return false;
		const pan = PAN_SPEED_RAD_PER_S * (dtMs / 1000) * this.fovScale();
		const roll = ROLL_SPEED_RAD_PER_S * (dtMs / 1000);

		let delta: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

		if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp'))
			delta = multiplyQuaternions(quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, pan), delta);
		if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown'))
			delta = multiplyQuaternions(quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, -pan), delta);
		if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft'))
			delta = multiplyQuaternions(quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, -pan), delta);
		if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight'))
			delta = multiplyQuaternions(quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, pan), delta);
		if (this.pressedKeys.has('KeyQ'))
			delta = multiplyQuaternions(quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, -roll), delta);
		if (this.pressedKeys.has('KeyE'))
			delta = multiplyQuaternions(quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, roll), delta);

		view.orientation = normalizeQuaternion(multiplyQuaternions(delta, view.orientation));
		return true;
	}

	private startNorthUpAnimation() {
		const q = view.orientation;
		const [nx, ny] = rotateVectorByQuaternion(0, 0, 1, q);
		const projLen = Math.hypot(nx, ny);
		if (projLen < 0.01) return;

		const rollAngle = Math.atan2(nx, ny);
		if (Math.abs(rollAngle) < 0.001) return;

		const correction = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, rollAngle);
		const target = normalizeQuaternion(multiplyQuaternions(correction, q));

		this.glide = null;
		this.flight = {
			from: { ...q },
			to: target,
			fov: null,
			elapsedMs: 0,
			durationMs: NORTH_UP_DURATION_MS
		};
		this.pressedKeys.clear();
		this.opts.onChange();
	}

	/**
	 * Fly to another view of the same projection: the orientation turns the short
	 * way round and the field of view follows. Any hand on the sky, or a rotation
	 * key, takes over from it.
	 */
	flyTo(orientation: Quaternion, fovDeg: number, mode: ProjectionMode) {
		this.stopMotion();
		const from = this.getFov(mode);
		const to = this.clampFov(fovDeg, mode);
		this.flight = {
			from: { ...view.orientation },
			to: normalizeQuaternion(orientation),
			fov: Math.abs(to - from) > 0.01 && from > 0 ? { mode, from, to } : null,
			elapsedMs: 0,
			durationMs: FLY_TO_DURATION_MS
		};
		this.pressedKeys.clear();
		this.opts.onChange();
	}

	/** Stop whatever is moving the view by itself: a view is about to be set outright. */
	stopMotion() {
		this.flight = null;
		this.glide = null;
		this.zoomTarget = null;
	}

	private startPinchIfReady() {
		if (this.activePointers.size !== 2) return;
		this.pinchStartDistance = Math.max(this.getPointersDistance(), EPSILON);
		this.pinchStartMode = this.opts.getMode();
		this.pinchStartFovDeg = this.getFov(this.pinchStartMode);
		this.dragging = false;
		this.activePointerId = null;
		this.lastArcballVector = null;
		// Two fingers zoom: the drag before them throws nothing, and the pinch owns the field of view.
		this.dragSamples = [];
		this.glide = null;
		this.zoomTarget = null;
	}
}
