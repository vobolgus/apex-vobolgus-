/**
 * Minimal dropdown/popover state.
 *
 * A `Dropdown` owns nothing but its open flag and the element that anchors it;
 * the markup stays in the component so each menu keeps its own styling. A
 * `DropdownGroup` adds the two behaviours every menu needs — close on a
 * pointerdown outside the anchor, close on Escape — once instead of per menu.
 */

export class Dropdown {
	open = $state(false);
	/** Anchor element, wired up with `bind:this`. Used for hit-testing outside clicks. */
	element: HTMLElement | null = null;

	toggle() {
		this.open = !this.open;
	}

	close() {
		this.open = false;
	}

	/** Close the menu when `target` lies outside its anchor element. */
	closeIfOutside(target: EventTarget | null) {
		if (this.open && this.element && !this.element.contains(target as Node)) {
			this.open = false;
		}
	}
}

export class DropdownGroup {
	private readonly members: readonly Dropdown[];

	constructor(...members: Dropdown[]) {
		this.members = members;
	}

	closeAll() {
		for (const member of this.members) member.close();
	}

	private readonly handlePointerDown = (event: PointerEvent) => {
		for (const member of this.members) member.closeIfOutside(event.target);
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') this.closeAll();
	};

	/** Attach the global dismiss listeners. Returns the cleanup function. */
	listen(target: Window = window): () => void {
		target.addEventListener('pointerdown', this.handlePointerDown);
		target.addEventListener('keydown', this.handleKeyDown);
		return () => {
			target.removeEventListener('pointerdown', this.handlePointerDown);
			target.removeEventListener('keydown', this.handleKeyDown);
		};
	}
}
