import { describe, expect, it } from 'vitest';
import {
	SHORTCUTS,
	ariaKeys,
	isApplePlatform,
	isHelpShortcut,
	isModShortcut,
	keyLabel,
	spokenKeys
} from './shortcuts';

function key(init: KeyboardEventInit): KeyboardEvent {
	return new KeyboardEvent('keydown', init);
}

describe('shortcut labels', () => {
	it('prints modifiers as glyphs on Apple platforms and as words elsewhere', () => {
		expect(['mod', 'shift', 'ctrl', 'P'].map((k) => keyLabel(k, true))).toEqual([
			'⌘',
			'⇧',
			'⌃',
			'P'
		]);
		expect(['mod', 'shift', 'ctrl', 'P'].map((k) => keyLabel(k, false))).toEqual([
			'Ctrl',
			'Shift',
			'Ctrl',
			'P'
		]);
	});

	it('spells the keys out for screen readers', () => {
		expect(spokenKeys(['mod', 'K'], true)).toBe('Command K');
		expect(spokenKeys(['mod', 'K'], false)).toBe('Control K');
		expect(spokenKeys(['shift', 'drag'], true)).toBe('Shift drag');
		expect(spokenKeys(['?'], true)).toBe('Question mark');
	});

	it('writes aria-keyshortcuts values', () => {
		expect(ariaKeys(['mod', 'S'], true)).toBe('Meta+S');
		expect(ariaKeys(['mod', 'S'], false)).toBe('Control+S');
		expect(ariaKeys(['shift', 'P'], true)).toBe('Shift+P');
	});

	it('lists every action once', () => {
		const actions = SHORTCUTS.map((shortcut) => shortcut.action);
		expect(new Set(actions).size).toBe(actions.length);
	});
});

describe('isApplePlatform', () => {
	it('reads the platform, falling back to the user agent', () => {
		expect(isApplePlatform({ platform: 'MacIntel', userAgent: '' })).toBe(true);
		expect(isApplePlatform({ platform: 'Win32', userAgent: '' })).toBe(false);
		expect(isApplePlatform({ platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' })).toBe(
			true
		);
	});
});

describe('isHelpShortcut', () => {
	it('takes ? by character and Shift + / by position', () => {
		expect(isHelpShortcut(key({ key: '?', code: 'Slash', shiftKey: true }))).toBe(true);
		// Russian layout: the US "?" key types ",", and "?" itself sits on Shift + 7.
		expect(isHelpShortcut(key({ key: ',', code: 'Slash', shiftKey: true }))).toBe(true);
		expect(isHelpShortcut(key({ key: '?', code: 'Digit7', shiftKey: true }))).toBe(true);
	});

	it('ignores / alone and ? with a command modifier', () => {
		expect(isHelpShortcut(key({ key: '/', code: 'Slash' }))).toBe(false);
		expect(isHelpShortcut(key({ key: '?', code: 'Slash', shiftKey: true, metaKey: true }))).toBe(
			false
		);
	});
});

describe('isModShortcut', () => {
	it('uses ⌘ on Apple platforms and Ctrl elsewhere', () => {
		const meta = key({ key: 'k', code: 'KeyK', metaKey: true });
		const ctrl = key({ key: 'k', code: 'KeyK', ctrlKey: true });
		expect(isModShortcut(meta, 'KeyK', true)).toBe(true);
		expect(isModShortcut(ctrl, 'KeyK', true)).toBe(false);
		expect(isModShortcut(ctrl, 'KeyK', false)).toBe(true);
		expect(isModShortcut(meta, 'KeyK', false)).toBe(false);
	});

	it('matches by key position and rejects extra modifiers', () => {
		// Russian layout: the K key types "л".
		expect(isModShortcut(key({ key: 'л', code: 'KeyK', metaKey: true }), 'KeyK', true)).toBe(true);
		expect(
			isModShortcut(key({ key: 'S', code: 'KeyS', metaKey: true, shiftKey: true }), 'KeyS', true)
		).toBe(false);
		expect(isModShortcut(key({ key: 'k', code: 'KeyK' }), 'KeyK', true)).toBe(false);
	});
});
