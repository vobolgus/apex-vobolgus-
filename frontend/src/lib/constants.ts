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
export const PINHOLE_CORNER_RADIUS = 22;
export const MIN_FOV_DEG = 20;
export const MAX_FOV_DEG = 120;
export const EPSILON = 1e-7;

// === Star rendering (stereographic) ===
export const STEREO_STAR_MIN_ALPHA = 0.38;
export const STEREO_STAR_ALPHA_MAG_DIVISOR = 8;
export const STEREO_STAR_MIN_RADIUS_PX = 0.45;
export const STEREO_STAR_BASE_RADIUS_PX = 3.5;
export const STEREO_STAR_MAG_RADIUS_COEFF = 0.4;

// === Star rendering (pinhole) ===
export const PINHOLE_STAR_MIN_ALPHA = 0.35;
export const PINHOLE_STAR_ALPHA_MAG_DIVISOR = 8;
export const PINHOLE_STAR_MIN_RADIUS_PX = 0.4;
export const PINHOLE_STAR_BASE_RADIUS_PX = 3.4;
export const PINHOLE_STAR_MAG_RADIUS_COEFF = 0.38;

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
