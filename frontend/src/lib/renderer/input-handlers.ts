import { EPSILON, MAX_FOV_DEG, MIN_FOV_DEG } from '$lib/constants';
import { projectPointerToArcball } from '$lib/math/arcball';
import { clamp } from '$lib/math/easing';
import {
	multiplyQuaternions,
	normalizeQuaternion,
	quaternionBetweenVectors,
	type Vec3
} from '$lib/math/quaternion';
import { view } from '$lib/stores.svelte';

export interface InputControllerOptions {
	canvas: () => HTMLCanvasElement | null;
	onChange: () => void;
}

export class InputController {
	private activePointers = new Map<number, { x: number; y: number }>();
	private dragging = false;
	private activePointerId: number | null = null;
	private lastArcballVector: Vec3 | null = null;
	private pinchStartDistance = 0;
	private pinchStartFovDeg = 100;
	private gestureStartFovDeg = 100;

	constructor(private readonly opts: InputControllerOptions) {}

	onPointerDown(event: PointerEvent) {
		if (!(event.target instanceof HTMLCanvasElement)) return;
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
			this.setFov(this.pinchStartFovDeg / Math.max(scale, EPSILON));
			return;
		}
		if (!this.dragging || event.pointerId !== this.activePointerId) return;
		const canvas = this.opts.canvas();
		if (!canvas || !this.lastArcballVector) return;
		const rect = canvas.getBoundingClientRect();
		const currentArcballVector = projectPointerToArcball(event.clientX, event.clientY, rect);
		const deltaRotation = quaternionBetweenVectors(this.lastArcballVector, currentArcballVector);
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
		const zoomFactor = Math.exp(event.deltaY * 0.0025);
		this.setFov(view.fovDeg * zoomFactor);
	}

	onCanvasGestureStart(event: Event) {
		event.preventDefault();
		this.gestureStartFovDeg = view.fovDeg;
	}

	onCanvasGestureChange(event: Event) {
		const gestureEvent = event as Event & { scale?: number };
		const scale = gestureEvent.scale;
		if (!scale || !Number.isFinite(scale)) return;
		event.preventDefault();
		this.setFov(this.gestureStartFovDeg / Math.max(scale, EPSILON));
	}

	setFov(nextFovDeg: number) {
		const clampedFovDeg = clamp(nextFovDeg, MIN_FOV_DEG, MAX_FOV_DEG);
		if (Math.abs(clampedFovDeg - view.fovDeg) <= 0.01) return;
		view.fovDeg = clampedFovDeg;
		this.opts.onChange();
	}

	private getPointersDistance() {
		const [a, b] = [...this.activePointers.values()];
		if (!a || !b) return 0;
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	private startPinchIfReady() {
		if (this.activePointers.size !== 2) return;
		this.pinchStartDistance = Math.max(this.getPointersDistance(), EPSILON);
		this.pinchStartFovDeg = view.fovDeg;
		this.dragging = false;
		this.activePointerId = null;
		this.lastArcballVector = null;
	}
}
