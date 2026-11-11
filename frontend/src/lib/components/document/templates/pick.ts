/** What opens the template picker: a page to lay out, and where the picker stands. */

/** What the picker stands beside or under, window px. */
export interface PickerAnchor {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A page being laid out as a template, and what its picker stands by. */
export interface TemplatePick {
	pageId: string;
	anchor: PickerAnchor;
}
