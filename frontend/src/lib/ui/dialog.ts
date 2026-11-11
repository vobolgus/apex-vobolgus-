/**
 * What the app's modal dialogs share. Each is a native `<dialog>` whose content
 * fills its box, so that a click on the dialog itself is a click on its backdrop.
 */

import type { Attachment } from 'svelte/attachments';
import { on } from 'svelte/events';

/**
 * A click on the backdrop closes the dialog (`close`), as Escape does for the
 * keyboard. Only a click that began there: a press inside that is let go outside
 * (a text selected, a drag that ends off the box) is no click on the backdrop.
 */
export function closesOnBackdrop(close: () => void): Attachment<HTMLDialogElement> {
	return (dialog) => {
		let pressed = false;
		const offPress = on(dialog, 'pointerdown', (event) => {
			pressed = event.target === dialog;
		});
		const offClick = on(dialog, 'click', (event) => {
			if (pressed && event.target === dialog) close();
			pressed = false;
		});
		return () => {
			offPress();
			offClick();
		};
	};
}
