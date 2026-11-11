/**
 * The keys of a selected block: which key asks for what. One map for a chart, a
 * text and a table; the keys only type has (Enter to type in it, R to turn it) are
 * told apart here and nowhere else. Pure functions, no DOM.
 */

import type { BlockKind } from '$lib/document/types';
import { nudgeDelta, sizeStep, type Point } from '../editor-geometry';

/** What a key asks of the selected block. */
export type BlockCommand =
	| { do: 'nudge'; delta: Point }
	/** One step larger or smaller: a chart's size, a text's type. */
	| { do: 'step'; direction: 1 | -1 }
	/** To the page before or after. */
	| { do: 'toPage'; by: 1 | -1 }
	| { do: 'remove' }
	/** Start typing in it. */
	| { do: 'edit' }
	/** A quarter turn: clockwise, or back. */
	| { do: 'turn'; direction: 1 | -1 };

type Key = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>;

/**
 * The command a key gives a selected block of `kind`, null for a key that is not
 * one of its own. Arrows nudge (Shift: further), + and − step the size, Page Up and
 * Page Down send it to the page before or after, Delete and Backspace remove it. A
 * text or a table also opens on Enter or F2 and turns on R (Shift: back), by the
 * key's place, so that it turns on every layout.
 */
export function blockCommand(event: Key, kind: BlockKind): BlockCommand | null {
	const delta = nudgeDelta(event.key, event.shiftKey);
	if (delta) return { do: 'nudge', delta };
	const step = sizeStep(event.key, event.code);
	if (step !== 0) return { do: 'step', direction: step };
	if (kind !== 'chart') {
		if (event.key === 'Enter' || event.key === 'F2') return { do: 'edit' };
		if (event.code === 'KeyR') return { do: 'turn', direction: event.shiftKey ? -1 : 1 };
	}
	switch (event.key) {
		case 'PageUp':
			return { do: 'toPage', by: -1 };
		case 'PageDown':
			return { do: 'toPage', by: 1 };
		case 'Delete':
		case 'Backspace':
			return { do: 'remove' };
		default:
			return null;
	}
}

/**
 * Whether a key held down gives its command again. Moving and sizing always go on.
 * A text does not open, turn, move away or go twice for one press; a chart takes
 * every repeat of its keys as a press.
 */
export function repeatsWhenHeld(command: BlockCommand, kind: BlockKind): boolean {
	return command.do === 'nudge' || command.do === 'step' || kind === 'chart';
}
