/**
 * Option data for the dock's segmented controls.
 */

import type { ProjectionMode } from '$lib/state/projection-transition.svelte';

export interface SegmentOption<T extends string> {
	value: T;
	/** Short visible label. Narrow screens hide it and keep only the icon. */
	label: string;
	/** Full name, used as the accessible name and in the tooltip. */
	name: string;
	/** 16 px icon: one SVG path in a 16×16 box, stroked with `currentColor`. */
	iconPath: string;
}

export const PROJECTION_SEGMENTS: readonly SegmentOption<ProjectionMode>[] = [
	{
		value: 'stereographic',
		label: 'Stereo',
		name: 'Stereographic projection',
		// Disc: the whole-sky stereographic chart.
		iconPath: 'M8 2.75a5.25 5.25 0 1 1 0 10.5a5.25 5.25 0 1 1 0-10.5Z'
	},
	{
		value: 'pinhole',
		label: 'Pinhole',
		name: 'Pinhole projection',
		// Rounded rectangle: the pinhole camera frame.
		iconPath: 'M4 3.75h8a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4.5a2 2 0 0 1 2-2Z'
	}
];
