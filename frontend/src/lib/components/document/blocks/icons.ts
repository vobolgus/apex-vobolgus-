/**
 * The icons of the editor's blocks and their toolbars, each a stroked path in a
 * 16-unit box: one drawing for one thing wherever it is shown.
 */

export const ICONS = {
	/** Smaller, fewer; a chart's ⊖. */
	minus: 'M4.5 8h7',
	/** Larger, more. */
	plus: 'M4.5 8h7M8 4.5v7',
	/** A chart made smaller: its corners drawn in. */
	shrink: 'M9.25 3.25v3.5h3.5M6.75 12.75v-3.5h-3.5M9.25 6.75l3.5-3.5M6.75 9.25l-3.5 3.5',
	/** A chart made larger: its corners drawn out. */
	grow: 'M9.25 3.25h3.5v3.5M6.75 12.75h-3.5v-3.5M12.75 3.25l-3.5 3.5M3.25 12.75l3.5-3.5',
	/** To the page before. */
	before: 'M9.75 4.5 6.25 8l3.5 3.5',
	/** To the page after. */
	after: 'M6.25 4.5 9.75 8l-3.5 3.5',
	/** A quarter turn clockwise, and the knob that turns freely. */
	turn: 'M12.5 8a4.5 4.5 0 1 1-1.6-3.45M12.75 2.5v2.75H10',
	/** Remove, delete. */
	bin: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.75 7v3.5M9.25 7v3.5'
} as const;

/** The lines of a text as each alignment sets them. */
export const ALIGN_ICONS = {
	left: 'M3 4.5h10M3 8h6.5M3 11.5h8.5',
	center: 'M3 4.5h10M4.75 8h6.5M3.75 11.5h8.5',
	right: 'M3 4.5h10M6.5 8H13M4.5 11.5H13'
} as const;
