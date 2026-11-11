/**
 * The chart's view: which way it looks, how wide in each projection, and the
 * pinhole frame's shape. One for the page; the input, the frame overlay and the
 * projection's morph write it, the renderer and the exports read it. Which
 * projection is shown is `ProjectionTransition`'s.
 */

import {
	PINHOLE_ASPECT_RATIO_DEFAULT,
	PINHOLE_FOV_DEG_DEFAULT,
	PINHOLE_HEIGHT_FRAC_DEFAULT
} from '$lib/constants';
import type { Quaternion } from '$lib/math/quaternion';

class ViewState {
	orientation = $state<Quaternion>({ x: 0, y: 0, z: 0, w: 1 });
	stereoFovDeg = $state(180);
	pinholeFovDeg = $state(PINHOLE_FOV_DEG_DEFAULT);
	pinholeAspectRatio = $state(PINHOLE_ASPECT_RATIO_DEFAULT);
	pinholeHeightFrac = $state(PINHOLE_HEIGHT_FRAC_DEFAULT);
}

export const view = new ViewState();
