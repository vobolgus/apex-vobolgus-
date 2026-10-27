/**
 * Generator shortcuts, as listed in the About dialog, and the matchers for the
 * ones the page binds itself.
 *
 * The list documents bindings that live in the page (`+page.svelte`), the input
 * controller and the frame overlay; it binds nothing on its own. Keys are
 * written as names: `mod` is ⌘ on Apple platforms and Ctrl elsewhere, `shift`
 * and `ctrl` are the modifiers, anything else is printed as is.
 */

export interface Shortcut {
	action: string;
	keys: readonly string[];
}

export const SHORTCUTS: readonly Shortcut[] = [
	{ action: 'Rotate the sky', keys: ['drag'] },
	{ action: 'Look around, or arrows', keys: ['W', 'A', 'S', 'D'] },
	{ action: 'Roll', keys: ['Q', 'E'] },
	{ action: 'Zoom, or pinch', keys: ['ctrl', 'scroll'] },
	{ action: 'Zoom in', keys: ['shift', 'I'] },
	{ action: 'Zoom out', keys: ['shift', 'O'] },
	{ action: 'Turn north up', keys: ['shift', 'N'] },
	{ action: 'Switch projection', keys: ['shift', 'P'] },
	{ action: 'Square the frame while resizing', keys: ['shift', 'drag'] },
	{ action: 'Close a menu, cancel a resize', keys: ['Esc'] },
	{ action: 'Toggle export menu', keys: ['mod', 'K'] },
	{ action: 'Save PNG', keys: ['mod', 'S'] },
	{ action: 'Open shortcuts', keys: ['?'] }
];

const APPLE_LABELS: Record<string, string> = { mod: '⌘', shift: '⇧', ctrl: '⌃' };
const OTHER_LABELS: Record<string, string> = { mod: 'Ctrl', shift: 'Shift', ctrl: 'Ctrl' };
const SPOKEN: Record<string, string> = {
	shift: 'Shift',
	ctrl: 'Control',
	Esc: 'Escape',
	'?': 'Question mark'
};

/** The key as printed on its keycap. */
export function keyLabel(key: string, apple: boolean): string {
	return (apple ? APPLE_LABELS : OTHER_LABELS)[key] ?? key;
}

/** The keys as a screen reader should say them; the glyphs ⌘ ⇧ ⌃ read poorly. */
export function spokenKeys(keys: readonly string[], apple: boolean): string {
	return keys
		.map((key) => (key === 'mod' ? (apple ? 'Command' : 'Control') : (SPOKEN[key] ?? key)))
		.join(' ');
}

/** ⌘ is the command modifier on Apple keyboards, Ctrl everywhere else. */
export function isApplePlatform(nav: Pick<Navigator, 'platform' | 'userAgent'>): boolean {
	return /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent);
}

/**
 * `?`, on any layout: by the character it types, or by the US key position
 * (Shift + /), which types "," on a Russian layout.
 */
export function isHelpShortcut(event: KeyboardEvent): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey) return false;
	return event.key === '?' || (event.code === 'Slash' && event.shiftKey);
}

/** `mod` plus the key at `code` (layout independent), with no other modifier. */
export function isModShortcut(event: KeyboardEvent, code: string, apple: boolean): boolean {
	const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	return mod && !event.shiftKey && !event.altKey && event.code === code;
}
