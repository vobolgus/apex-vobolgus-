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
// Pinhole starts here, and a switch from a wider stereo view starts no wider than
// this, so the frame keeps room to widen: at MAX_FOV_DEG_PINHOLE it could only shrink.
export const PINHOLE_FOV_DEG_DEFAULT = 100;
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

// === Chart colours (the SVG/PDF export sends the same, see `api/render-config.ts`) ===
export const CHART_PAGE_COLOR = '#0a0a0b';
export const CHART_SKY_COLOR = '#ffffff';
export const STAR_COLOR = '#000000';

// === Chart canvas ===
// Backing-store size of the chart canvas; the renderer works in these px and CSS
// scales the canvas to the chart surface, so canvas px × S / 1200 = CSS px.
export const CHART_CANVAS_BACKING_PX = 1200;

// === Pinhole frame overlay (DOM resize handles over the canvas, all in CSS px) ===
// Handles sit outside the frame: the centre line of their stroke runs this far out
// from the frame outline, and corner brackets are concentric with its rounded corners.
export const PINHOLE_HANDLE_GAP_PX = 5;
export const PINHOLE_HANDLE_STROKE_PX = 3;
// Straight part of a corner bracket after its arc.
export const PINHOLE_BRACKET_ARM_PX = 14;
export const PINHOLE_EDGE_PILL_LENGTH_PX = 24;
// A side shorter than this drops its edge pill (5 × pill length), and one shorter
// than PINHOLE_BRACKET_ARM_MIN_SIDE_PX drops the bracket arms along it.
export const PINHOLE_EDGE_PILL_MIN_SIDE_PX = 120;
export const PINHOLE_BRACKET_ARM_MIN_SIDE_PX = 40;
// Hit areas. An edge hit spans the straight part of its side; `inset` of its
// thickness lies inside the frame and the rest outside. Corner hits are squares
// with the same outer extent as the edge hits. The coarse set is for touch.
export const PINHOLE_EDGE_HIT_PX = 16;
export const PINHOLE_EDGE_HIT_INSET_PX = 4;
export const PINHOLE_CORNER_HIT_PX = 32;
export const PINHOLE_EDGE_HIT_COARSE_PX = 32;
export const PINHOLE_EDGE_HIT_INSET_COARSE_PX = 8;
export const PINHOLE_CORNER_HIT_COARSE_PX = 44;
// Pointer within this distance of the frame counts as "near" and wakes the handles up.
export const PINHOLE_NEAR_MARGIN_PX = 24;
// Room a resize keeps between the frame and the clipping edge of the chart area,
// so handles and coarse hit areas stay on screen where the surface fills the width.
export const PINHOLE_CLIP_MARGIN_PX = 36;
// Readout pill under the frame.
export const PINHOLE_READOUT_GAP_PX = 12;
export const PINHOLE_READOUT_HEIGHT_PX = 24;
// How long the readout stays up after a zoom or resize ends.
export const PINHOLE_READOUT_LINGER_MS = 600;
// Centre crosshair shown while dragging (arm-to-arm length).
export const PINHOLE_CROSSHAIR_PX = 12;
// Keyboard steps for the edge sliders, in degrees of field of view.
export const PINHOLE_KEY_STEP_DEG = 1;
export const PINHOLE_KEY_STEP_SHIFT_DEG = 5;
