import {
	EPSILON,
	MAX_FOV_DEG_PINHOLE,
	MAX_FOV_DEG_STEREO,
	MIN_FOV_DEG_PINHOLE,
	MIN_FOV_DEG_STEREO
} from '$lib/constants';
import { projectPointerToArcball } from '$lib/math/arcball';
import { clamp, easeInOutCubic } from '$lib/math/easing';
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
import { view } from '$lib/stores.svelte';

export type ProjectionMode = 'stereographic' | 'pinhole';

const PAN_SPEED_RAD_PER_S = (60 * Math.PI) / 180;
const ROLL_SPEED_RAD_PER_S = (60 * Math.PI) / 180;
const ZOOM_SPEED_PER_S = 1.0;
const NORTH_UP_DURATION_MS = 400;

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

interface NorthUpAnimation {
	from: Quaternion;
	to: Quaternion;
	elapsedMs: number;
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
	private northUpAnim: NorthUpAnimation | null = null;

	constructor(private readonly opts: InputControllerOptions) {}

	onPointerDown(event: PointerEvent) {
		if (!(event.target instanceof HTMLCanvasElement)) return;
		this.northUpAnim = null;
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
		this.dragging = false;
		this.activePointerId = null;
		this.lastArcballVector = null;
		this.pinchStartDistance = 0;
	}

	onCanvasWheel(event: WheelEvent) {
		if (!event.ctrlKey) return;
		event.preventDefault();
		const mode = this.opts.getMode();
		const zoomFactor = Math.exp(event.deltaY * 0.0025);
		this.setFov(this.getFov(mode) * zoomFactor, mode);
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

	setFov(nextFovDeg: number, mode: ProjectionMode) {
		const [minFov, maxFov] =
			mode === 'stereographic'
				? [MIN_FOV_DEG_STEREO, MAX_FOV_DEG_STEREO]
				: [MIN_FOV_DEG_PINHOLE, MAX_FOV_DEG_PINHOLE];
		const clampedFovDeg = clamp(nextFovDeg, minFov, maxFov);
		const currentFovDeg = this.getFov(mode);
		if (Math.abs(clampedFovDeg - currentFovDeg) <= 0.01) return;
		if (mode === 'stereographic') {
			view.stereoFovDeg = clampedFovDeg;
		} else {
			view.pinholeFovDeg = clampedFovDeg;
		}
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
			this.northUpAnim = null;
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

	tick(dtMs: number): boolean {
		let active = false;

		if (this.northUpAnim) {
			active = true;
			this.northUpAnim.elapsedMs += dtMs;
			const t = Math.min(this.northUpAnim.elapsedMs / NORTH_UP_DURATION_MS, 1);
			view.orientation = slerpQuaternion(
				this.northUpAnim.from,
				this.northUpAnim.to,
				easeInOutCubic(t)
			);
			if (t >= 1) {
				view.orientation = normalizeQuaternion(this.northUpAnim.to);
				this.northUpAnim = null;
			}
		}

		if (this.pressedKeys.has('KeyI') || this.pressedKeys.has('KeyO')) {
			active = true;
			const factor = Math.exp((ZOOM_SPEED_PER_S * dtMs) / 1000);
			const mode = this.opts.getMode();
			const fov = this.getFov(mode);
			this.setFov(this.pressedKeys.has('KeyI') ? fov / factor : fov * factor, mode);
		}

		if (this.pressedKeys.size > 0 && !this.northUpAnim) {
			active = true;
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
		}

		return active;
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

		this.northUpAnim = { from: { ...q }, to: target, elapsedMs: 0 };
		this.pressedKeys.clear();
		this.opts.onChange();
	}

	private startPinchIfReady() {
		if (this.activePointers.size !== 2) return;
		this.pinchStartDistance = Math.max(this.getPointersDistance(), EPSILON);
		this.pinchStartMode = this.opts.getMode();
		this.pinchStartFovDeg = this.getFov(this.pinchStartMode);
		this.dragging = false;
		this.activePointerId = null;
		this.lastArcballVector = null;
	}
}
