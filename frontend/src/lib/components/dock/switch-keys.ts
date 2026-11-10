/**
 * ↑/↓ (Home/End) between the switch rows of a layer list, for the dock's popover
 * and the side panel alike. A key that moves the focus is spent here (default
 * prevented, propagation stopped), so the window-level sky rotation does not act
 * on the same arrow.
 */

/** The switch rows of `root`, in order. */
export function switchRows(root: ParentNode | null): HTMLElement[] {
	return root ? Array.from(root.querySelectorAll<HTMLElement>('[role="switch"]')) : [];
}

/** Move the focus for `event` if it is one of the four keys. True when it was. */
export function stepSwitchFocus(event: KeyboardEvent, root: ParentNode | null): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey) return false;
	const items = switchRows(root);
	const current = items.indexOf(document.activeElement as HTMLElement);
	let next: number;
	switch (event.key) {
		case 'ArrowDown':
			next = (current + 1) % items.length;
			break;
		case 'ArrowUp':
			next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
			break;
		case 'Home':
			next = 0;
			break;
		case 'End':
			next = items.length - 1;
			break;
		default:
			return false;
	}
	event.preventDefault();
	event.stopPropagation();
	items[next]?.focus();
	return true;
}
