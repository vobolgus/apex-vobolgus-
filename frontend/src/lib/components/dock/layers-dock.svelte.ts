/**
 * The layers panel on the right of the chart, where a screen has the room for one
 * (a phone keeps the dock's popover): whether it is open, kept for the next visit,
 * and where the focus goes as it opens and closes. The dock's Layers button shows
 * and hides it (`LayersPopover`), and the panel closes itself (`LayersPanel`).
 */

import { tick } from 'svelte';
import type { Dropdown } from '$lib/ui/dropdown.svelte';

/** Whether the layers panel was left open, kept for the next visit. */
const LAYERS_PANEL_STORAGE_KEY = 'skycharts.layers.panel';

/** What the dock asks of the panel (`LayersPanel`'s exports). */
interface LayersPanelHandle {
	focusFirst(): void;
	hasFocus(): boolean;
}

/** Where the open flag is kept; it may refuse, or not be there at all. */
type PanelStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class LayersDock {
	/** The panel's id, which the Layers button names in `aria-controls`. */
	readonly id = 'layers-panel';
	open = $state(false);
	/** The panel, while it is there (`bind:this`). */
	panel: LayersPanelHandle | undefined = undefined;
	readonly #menu: Dropdown;
	readonly #storage: () => PanelStorage;

	/** `menu` is the Layers button's: its trigger takes the focus back from the panel. */
	constructor(menu: Dropdown, storage: () => PanelStorage = () => window.localStorage) {
		this.#menu = menu;
		this.#storage = storage;
	}

	/** Open the panel if it was left open. */
	restore(): void {
		try {
			this.open = this.#storage().getItem(LAYERS_PANEL_STORAGE_KEY) === '1';
		} catch {
			// Storage blocked: the panel starts closed, as on a first visit.
			this.open = false;
		}
	}

	/**
	 * Show or hide the layers panel, and remember which for the next visit. Opened
	 * from the keyboard (`focus`), the focus goes to its first switch.
	 */
	set = async (open: boolean, focus = false): Promise<void> => {
		this.open = open;
		try {
			this.#storage().setItem(LAYERS_PANEL_STORAGE_KEY, open ? '1' : '0');
		} catch {
			// Not remembered, then; the panel works all the same.
		}
		if (open && focus) {
			await tick();
			this.panel?.focusFirst();
		}
	};

	/** From the panel itself (its close button, Escape): the focus goes back to the Layers button. */
	close = (): void => {
		const focusInside = this.panel?.hasFocus() ?? false;
		void this.set(false);
		if (focusInside) this.#menu.trigger?.focus();
	};
}
