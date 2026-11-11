/**
 * Generator shortcuts, as listed in the About dialog, and the table of the ones
 * the page binds itself (`pageCommand`).
 *
 * The list documents bindings that live in the page (the table below), the input
 * controller and the frame overlay; it binds nothing on its own. Keys are
 * written as names: `mod` is ⌘ on Apple platforms and Ctrl elsewhere, `shift`
 * and `ctrl` are the modifiers, anything else is printed as is.
 */

interface Shortcut {
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
	{ action: 'Undo a deletion', keys: ['mod', 'Z'] },
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

const ARIA_KEYS: Record<string, string> = { shift: 'Shift', ctrl: 'Control' };

/** The keys as an `aria-keyshortcuts` value, e.g. "Meta+S". */
export function ariaKeys(keys: readonly string[], apple: boolean): string {
	return keys
		.map((key) => (key === 'mod' ? (apple ? 'Meta' : 'Control') : (ARIA_KEYS[key] ?? key)))
		.join('+');
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

/** What a key does on the generator page itself; the keys it leaves alone turn the sky. */
type PageCommand = 'undo' | 'help' | 'exportMenu' | 'savePng' | 'switchProjection';

/** The page's own keys, in the order they are tried: the first that matches is the one. */
const PAGE_KEYS: readonly {
	command: PageCommand;
	matches: (event: KeyboardEvent, apple: boolean) => boolean;
}[] = [
	{ command: 'undo', matches: (event, apple) => isModShortcut(event, 'KeyZ', apple) },
	{ command: 'help', matches: isHelpShortcut },
	{ command: 'exportMenu', matches: (event, apple) => isModShortcut(event, 'KeyK', apple) },
	{ command: 'savePng', matches: (event, apple) => isModShortcut(event, 'KeyS', apple) },
	{
		command: 'switchProjection',
		// A held Shift+P switches once; its repeats go on to the sky, as any other key.
		matches: (event) =>
			event.code === 'KeyP' &&
			event.shiftKey &&
			!event.repeat &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey
	}
];

/** The page's command for a key, or null for one it leaves to the sky. */
export function pageCommand(event: KeyboardEvent, apple: boolean): PageCommand | null {
	return PAGE_KEYS.find((key) => key.matches(event, apple))?.command ?? null;
}
