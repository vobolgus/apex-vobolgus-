/**
 * Minimal dropdown/popover state.
 *
 * A `Dropdown` owns nothing but its open flag and the elements that anchor it;
 * the markup stays in the component so each menu keeps its own styling. A
 * `DropdownGroup` adds the behaviours every menu needs — one menu open at a
 * time, close on a pointerdown outside the anchor, close on Escape — once
 * instead of per menu.
 */

export class Dropdown {
	open = $state(false);
	/** Anchor element, wired up with `bind:this`. Used for hit-testing outside clicks. */
	element: HTMLElement | null = null;
	/** Trigger button, wired up with `bind:this`. `dismiss()` returns focus here. */
	trigger: HTMLElement | null = null;
	/** Set by `DropdownGroup`: opening this menu closes the other members first. */
	group: DropdownGroup | null = null;

	show() {
		this.group?.closeAll(this);
		this.open = true;
	}

	toggle() {
		if (this.open) this.close();
		else this.show();
	}

	close() {
		this.open = false;
	}

	/**
	 * Close from the keyboard. When focus was inside the menu it goes back to the
	 * trigger instead of falling to `<body>` as the menu unmounts.
	 */
	dismiss() {
		if (!this.open) return;
		const active = typeof document === 'undefined' ? null : document.activeElement;
		const focusInside = active !== null && (this.element?.contains(active) ?? false);
		this.open = false;
		if (focusInside) this.trigger?.focus();
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
		for (const member of members) member.group = this;
	}

	/** Close every member except `keep`. */
	closeAll(keep?: Dropdown) {
		for (const member of this.members) {
			if (member !== keep) member.close();
		}
	}

	private readonly handlePointerDown = (event: PointerEvent) => {
		for (const member of this.members) member.closeIfOutside(event.target);
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		for (const member of this.members) member.dismiss();
	};

	/**
	 * Attach the global dismiss listeners. Returns the cleanup function.
	 * Outside presses are caught in the capture phase, so a control that stops
	 * its pointerdown from bubbling (the frame resize handles) still closes menus.
	 */
	listen(target: Window = window): () => void {
		target.addEventListener('pointerdown', this.handlePointerDown, true);
		target.addEventListener('keydown', this.handleKeyDown);
		return () => {
			target.removeEventListener('pointerdown', this.handlePointerDown, true);
			target.removeEventListener('keydown', this.handleKeyDown);
		};
	}
}
