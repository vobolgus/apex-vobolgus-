<script lang="ts">
	import { onMount } from 'svelte';

	type Star = {
		ra: number;
		dec: number;
		v_mag: number;
	};

	type StarVector = {
		x: number;
		y: number;
		z: number;
		v_mag: number;
	};

	type Vec3 = {
		x: number;
		y: number;
		z: number;
	};

	type Quaternion = {
		x: number;
		y: number;
		z: number;
		w: number;
	};

	type MorphInterpolatorFactory = (
		fromShape: string,
		toShape: string,
		options?: { maxSegmentLength?: number }
	) => (t: number) => string;

	let stars = $state<Star[]>([]);
	let orientation = $state<Quaternion>({ x: 0, y: 0, z: 0, w: 1 });

	let canvasEl: HTMLCanvasElement | null = null;
	let starVectors: StarVector[] = [];
	let dragging = false;
	let lastArcballVector: Vec3 | null = null;
	let activePointerId: number | null = null;
	let rafId = 0;
	let renderDirty = false;
	let exportMenuOpen = $state(false);
	let selectedExportFormat = $state<'PNG' | 'SVG' | 'PDF'>('PNG');
	let exportControlEl: HTMLDivElement | null = null;
	let projectionMenuOpen = $state(false);
	let projectionControlEl: HTMLDivElement | null = null;
	const exportFormats = ['PNG', 'SVG', 'PDF'] as const;
	const projectionOptions = ['stereographic', 'pinhole'] as const;
	let selectedProjection = $state<(typeof projectionOptions)[number]>('stereographic');
	const ARCBALL_ROTATION_GAIN = 1.2;
	const EPSILON = 1e-7;
	const MIN_FOV_DEG = 20;
	const MAX_FOV_DEG = 120;
	const PINHOLE_CORNER_RADIUS = 22;
	const PROJECTION_TRANSITION_MS = 620;
	const PROJECTION_TRANSITION_MIN_MS = 220;
	const FLUBBER_MAX_SEGMENT_LENGTH = 5;
	const PERCEPTUAL_LUT_POINTS = 72;
	const PERCEPTUAL_SAMPLE_TARGET = 1600;
	const PERCEPTUAL_VISIBILITY_WEIGHT = 42;
	const PERCEPTUAL_AREA_WEIGHT = 0.0045;
	let flubberInterpolate: MorphInterpolatorFactory | null = null;
	let fovDeg = $state(100);
	let projectionBlend = 0;
	let projectionBlendAnimating = false;
	let projectionBlendFrom = 0;
	let projectionBlendTo = 0;
	let projectionBlendStartMs = 0;
	let projectionBlendDurationMs = PROJECTION_TRANSITION_MS;
	let cachedViewportMorphKey = '';
	let cachedViewportInterpolator: ((t: number) => string) | null = null;
	let cachedMorphBlend = Number.NaN;
	let cachedMorphPath = '';
	let cachedMorphPath2D: Path2D | null = null;
	let cachedPerceptualKey = '';
	let cachedPerceptualCumulative: number[] | null = null;
	const activeCanvasPointers = new Map<number, { x: number; y: number }>();
	let pinchStartDistance = 0;
	let pinchStartFovDeg = 100;
	let gestureStartFovDeg = 100;

	onMount(() => {
		const handleOutsidePointerDown = (event: PointerEvent) => {
			if (exportMenuOpen && exportControlEl && !exportControlEl.contains(event.target as Node)) {
				exportMenuOpen = false;
			}
			if (projectionMenuOpen && projectionControlEl && !projectionControlEl.contains(event.target as Node)) {
				projectionMenuOpen = false;
			}
		};
		const handleEscapeKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			exportMenuOpen = false;
			projectionMenuOpen = false;
		};
		window.addEventListener('pointerdown', handleOutsidePointerDown);
		window.addEventListener('keydown', handleEscapeKey);
		canvasEl?.addEventListener('wheel', onCanvasWheel, { passive: false });
		canvasEl?.addEventListener('gesturestart', onCanvasGestureStart as EventListener, { passive: false });
		canvasEl?.addEventListener('gesturechange', onCanvasGestureChange as EventListener, { passive: false });

		void loadFlubber().then(() => {
			markRenderDirty();
		});

		void loadStars().then(() => {
			markRenderDirty();
		});
		return () => {
			window.removeEventListener('pointerdown', handleOutsidePointerDown);
			window.removeEventListener('keydown', handleEscapeKey);
			canvasEl?.removeEventListener('wheel', onCanvasWheel);
			canvasEl?.removeEventListener('gesturestart', onCanvasGestureStart as EventListener);
			canvasEl?.removeEventListener('gesturechange', onCanvasGestureChange as EventListener);
			if (rafId) {
				cancelAnimationFrame(rafId);
			}
		};
	});

	async function loadFlubber() {
		try {
			const module = await import('flubber');
			const maybeDefault = module.default as unknown;
			const interpolate =
				module.interpolate ??
				(typeof maybeDefault === 'function'
					? (maybeDefault as MorphInterpolatorFactory)
					: (maybeDefault as { interpolate?: MorphInterpolatorFactory } | undefined)?.interpolate);
			if (!interpolate) {
				console.warn('Flubber loaded without interpolate export; using hard switch fallback');
				return;
			}
			flubberInterpolate = interpolate;
			cachedViewportMorphKey = '';
			cachedViewportInterpolator = null;
			cachedMorphBlend = Number.NaN;
			cachedMorphPath = '';
			cachedMorphPath2D = null;
		} catch (error) {
			console.warn('Flubber lazy import failed; using hard switch fallback', error);
		}
	}

	function markRenderDirty() {
		renderDirty = true;
		if (rafId) return;
		rafId = requestAnimationFrame((frameTimeMs) => {
			rafId = 0;
			if (!renderDirty && !projectionBlendAnimating) return;
			renderDirty = false;
			renderChart(frameTimeMs);
			if (projectionBlendAnimating) {
				markRenderDirty();
			}
		});
	}

	function dot(a: Vec3, b: Vec3) {
		return a.x * b.x + a.y * b.y + a.z * b.z;
	}

	function cross(a: Vec3, b: Vec3): Vec3 {
		return {
			x: a.y * b.z - a.z * b.y,
			y: a.z * b.x - a.x * b.z,
			z: a.x * b.y - a.y * b.x
		};
	}

	function normalizeVec3(v: Vec3): Vec3 {
		const len = Math.hypot(v.x, v.y, v.z);
		if (len < EPSILON) return { x: 0, y: 0, z: 0 };
		return { x: v.x / len, y: v.y / len, z: v.z / len };
	}

	function normalizeQuaternion(q: Quaternion): Quaternion {
		const len = Math.hypot(q.x, q.y, q.z, q.w);
		if (len < EPSILON) return { x: 0, y: 0, z: 0, w: 1 };
		return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
	}

	function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
		return {
			x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
			y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
			z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
			w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
		};
	}

	function quaternionFromAxisAngle(axis: Vec3, angle: number): Quaternion {
		const halfAngle = angle * 0.5;
		const sinHalf = Math.sin(halfAngle);
		return normalizeQuaternion({
			x: axis.x * sinHalf,
			y: axis.y * sinHalf,
			z: axis.z * sinHalf,
			w: Math.cos(halfAngle)
		});
	}

	function quaternionBetweenVectors(from: Vec3, to: Vec3): Quaternion {
		const axis = cross(from, to);
		const axisLen = Math.hypot(axis.x, axis.y, axis.z);
		const alignment = Math.max(-1, Math.min(1, dot(from, to)));
		if (axisLen < EPSILON) {
			// Near parallel/opposite vectors: pick a stable fallback axis.
			if (alignment > 0) return { x: 0, y: 0, z: 0, w: 1 };
			const fallbackAxis = Math.abs(from.x) < 0.9 ? cross(from, { x: 1, y: 0, z: 0 }) : cross(from, { x: 0, y: 1, z: 0 });
			const normalizedFallback = normalizeVec3(fallbackAxis);
			return quaternionFromAxisAngle(normalizedFallback, Math.PI * ARCBALL_ROTATION_GAIN);
		}
		const normalizedAxis = { x: axis.x / axisLen, y: axis.y / axisLen, z: axis.z / axisLen };
		const angle = Math.acos(alignment) * ARCBALL_ROTATION_GAIN;
		return quaternionFromAxisAngle(normalizedAxis, angle);
	}

	function projectPointerToArcball(clientX: number, clientY: number, rect: DOMRect): Vec3 {
		const cx = rect.left + rect.width * 0.5;
		const cy = rect.top + rect.height * 0.5;
		const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
		// Keep interaction axes in sync with camera/view handedness.
		const x = (cx - clientX) / radius;
		const y = (cy - clientY) / radius;
		const squaredLength = x * x + y * y;
		if (squaredLength <= 1) {
			return { x, y, z: Math.sqrt(1 - squaredLength) };
		}
		const invLength = 1 / Math.sqrt(squaredLength);
		return { x: x * invLength, y: y * invLength, z: 0 };
	}

	function clamp(value: number, min: number, max: number) {
		return Math.min(max, Math.max(min, value));
	}

	function lerp(from: number, to: number, t: number) {
		return from + (to - from) * t;
	}

	function easeInOutCubic(t: number) {
		return 0.5 - Math.cos(Math.PI * clamp(t, 0, 1)) * 0.5;
	}

	function smoothstep(edge0: number, edge1: number, x: number) {
		if (Math.abs(edge1 - edge0) < EPSILON) {
			return x < edge0 ? 0 : 1;
		}
		const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
		return t * t * (3 - 2 * t);
	}

	function getProjectionFrameParams(width: number, height: number, scaleT: number) {
		const radius = Math.min(width, height) * 0.46;
		const pinholeViewportWidth = radius * 1.9;
		const pinholeViewportHeight = radius * 1.18;
		const stereoViewportWidth = radius * 2;
		const stereoViewportHeight = radius * 2;
		const normalizedScaleT = clamp(scaleT, 0, 1);
		const morphViewportWidth = lerp(stereoViewportWidth, pinholeViewportWidth, normalizedScaleT);
		const morphViewportHeight = lerp(stereoViewportHeight, pinholeViewportHeight, normalizedScaleT);
		const morphHalfWidth = morphViewportWidth * 0.5;
		const morphHalfHeight = morphViewportHeight * 0.5;
		const horizontalFovRad = (fovDeg * Math.PI) / 180;
		const tanHalfHorizontalFov = Math.tan(horizontalFovRad * 0.5);
		const morphAspect = morphViewportWidth / Math.max(1, morphViewportHeight);
		const tanHalfVerticalFov = tanHalfHorizontalFov / Math.max(morphAspect, EPSILON);
		return {
			radius,
			pinholeViewportWidth,
			pinholeViewportHeight,
			morphViewportWidth,
			morphViewportHeight,
			morphHalfWidth,
			morphHalfHeight,
			tanHalfHorizontalFov,
			tanHalfVerticalFov
		};
	}

	function sampleStarMorphFrame(
		star: StarVector,
		blend: number,
		params: ReturnType<typeof getProjectionFrameParams>
	): { px: number; py: number; visibility: number } {
		const [vx, vy, vz] = rotateVector(star.x, star.y, star.z);
		const denom = 1 + vz;
		const stereoFinite = denom > 0.0001;
		const stereoNormXRaw = stereoFinite ? vx / denom : 0;
		const stereoNormYRaw = stereoFinite ? vy / denom : 0;
		const stereoNormX = clamp(stereoNormXRaw, -1.8, 1.8);
		const stereoNormY = clamp(stereoNormYRaw, -1.8, 1.8);
		const stereoInsideDisk = stereoFinite && vz >= 0 && Math.hypot(stereoNormXRaw, stereoNormYRaw) <= 1;
		const stereoSdf = stereoInsideDisk ? Math.hypot(stereoNormXRaw, stereoNormYRaw) - 1 : 1.5;

		const pinholeFinite = vz > 0.0001;
		const pinholeNormXRaw = pinholeFinite ? (vx / vz) / params.tanHalfHorizontalFov : 0;
		const pinholeNormYRaw = pinholeFinite ? (vy / vz) / params.tanHalfVerticalFov : 0;
		const pinholeNormX = clamp(pinholeNormXRaw, -1.8, 1.8);
		const pinholeNormY = clamp(pinholeNormYRaw, -1.8, 1.8);
		const pinholeSdf = pinholeFinite ? Math.max(Math.abs(pinholeNormXRaw), Math.abs(pinholeNormYRaw)) - 1 : 1.5;

		const morphNormX = lerp(stereoNormX, pinholeNormX, blend);
		const morphNormY = lerp(stereoNormY, pinholeNormY, blend);
		const morphSdf = lerp(stereoSdf, pinholeSdf, blend);
		const visibility = 1 - smoothstep(-0.08, 0.08, morphSdf);
		return {
			px: morphNormX * params.morphHalfWidth,
			py: -morphNormY * params.morphHalfHeight,
			visibility
		};
	}

	function getPerceptualBlendCumulative(width: number, height: number) {
		// Cache key includes orientation: energy depends on which stars are visible
		// at each blend step, which changes when the user rotates the sky. Without
		// orientation in the key, the LUT goes stale after any drag/rotation.
		const orientationKey =
			`${orientation.x.toFixed(3)}:${orientation.y.toFixed(3)}:` +
			`${orientation.z.toFixed(3)}:${orientation.w.toFixed(3)}`;
		const key = `${width}:${height}:${fovDeg.toFixed(3)}:${starVectors.length}:${orientationKey}`;
		if (cachedPerceptualCumulative && cachedPerceptualKey === key) {
			return cachedPerceptualCumulative;
		}
		const cumulative = new Array<number>(PERCEPTUAL_LUT_POINTS).fill(0);
		if (starVectors.length < 2) {
			for (let i = 1; i < PERCEPTUAL_LUT_POINTS; i += 1) {
				cumulative[i] = i / (PERCEPTUAL_LUT_POINTS - 1);
			}
			cachedPerceptualKey = key;
			cachedPerceptualCumulative = cumulative;
			return cumulative;
		}

		const step = Math.max(1, Math.ceil(starVectors.length / PERCEPTUAL_SAMPLE_TARGET));
		const sampledIndices: number[] = [];
		for (let i = 0; i < starVectors.length; i += step) {
			sampledIndices.push(i);
		}
		const prevPx = new Array<number>(sampledIndices.length).fill(0);
		const prevPy = new Array<number>(sampledIndices.length).fill(0);
		const prevVisibility = new Array<number>(sampledIndices.length).fill(0);
		let prevArea = 0;

		for (let i = 0; i < PERCEPTUAL_LUT_POINTS; i += 1) {
			const blend = i / (PERCEPTUAL_LUT_POINTS - 1);
			const params = getProjectionFrameParams(width, height, blend);
			const area = params.morphViewportWidth * params.morphViewportHeight;
			if (i === 0) {
				for (let sampleIndex = 0; sampleIndex < sampledIndices.length; sampleIndex += 1) {
					const sample = sampleStarMorphFrame(starVectors[sampledIndices[sampleIndex]], blend, params);
					prevPx[sampleIndex] = sample.px;
					prevPy[sampleIndex] = sample.py;
					prevVisibility[sampleIndex] = sample.visibility;
				}
				prevArea = area;
				continue;
			}

			let motionSum = 0;
			let motionWeight = 0;
			let visibilityChangeSum = 0;
			for (let sampleIndex = 0; sampleIndex < sampledIndices.length; sampleIndex += 1) {
				const sample = sampleStarMorphFrame(starVectors[sampledIndices[sampleIndex]], blend, params);
				const visibilityWeight = Math.min(prevVisibility[sampleIndex], sample.visibility);
				if (visibilityWeight > 0.001) {
					const dx = sample.px - prevPx[sampleIndex];
					const dy = sample.py - prevPy[sampleIndex];
					motionSum += Math.hypot(dx, dy) * visibilityWeight;
					motionWeight += visibilityWeight;
				}
				visibilityChangeSum += Math.abs(sample.visibility - prevVisibility[sampleIndex]);
				prevPx[sampleIndex] = sample.px;
				prevPy[sampleIndex] = sample.py;
				prevVisibility[sampleIndex] = sample.visibility;
			}
			const avgMotion = motionWeight > EPSILON ? motionSum / motionWeight : 0;
			const avgVisibilityChange = visibilityChangeSum / sampledIndices.length;
			const areaChange = Math.abs(area - prevArea);
			const frameEnergy =
				avgMotion +
				PERCEPTUAL_VISIBILITY_WEIGHT * avgVisibilityChange +
				PERCEPTUAL_AREA_WEIGHT * areaChange;
			cumulative[i] = cumulative[i - 1] + Math.max(frameEnergy, EPSILON);
			prevArea = area;
		}

		const total = cumulative[cumulative.length - 1];
		if (total > EPSILON) {
			for (let i = 0; i < cumulative.length; i += 1) {
				cumulative[i] /= total;
			}
		} else {
			for (let i = 1; i < cumulative.length; i += 1) {
				cumulative[i] = i / (cumulative.length - 1);
			}
		}
		cachedPerceptualKey = key;
		cachedPerceptualCumulative = cumulative;
		return cumulative;
	}

	function getPerceptualProjectionBlend(rawBlend: number, width: number, height: number) {
		const normalizedRawBlend = clamp(rawBlend, 0, 1);
		if (normalizedRawBlend <= 0) return 0;
		if (normalizedRawBlend >= 1) return 1;
		const cumulative = getPerceptualBlendCumulative(width, height);
		// Forward (rawBlend < 0.5) or backward (rawBlend >= 0.5): traverse the
		// cumulative LUT once via binary search. The lookup itself is direction-
		// agnostic: R(rawBlend) is a deterministic function, so backward animation
		// is the exact time-reverse of forward. The only requirement is that R is
		// smooth — see the blend with the linear identity below.
		let perceptual = 1;
		for (let i = 1; i < cumulative.length; i += 1) {
			if (cumulative[i] < normalizedRawBlend) continue;
			const prev = cumulative[i - 1];
			const next = cumulative[i];
			const localT =
				Math.abs(next - prev) <= EPSILON ? 0 : (normalizedRawBlend - prev) / (next - prev);
			const prevBlend = (i - 1) / (cumulative.length - 1);
			const nextBlend = i / (cumulative.length - 1);
			perceptual = lerp(prevBlend, nextBlend, localT);
			break;
		}
		// The raw cumulative-energy remap has heavy peaks (visibility changes
		// dominate via the 42x weight) which makes the transition feel jumpy in
		// concentrated regions. Blend the perceptual remap with the linear
		// identity to soften extreme remapping. Mix factor controls how much of
		// the perceptual remap is applied (0 = pure linear, 1 = pure perceptual).
		// 0.5 keeps motion-aware pacing while preventing visible discontinuities.
		const PERCEPTUAL_MIX = 0.5;
		return lerp(normalizedRawBlend, perceptual, PERCEPTUAL_MIX);
	}

	function buildCirclePath(cx: number, cy: number, radius: number) {
		const r = Math.max(radius, EPSILON);
		return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
	}

	function buildRoundedRectPath(left: number, top: number, width: number, height: number, radius: number) {
		const right = left + width;
		const bottom = top + height;
		const r = clamp(radius, 0, Math.min(width, height) * 0.5);
		return [
			`M ${left + r} ${top}`,
			`H ${right - r}`,
			`A ${r} ${r} 0 0 1 ${right} ${top + r}`,
			`V ${bottom - r}`,
			`A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
			`H ${left + r}`,
			`A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,
			`V ${top + r}`,
			`A ${r} ${r} 0 0 1 ${left + r} ${top}`,
			'Z'
		].join(' ');
	}

	function getViewportMorphInterpolator(
		cx: number,
		cy: number,
		stereoRadius: number,
		pinholeWidth: number,
		pinholeHeight: number,
		pinholeRadius: number
	): (t: number) => string {
		const key = [
			String(cx),
			String(cy),
			String(stereoRadius),
			String(pinholeWidth),
			String(pinholeHeight),
			String(pinholeRadius)
		].join(':');
		if (cachedViewportInterpolator && cachedViewportMorphKey === key) {
			return cachedViewportInterpolator;
		}

		const pinholeLeft = cx - pinholeWidth * 0.5;
		const pinholeTop = cy - pinholeHeight * 0.5;
		const circlePath = buildCirclePath(cx, cy, stereoRadius);
		const roundedRectPath = buildRoundedRectPath(pinholeLeft, pinholeTop, pinholeWidth, pinholeHeight, pinholeRadius);
		if (!flubberInterpolate) {
			return (t: number) => (t < 0.5 ? circlePath : roundedRectPath);
		}
		cachedViewportInterpolator = flubberInterpolate(circlePath, roundedRectPath, {
			maxSegmentLength: FLUBBER_MAX_SEGMENT_LENGTH
		});
		cachedViewportMorphKey = key;
		cachedMorphBlend = Number.NaN;
		cachedMorphPath = '';
		cachedMorphPath2D = null;
		if (!cachedViewportInterpolator) {
			throw new Error('Viewport morph interpolator was not initialized');
		}
		return cachedViewportInterpolator;
	}

	function getMorphViewportPath2D(
		blend: number,
		interpolator: (t: number) => string
	): { path: string; path2D: Path2D } {
		const normalizedBlend = clamp(blend, 0, 1);
		if (cachedMorphPath2D && Math.abs(normalizedBlend - cachedMorphBlend) <= EPSILON) {
			return { path: cachedMorphPath, path2D: cachedMorphPath2D };
		}
		const path = interpolator(normalizedBlend);
		const path2D = new Path2D(path);
		cachedMorphBlend = normalizedBlend;
		cachedMorphPath = path;
		cachedMorphPath2D = path2D;
		return { path, path2D };
	}

	function getProjectionBlend(nowMs = performance.now()) {
		if (!projectionBlendAnimating) return projectionBlend;
		const t = clamp((nowMs - projectionBlendStartMs) / projectionBlendDurationMs, 0, 1);
		const eased = easeInOutCubic(t);
		projectionBlend = lerp(projectionBlendFrom, projectionBlendTo, eased);
		if (t >= 1) {
			projectionBlendAnimating = false;
			projectionBlend = projectionBlendTo;
		}
		return projectionBlend;
	}

	function startProjectionTransition(nextProjection: (typeof projectionOptions)[number]) {
		const targetBlend = nextProjection === 'pinhole' ? 1 : 0;
		const nowMs = performance.now();
		const currentBlend = getProjectionBlend(nowMs);
		selectedProjection = nextProjection;
		projectionMenuOpen = false;
		if (Math.abs(targetBlend - currentBlend) <= 0.001) {
			projectionBlendAnimating = false;
			projectionBlend = targetBlend;
			markRenderDirty();
			return;
		}
		projectionBlendFrom = currentBlend;
		projectionBlendTo = targetBlend;
		projectionBlendStartMs = nowMs;
		projectionBlendDurationMs = Math.max(
			PROJECTION_TRANSITION_MIN_MS,
			PROJECTION_TRANSITION_MS * Math.abs(projectionBlendTo - projectionBlendFrom)
		);
		projectionBlendAnimating = true;
		projectionBlend = currentBlend;
		markRenderDirty();
	}

	function setFov(nextFovDeg: number) {
		const clampedFovDeg = clamp(nextFovDeg, MIN_FOV_DEG, MAX_FOV_DEG);
		if (Math.abs(clampedFovDeg - fovDeg) <= 0.01) return;
		fovDeg = clampedFovDeg;
		markRenderDirty();
	}

	function getPointersDistance() {
		const [a, b] = [...activeCanvasPointers.values()];
		if (!a || !b) return 0;
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	function startPinchIfReady() {
		if (activeCanvasPointers.size !== 2) return;
		pinchStartDistance = Math.max(getPointersDistance(), EPSILON);
		pinchStartFovDeg = fovDeg;
		dragging = false;
		activePointerId = null;
		lastArcballVector = null;
	}

	async function loadStars() {
		try {
			const response = await fetch('/api/catalog/full?max_mag=6.5');
			if (!response.ok) throw new Error(`catalog load failed: ${response.status}`);
			stars = await response.json();
			starVectors = stars.map((star) => {
				const cosDec = Math.cos(star.dec);
				return {
					x: cosDec * Math.cos(star.ra),
					y: cosDec * Math.sin(star.ra),
					z: Math.sin(star.dec),
					v_mag: star.v_mag
				};
			});
			markRenderDirty();
		} catch (error) {
			console.error(error);
		}
	}

	function quaternionConjugate(q: Quaternion): Quaternion {
		return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
	}

	function rotateVectorByQuaternion(
		x: number,
		y: number,
		z: number,
		q: Quaternion
	): [number, number, number] {
		const qx = q.x;
		const qy = q.y;
		const qz = q.z;
		const qw = q.w;
		const uvx = qy * z - qz * y;
		const uvy = qz * x - qx * z;
		const uvz = qx * y - qy * x;
		const uuvx = qy * uvz - qz * uvy;
		const uuvy = qz * uvx - qx * uvz;
		const uuvz = qx * uvy - qy * uvx;
		const scale = 2 * qw;
		return [x + uvx * scale + uuvx * 2, y + uvy * scale + uuvy * 2, z + uvz * scale + uuvz * 2];
	}

	function rotateVector(x: number, y: number, z: number): [number, number, number] {
		const [rx, ry, rz] = rotateVectorByQuaternion(x, y, z, orientation);
		// Convert to view-space convention shared by both projection branches.
		return [-rx, ry, rz];
	}

	function renderChart(nowMs = performance.now()) {
		if (!canvasEl) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		const width = canvasEl.width;
		const height = canvasEl.height;
		const cx = width / 2;
		const cy = height / 2;
		// One blend drives ALL projection-dependent visuals.
		// rawBlend is the linear/eased time-domain driver (0..1 between start and end).
		// visualBlend is the perceptually-remapped blend used uniformly for viewport
		// size, viewport shape morph, and star positions. Driving all visuals from a
		// single scalar keeps forward (stereo->pinhole) and backward (pinhole->stereo)
		// transitions symmetric — each is the time-reverse of the other.
		const rawBlend = getProjectionBlend(nowMs);
		const visualBlend = getPerceptualProjectionBlend(rawBlend, width, height);
		const params = getProjectionFrameParams(width, height, visualBlend);
		const viewportInterpolator = getViewportMorphInterpolator(
			cx,
			cy,
			params.radius,
			params.pinholeViewportWidth,
			params.pinholeViewportHeight,
			PINHOLE_CORNER_RADIUS
		);
		const { path2D: morphViewportPath2D } = getMorphViewportPath2D(visualBlend, viewportInterpolator);

		// Keep outer canvas dark; white should be only inside active viewport.
		ctx.fillStyle = '#0a0a0b';
		ctx.fillRect(0, 0, width, height);

		// Flubber path morph: one interpolated path per frame for fill/stroke/clip.
		ctx.fillStyle = '#ffffff';
		ctx.fill(morphViewportPath2D);
		ctx.strokeStyle = visualBlend > 0.5 ? '#d7dbe3' : '#ffffff';
		ctx.lineWidth = lerp(2.8, 2.2, visualBlend);
		ctx.stroke(morphViewportPath2D);

		if (!starVectors.length) return;

		ctx.save();
		ctx.clip(morphViewportPath2D);
		ctx.fillStyle = '#000000';

		for (const star of starVectors) {
			const [vx, vy, vz] = rotateVector(star.x, star.y, star.z);
			const denom = 1 + vz;
			const stereoFinite = denom > 0.0001;
			const stereoNormXRaw = stereoFinite ? vx / denom : 0;
			const stereoNormYRaw = stereoFinite ? vy / denom : 0;
			const stereoNormX = clamp(stereoNormXRaw, -1.8, 1.8);
			const stereoNormY = clamp(stereoNormYRaw, -1.8, 1.8);
			const stereoInsideDisk = stereoFinite && vz >= 0 && Math.hypot(stereoNormXRaw, stereoNormYRaw) <= 1;
			const stereoSdf = stereoInsideDisk ? Math.hypot(stereoNormXRaw, stereoNormYRaw) - 1 : 1.5;
			const stereoAlpha = Math.max(0.38, 1 - star.v_mag / 8);
			const stereoRadius = Math.max(0.45, 3.5 - star.v_mag * 0.4);

			const pinholeFinite = vz > 0.0001;
			const pinholeNormXRaw = pinholeFinite ? (vx / vz) / params.tanHalfHorizontalFov : 0;
			const pinholeNormYRaw = pinholeFinite ? (vy / vz) / params.tanHalfVerticalFov : 0;
			const pinholeNormX = clamp(pinholeNormXRaw, -1.8, 1.8);
			const pinholeNormY = clamp(pinholeNormYRaw, -1.8, 1.8);
			const pinholeSdf = pinholeFinite
				? Math.max(Math.abs(pinholeNormXRaw), Math.abs(pinholeNormYRaw)) - 1
				: 1.5;
			const pinholeAlpha = Math.max(0.35, 1 - star.v_mag / 8);
			const pinholeRadius = Math.max(0.4, 3.4 - star.v_mag * 0.38);

			// Use one normalized morph space to avoid projection-density jumps.
			const morphNormX = lerp(stereoNormX, pinholeNormX, visualBlend);
			const morphNormY = lerp(stereoNormY, pinholeNormY, visualBlend);
			const px = cx + morphNormX * params.morphHalfWidth;
			const py = cy - morphNormY * params.morphHalfHeight;

			// Blend shape membership via SDF for smooth in/out near boundaries.
			const morphSdf = lerp(stereoSdf, pinholeSdf, visualBlend);
			const visibility = 1 - smoothstep(-0.08, 0.08, morphSdf);
			if (visibility <= 0.001) continue;

			const pointRadius = lerp(stereoRadius, pinholeRadius, visualBlend);
			const pointAlpha = lerp(stereoAlpha, pinholeAlpha, visualBlend);

			ctx.globalAlpha = pointAlpha * visibility;
			ctx.beginPath();
			ctx.arc(px, py, pointRadius, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		ctx.globalAlpha = 1;
	}

	function onPointerDown(event: PointerEvent) {
		if (!(event.target instanceof HTMLCanvasElement)) return;
		event.target.setPointerCapture(event.pointerId);
		activeCanvasPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (activeCanvasPointers.size >= 2) {
			startPinchIfReady();
			return;
		}
		dragging = true;
		activePointerId = event.pointerId;
		const rect = event.target.getBoundingClientRect();
		lastArcballVector = projectPointerToArcball(event.clientX, event.clientY, rect);
	}

	function onPointerMove(event: PointerEvent) {
		if (activeCanvasPointers.has(event.pointerId)) {
			activeCanvasPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}
		if (activeCanvasPointers.size === 2) {
			const currentDistance = Math.max(getPointersDistance(), EPSILON);
			const scale = currentDistance / Math.max(pinchStartDistance, EPSILON);
			setFov(pinchStartFovDeg / Math.max(scale, EPSILON));
			return;
		}
		if (!dragging || event.pointerId !== activePointerId) return;
		if (!canvasEl || !lastArcballVector) return;
		const rect = canvasEl.getBoundingClientRect();
		const currentArcballVector = projectPointerToArcball(event.clientX, event.clientY, rect);
		const deltaRotation = quaternionBetweenVectors(lastArcballVector, currentArcballVector);
		orientation = normalizeQuaternion(multiplyQuaternions(deltaRotation, orientation));
		lastArcballVector = currentArcballVector;
		markRenderDirty();
	}

	function onPointerUp(event: PointerEvent) {
		if (!activeCanvasPointers.has(event.pointerId)) return;
		if (canvasEl?.hasPointerCapture(event.pointerId)) {
			canvasEl.releasePointerCapture(event.pointerId);
		}
		activeCanvasPointers.delete(event.pointerId);
		if (activeCanvasPointers.size >= 2) {
			startPinchIfReady();
			return;
		}
		if (activeCanvasPointers.size === 1 && canvasEl) {
			const [nextPointerId, point] = [...activeCanvasPointers.entries()][0];
			dragging = true;
			activePointerId = nextPointerId;
			const rect = canvasEl.getBoundingClientRect();
			lastArcballVector = projectPointerToArcball(point.x, point.y, rect);
			return;
		}
		dragging = false;
		activePointerId = null;
		lastArcballVector = null;
		pinchStartDistance = 0;
	}

	function onCanvasWheel(event: WheelEvent) {
		if (!event.ctrlKey) return;
		event.preventDefault();
		const zoomFactor = Math.exp(event.deltaY * 0.0025);
		setFov(fovDeg * zoomFactor);
	}

	function onCanvasGestureStart(event: Event) {
		event.preventDefault();
		gestureStartFovDeg = fovDeg;
	}

	function onCanvasGestureChange(event: Event) {
		const gestureEvent = event as Event & { scale?: number };
		const scale = gestureEvent.scale;
		if (!scale || !Number.isFinite(scale)) return;
		event.preventDefault();
		setFov(gestureStartFovDeg / Math.max(scale, EPSILON));
	}

function exportChart(format: 'PNG' | 'SVG' | 'PDF') {
	if (!canvasEl) return;
	if (format === 'PNG') {
		const link = document.createElement('a');
		link.download = `skychart-${Date.now()}.png`;
		link.href = canvasEl.toDataURL('image/png');
		link.click();
		return;
	}
	console.info(`TODO: implement ${format} export`);
}

function handleExportPrimaryClick() {
	exportChart(selectedExportFormat);
}

function handleExportFormatSelect(format: 'PNG' | 'SVG' | 'PDF') {
	selectedExportFormat = format;
	exportMenuOpen = false;
	exportChart(format);
}

	function handleProjectionSelect(projection: (typeof projectionOptions)[number]) {
		startProjectionTransition(projection);
	}
</script>

<main
	class="page"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<header class="ray-header">
		<div class="ray-bottom">
			<div class="ray-left">
				<img src="/icon-constellation.png" alt="Apex icon" class="ray-logo" />
				<span class="ray-textline">
					<span class="ray-brand">Skycharts</span>
					<span class="ray-meta-word">by Apex</span>
				</span>
			</div>
			<div class="ray-right">
				<button class="tool-btn" type="button">About</button>
				<button class="tool-btn" type="button">Format</button>
				<div class="export-wrap" bind:this={exportControlEl}>
					<button class="export-main" type="button" onclick={handleExportPrimaryClick}>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path
								d="M8 1.75a.75.75 0 0 1 .75.75v5.69l1.97-1.97a.75.75 0 1 1 1.06 1.06L8.53 10.53a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 1.06-1.06l1.97 1.97V2.5A.75.75 0 0 1 8 1.75ZM2.75 12a.75.75 0 0 1 .75.75v.5h9v-.5a.75.75 0 0 1 1.5 0V13A1.75 1.75 0 0 1 12.25 14.75h-8.5A1.75 1.75 0 0 1 2 13v-.25a.75.75 0 0 1 .75-.75Z"
							/>
						</svg>
						<span>Export Image</span>
					</button>
					<button
						class="export-toggle"
						type="button"
						aria-label="Choose export format"
						aria-haspopup="menu"
						aria-expanded={exportMenuOpen}
						onclick={() => (exportMenuOpen = !exportMenuOpen)}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4.22 6.97a.75.75 0 0 1 1.06 0L8 9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 0 1 0-1.06Z" />
						</svg>
					</button>
					{#if exportMenuOpen}
						<div class="export-menu" role="menu" aria-label="Export format">
							{#each exportFormats as format}
								<button
									class="export-option"
									class:is-selected={format === selectedExportFormat}
									type="button"
									role="menuitemradio"
									aria-checked={format === selectedExportFormat}
									onclick={() => handleExportFormatSelect(format)}
								>
									<span class="export-option-icon" aria-hidden="true">
										{#if format === 'PNG'}
											◼
										{:else if format === 'SVG'}
											◇
										{:else}
											▤
										{/if}
									</span>
									<span class="export-option-label">{format}</span>
									<span class="export-option-check" aria-hidden="true">
										{format === selectedExportFormat ? '✓' : ''}
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</header>
	<canvas bind:this={canvasEl} width="1200" height="1200"></canvas>
	<div class="control-bar-shell">
		<div class="control-bar" role="group" aria-label="Generator display controls">
			<div class="control-group projection-group">
				<label class="control-label control-label-no-caps" id="projection-label">Projection</label>
				<div class="projection-wrap" bind:this={projectionControlEl}>
					<button
						class="projection-trigger"
						type="button"
						aria-haspopup="listbox"
						aria-expanded={projectionMenuOpen}
						aria-labelledby="projection-label projection-trigger-value"
						onclick={() => (projectionMenuOpen = !projectionMenuOpen)}
					>
						<span id="projection-trigger-value">{selectedProjection}</span>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4.22 6.97a.75.75 0 0 1 1.06 0L8 9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 0 1 0-1.06Z" />
						</svg>
					</button>
					{#if projectionMenuOpen}
						<div class="projection-menu" role="listbox" aria-labelledby="projection-label">
							{#each projectionOptions as projection}
								<button
									class="projection-option"
									class:is-selected={projection === selectedProjection}
									type="button"
									role="option"
									aria-selected={projection === selectedProjection}
									onclick={() => handleProjectionSelect(projection)}
								>
									<span class="projection-option-label">{projection}</span>
									<span class="projection-option-check" aria-hidden="true">
										{projection === selectedProjection ? '✓' : ''}
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</main>

<style>
	.page {
		position: relative;
		width: 100%;
		min-height: 100vh;
		background: #0a0a0b;
		display: grid;
		place-items: center;
		overflow: hidden;
		padding-top: 56px;
		padding-bottom: 136px;
	}

	.ray-header {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		padding: 0 10px;
		display: flex;
		align-items: center;
		background: #101114;
		border-bottom: none;
		z-index: 5;
	}

	.ray-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-width: 0;
		width: 100%;
	}

	.ray-left {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.ray-logo {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		object-fit: cover;
	}

	.ray-textline {
		display: inline-flex;
		align-items: baseline;
		gap: 14px;
		line-height: 1;
	}

	.ray-brand {
		font-size: 0.98rem;
		font-weight: 400;
		color: #eceef1;
		letter-spacing: 0;
		line-height: 1;
		font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
	}

	.ray-meta-word {
		font-size: 0.74rem;
		font-weight: 400;
		color: #8f939a;
		line-height: 1;
	}

	.ray-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 11px;
		border-radius: 7px;
		border: 1px solid transparent;
		background: transparent;
		color: #b8bec8;
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		transition: border-color 0.16s ease, color 0.16s ease, box-shadow 0.2s ease, background 0.2s ease;
	}

	.tool-btn:hover {
		border-color: rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.06);
		color: #f1f3f6;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
	}

	.tool-btn:active {
		background: rgba(255, 255, 255, 0.08);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
	}

	.export-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 30px;
		border-radius: 8px;
		border: 1px solid rgba(255, 124, 124, 0.88);
		background: linear-gradient(180deg, #d34b4b 0%, #bd3d3d 100%);
		box-shadow: 0 0 0 1px rgba(204, 70, 70, 0.5);
		overflow: hidden;
	}

	.export-wrap:hover {
		background: linear-gradient(180deg, #df5757 0%, #c94848 100%);
		border-color: rgba(255, 148, 148, 0.92);
	}

	.export-main,
	.export-toggle {
		height: 100%;
		border: 0;
		background: transparent;
		color: #fff0f0;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
		font-size: 0.74rem;
		font-weight: 600;
	}

	.export-main {
		gap: 7px;
		padding: 0 12px 0 11px;
	}

	.export-main span {
		color: #ffd1d1;
	}

	.export-main svg,
	.export-toggle svg {
		width: 14px;
		height: 14px;
		fill: currentColor;
	}

	.export-toggle {
		width: 30px;
		justify-content: center;
		border-left: 1px solid rgba(255, 219, 219, 0.28);
	}

	.export-toggle[aria-expanded='true'] {
		background: rgba(255, 255, 255, 0.12);
	}

	.export-main:hover,
	.export-toggle:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.export-main:active,
	.export-toggle:active {
		background: rgba(255, 255, 255, 0.14);
	}

	.export-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		min-width: 138px;
		padding: 4px;
		border-radius: 9px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: linear-gradient(180deg, #1b1d22 0%, #14161b 100%);
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.42),
			0 1px 0 rgba(255, 255, 255, 0.08) inset;
		display: grid;
		gap: 2px;
		z-index: 20;
	}

	.export-option {
		height: 30px;
		padding: 0 8px;
		border-radius: 6px;
		border: 0;
		background: transparent;
		color: #c9ced7;
		font-size: 0.72rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		line-height: 1;
		display: grid;
		grid-template-columns: 14px 1fr auto;
		align-items: center;
		column-gap: 8px;
		cursor: pointer;
		transition: background 0.14s ease, color 0.14s ease;
	}

	.export-option-icon {
		color: #8f96a1;
		font-size: 0.6rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
	}

	.export-option-label {
		text-align: left;
	}

	.export-option-check {
		color: #e7ebf4;
		font-size: 0.66rem;
		min-width: 10px;
		text-align: right;
		opacity: 0.95;
	}

	.export-option:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #eef2fa;
	}

	.export-option:active {
		background: rgba(255, 255, 255, 0.12);
	}

	.export-option.is-selected {
		background: rgba(255, 255, 255, 0.1);
		color: #f3f6fd;
	}

	.export-option.is-selected .export-option-icon {
		color: #d5dbea;
	}

	canvas {
		width: 700px;
		height: 700px;
		display: block;
		aspect-ratio: 1 / 1;
		object-fit: contain;
		touch-action: none;
		cursor: grab;
	}

	canvas:active {
		cursor: grabbing;
	}

	.control-bar-shell {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 2px;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 6;
	}

	.control-bar {
		width: 920px;
		max-width: 920px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		row-gap: 10px;
		gap: 12px;
		padding: 14px 18px;
		border-radius: 20px 20px 0 0;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: linear-gradient(180deg, #141518 0%, #0f1012 100%);
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.42),
			0 1px 0 rgba(255, 255, 255, 0.06) inset;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		overflow: visible;
		pointer-events: auto;
	}

	.control-group {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.projection-group {
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}

	.control-label {
		color: #9299a6;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.control-label-no-caps {
		text-transform: none;
		letter-spacing: 0;
	}

	.control-divider {
		width: 1px;
		height: 24px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.22) 48%, rgba(255, 255, 255, 0.04) 100%);
		flex-shrink: 0;
	}

	.chip-row {
		display: inline-flex;
		gap: 6px;
	}

	.control-chip {
		height: 28px;
		padding: 0 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
		color: #d4dae3;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
	}

	.control-chip:hover {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f9;
	}

	.control-chip:active {
		background: rgba(255, 255, 255, 0.14);
	}

	.control-chip.is-active {
		border-color: rgba(170, 198, 255, 0.6);
		background: rgba(113, 148, 220, 0.24);
		color: #f4f8ff;
	}

	.toggle-chip {
		height: 28px;
		padding: 0 10px 0 8px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.03);
		color: #d4dae3;
		font-size: 0.72rem;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
	}

	.toggle-chip:hover {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f9;
	}

	.toggle-chip:active {
		background: rgba(255, 255, 255, 0.14);
	}

	.toggle-chip.is-on {
		border-color: rgba(128, 169, 242, 0.65);
		background: rgba(108, 144, 216, 0.22);
	}

	.toggle-thumb {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: #7e8694;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4) inset;
		transition: background 0.16s ease;
	}

	.toggle-chip.is-on .toggle-thumb {
		background: #d6e6ff;
	}

	.projection-wrap {
		position: relative;
	}

	.projection-trigger {
		height: 28px;
		min-width: 146px;
		padding: 0 10px 0 12px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.13);
		background: rgba(255, 255, 255, 0.03);
		color: #d8deea;
		font-size: 0.72rem;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		text-transform: lowercase;
		cursor: pointer;
		transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
	}

	.projection-trigger svg {
		width: 14px;
		height: 14px;
		fill: #adb4bf;
		flex-shrink: 0;
		transition: transform 0.14s ease, fill 0.14s ease;
	}

	.projection-trigger:hover {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f9;
	}

	.projection-trigger[aria-expanded='true'] {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.projection-trigger[aria-expanded='true'] svg {
		transform: rotate(180deg);
		fill: #d1d7e2;
	}

	.projection-trigger:active {
		background: rgba(255, 255, 255, 0.12);
	}

	.projection-trigger:focus-visible {
		outline: 2px solid rgba(209, 215, 226, 0.48);
		outline-offset: 2px;
	}

	.projection-menu {
		position: absolute;
		left: 0;
		bottom: calc(100% + 6px);
		width: 100%;
		max-height: min(220px, calc(100vh - 24px));
		overflow-y: auto;
		padding: 4px;
		border-radius: 9px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: linear-gradient(180deg, #1b1d22 0%, #14161b 100%);
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.42),
			0 1px 0 rgba(255, 255, 255, 0.08) inset;
		display: grid;
		gap: 2px;
		z-index: 20;
	}

	.projection-option {
		height: 30px;
		padding: 0 9px;
		border-radius: 6px;
		border: 0;
		background: transparent;
		color: #c9ced7;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		line-height: 1;
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		column-gap: 8px;
		cursor: pointer;
		text-transform: lowercase;
		transition: background 0.14s ease, color 0.14s ease;
	}

	.projection-option-label {
		text-align: left;
	}

	.projection-option-check {
		color: #e7ebf4;
		font-size: 0.66rem;
		min-width: 10px;
		text-align: right;
		opacity: 0.95;
	}

	.projection-option:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #eef2fa;
	}

	.projection-option:active {
		background: rgba(255, 255, 255, 0.12);
	}

	.projection-option.is-selected {
		background: rgba(255, 255, 255, 0.1);
		color: #f3f6fd;
	}

	@media (max-width: 640px) {
		.ray-meta-word {
			display: none;
		}
		.ray-right {
			gap: 6px;
		}
		.tool-btn {
			padding: 0 8px;
		}
	}

	@media (max-width: 860px) {
		.page {
			padding-bottom: 136px;
		}

		canvas {
			width: min(700px, 92vw, calc(100vh - 164px));
			height: min(700px, 92vw, calc(100vh - 164px));
		}

		.control-bar {
			width: 100%;
			max-width: 100%;
			padding: 14px 10px;
			gap: 12px;
			border-radius: 0;
			border-left: 0;
			border-right: 0;
		}
	}

</style>
