// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AboutDialog from './AboutDialog.svelte';
import { SHORTCUTS } from '$lib/shortcuts';

// jsdom has no modal dialogs: model showModal() and close() by the open attribute.
beforeAll(() => {
	const proto = HTMLDialogElement.prototype;
	Object.defineProperty(proto, 'open', {
		configurable: true,
		get(this: HTMLDialogElement) {
			return this.hasAttribute('open');
		}
	});
	proto.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	proto.close = function (this: HTMLDialogElement) {
		if (!this.hasAttribute('open')) return;
		this.removeAttribute('open');
		this.dispatchEvent(new Event('close'));
	};
});

function setup(apple = true) {
	const target = document.createElement('div');
	document.body.append(target);
	const props = $state({ open: false, apple });
	const component = mount(AboutDialog, { target, props });
	const dialog = target.querySelector('dialog')!;
	const cleanup = () => {
		unmount(component);
		target.remove();
	};
	return { target, props, dialog, cleanup };
}

function click(element: Element) {
	element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

describe('AboutDialog', () => {
	let cleanup: (() => void) | null = null;
	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it('opens and closes with its open prop and is named by its title', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		expect(ctx.dialog.open).toBe(false);

		ctx.props.open = true;
		flushSync();
		expect(ctx.dialog.open).toBe(true);
		const titleId = ctx.dialog.getAttribute('aria-labelledby')!;
		expect(ctx.dialog.querySelector(`[id="${titleId}"]`)?.textContent).toBe('About');

		ctx.props.open = false;
		flushSync();
		expect(ctx.dialog.open).toBe(false);
	});

	it('clears open when it closes itself, as on Escape', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		ctx.props.open = true;
		flushSync();

		ctx.dialog.close();
		flushSync();
		expect(ctx.props.open).toBe(false);
	});

	it('closes from × and from the backdrop, not from a click inside', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		ctx.props.open = true;
		flushSync();

		click(ctx.dialog.querySelector('p')!);
		expect(ctx.props.open).toBe(true);

		// A press inside that is released on the backdrop (a text selection) keeps it open.
		ctx.dialog
			.querySelector('p')!
			.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		ctx.dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(ctx.props.open).toBe(true);

		click(ctx.dialog);
		expect(ctx.props.open).toBe(false);

		ctx.props.open = true;
		flushSync();
		click(ctx.dialog.querySelector('button[aria-label="Close"]')!);
		expect(ctx.props.open).toBe(false);
	});

	it('lists every shortcut with Apple keycaps and spoken names', () => {
		const ctx = setup(true);
		cleanup = ctx.cleanup;
		const rows = Array.from(ctx.dialog.querySelectorAll('.shortcut'));
		expect(rows.map((row) => row.querySelector('dt')?.textContent)).toEqual(
			SHORTCUTS.map((shortcut) => shortcut.action)
		);

		const save = rows.find((row) => row.querySelector('dt')?.textContent === 'Save PNG')!;
		expect(Array.from(save.querySelectorAll('kbd'), (kbd) => kbd.textContent)).toEqual(['⌘', 'S']);
		expect(save.querySelector('.sr-only')?.textContent).toBe('Command S');
	});

	it('prints Ctrl and Shift elsewhere', () => {
		const ctx = setup(false);
		cleanup = ctx.cleanup;
		const rows = Array.from(ctx.dialog.querySelectorAll('.shortcut'));
		const keycaps = (action: string) =>
			Array.from(
				rows
					.find((row) => row.querySelector('dt')?.textContent === action)!
					.querySelectorAll('kbd'),
				(kbd) => kbd.textContent
			);
		expect(keycaps('Save PNG')).toEqual(['Ctrl', 'S']);
		expect(keycaps('Switch projection')).toEqual(['Shift', 'P']);
	});
});
