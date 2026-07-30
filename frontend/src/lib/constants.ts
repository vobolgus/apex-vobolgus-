/**
 * Generator-scoped numeric constants.
 *
 * Single source of truth for tuning parameters used by the generator
 * page and its `$lib/math/*` helpers. Grouped by domain for clarity.
 */

// === Projection animation timings ===
export const PROJECTION_TRANSITION_MS = 620;
export const PROJECTION_TRANSITION_MIN_MS = 220;

// === Perceptual LUT (motion-aware blend remapping) ===
export const PERCEPTUAL_LUT_POINTS = 72;
export const PERCEPTUAL_SAMPLE_TARGET = 1600;
export const PERCEPTUAL_VISIBILITY_WEIGHT = 42;
export const PERCEPTUAL_AREA_WEIGHT = 0.0045;
export const PERCEPTUAL_BLEND_MIX = 0.5;

// === Geometry & FOV ===
export const CHART_RADIUS_FRAC = 0.46;
export const PINHOLE_CORNER_RADIUS = 22;
export const MIN_FOV_DEG_STEREO = 20;
export const MAX_FOV_DEG_STEREO = 180;
export const MIN_FOV_DEG_PINHOLE = 20;
export const MAX_FOV_DEG_PINHOLE = 120;
// Pinhole viewport size as a fraction of `radius` (= min(canvas_w, canvas_h) * 0.46).
// Width is derived as aspect * height; both must stay within the chart-surface.
export const PINHOLE_HEIGHT_FRAC_DEFAULT = 1.18;
export const PINHOLE_ASPECT_RATIO_DEFAULT = 1.9 / 1.18;
export const PINHOLE_HEIGHT_FRAC_MIN = 0.3;
export const PINHOLE_HEIGHT_FRAC_MAX = 2.0;
export const PINHOLE_ASPECT_RATIO_MIN = 0.4;
export const PINHOLE_ASPECT_RATIO_MAX = 3.5;
export const EPSILON = 1e-7;

// === Star rendering (shared for stereographic & pinhole) ===
// size = max(STAR_MIN_RADIUS_PX, STAR_BASE_RADIUS_PX - STAR_MAG_COEFF * v_mag).
// Brighter stars (lower magnitude) → larger radius; clamped at MIN below.
export const STAR_MIN_RADIUS_PX = 0.5;
export const STAR_BASE_RADIUS_PX = 4.0;
export const STAR_MAG_COEFF = 0.75;
export const STAR_ALPHA = 1;

// === Projection clamps / SDF ===
export const PROJECTION_NORM_CLAMP = 1.8;
export const PROJECTION_INFINITE_SDF = 1.5;
export const PROJECTION_FINITE_EPSILON = 0.0001;

// === Visibility / SDF transitions ===
export const VISIBILITY_SMOOTHSTEP_INNER = -0.08;
export const VISIBILITY_SMOOTHSTEP_OUTER = 0.08;
export const VISIBILITY_CULL_THRESHOLD = 0.001;

// === Viewport stroke ===
export const VIEWPORT_STROKE_WIDTH_STEREO = 2.8;
export const VIEWPORT_STROKE_WIDTH_PINHOLE = 2.2;
