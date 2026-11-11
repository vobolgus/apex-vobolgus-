import { describe, expect, it } from 'vitest';
import type { BlockKind } from '$lib/document/types';
import { blockCommand, repeatsWhenHeld, type BlockCommand } from './block-keys';

const KINDS: readonly BlockKind[] = ['chart', 'text', 'table'];
const TYPE: readonly BlockKind[] = ['text', 'table'];

function key(name: string, init: { code?: string; shiftKey?: boolean } = {}) {
	return { key: name, code: init.code ?? '', shiftKey: init.shiftKey ?? false };
}

describe('blockCommand', () => {
	it.each(KINDS)('nudges a %s with the arrows, further with Shift', (kind) => {
		expect(blockCommand(key('ArrowRight'), kind)).toEqual({ do: 'nudge', delta: { x: 1, y: 0 } });
		expect(blockCommand(key('ArrowUp', { shiftKey: true }), kind)).toEqual({
			do: 'nudge',
			delta: { x: 0, y: -10 }
		});
	});

	it.each(KINDS)('steps the size of a %s with + and −, on the number pad too', (kind) => {
		expect(blockCommand(key('+', { code: 'Equal', shiftKey: true }), kind)).toEqual({
			do: 'step',
			direction: 1
		});
		expect(blockCommand(key('='), kind)).toEqual({ do: 'step', direction: 1 });
		expect(blockCommand(key('-', { code: 'Minus' }), kind)).toEqual({ do: 'step', direction: -1 });
		expect(blockCommand(key('Clear', { code: 'NumpadSubtract' }), kind)).toEqual({
			do: 'step',
			direction: -1
		});
	});

	it.each(KINDS)('sends a %s to the page before or after with Page Up and Page Down', (kind) => {
		expect(blockCommand(key('PageUp'), kind)).toEqual({ do: 'toPage', by: -1 });
		expect(blockCommand(key('PageDown'), kind)).toEqual({ do: 'toPage', by: 1 });
	});

	it.each(KINDS)('removes a %s with Delete and Backspace', (kind) => {
		expect(blockCommand(key('Delete'), kind)).toEqual({ do: 'remove' });
		expect(blockCommand(key('Backspace'), kind)).toEqual({ do: 'remove' });
	});

	it.each(TYPE)('opens a %s on Enter and F2', (kind) => {
		expect(blockCommand(key('Enter'), kind)).toEqual({ do: 'edit' });
		expect(blockCommand(key('F2'), kind)).toEqual({ do: 'edit' });
	});

	it.each(TYPE)('turns a %s on R by the key’s place, back with Shift', (kind) => {
		expect(blockCommand(key('r', { code: 'KeyR' }), kind)).toEqual({ do: 'turn', direction: 1 });
		// A Russian layout types "к" there.
		expect(blockCommand(key('К', { code: 'KeyR', shiftKey: true }), kind)).toEqual({
			do: 'turn',
			direction: -1
		});
	});

	it('gives a chart none of the keys only type has', () => {
		expect(blockCommand(key('Enter'), 'chart')).toBeNull();
		expect(blockCommand(key('F2'), 'chart')).toBeNull();
		expect(blockCommand(key('r', { code: 'KeyR' }), 'chart')).toBeNull();
	});

	it.each(KINDS)('leaves every other key of a %s alone', (kind) => {
		expect(blockCommand(key('a', { code: 'KeyA' }), kind)).toBeNull();
		expect(blockCommand(key('Tab', { code: 'Tab' }), kind)).toBeNull();
		expect(blockCommand(key('Escape', { code: 'Escape' }), kind)).toBeNull();
		// Not a name on the map, whatever an object would answer to it.
		expect(blockCommand(key('constructor'), kind)).toBeNull();
	});
});

describe('repeatsWhenHeld', () => {
	const moving: BlockCommand[] = [
		{ do: 'nudge', delta: { x: 1, y: 0 } },
		{ do: 'step', direction: 1 }
	];
	const once: BlockCommand[] = [
		{ do: 'toPage', by: 1 },
		{ do: 'remove' },
		{ do: 'edit' },
		{ do: 'turn', direction: 1 }
	];

	it.each(KINDS)('keeps moving and sizing a %s while the key is held', (kind) => {
		for (const command of moving) expect(repeatsWhenHeld(command, kind)).toBe(true);
	});

	it.each(TYPE)('does not open, turn, send on or remove a %s twice for one press', (kind) => {
		for (const command of once) expect(repeatsWhenHeld(command, kind)).toBe(false);
	});

	it('takes every repeat of a chart’s keys as a press', () => {
		expect(repeatsWhenHeld({ do: 'toPage', by: 1 }, 'chart')).toBe(true);
		expect(repeatsWhenHeld({ do: 'remove' }, 'chart')).toBe(true);
	});
});
