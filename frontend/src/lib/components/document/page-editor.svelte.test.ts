// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { DocumentStore } from '$lib/document/document.svelte';
import type { ChartSnapshot, DocPage } from '$lib/document/types';
import PageEditor from './PageEditor.svelte';

// No backend here: every preview is one made-up URL.
vi.mock('$lib/document/render', () => ({
	itemPreviewUrl: () => Promise.resolve('blob:preview')
}));

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

function chart(projection: 'stereographic' | 'pinhole' = 'stereographic'): ChartSnapshot {
	const aspect = projection === 'stereographic' ? 1 : 1.6;
	return {
		view: {
			projection,
			orientation: { x: 0, y: 0, z: 0, w: 1 },
			stereoFovDeg: 180,
			pinholeFovDeg: 70,
			pinholeAspectRatio: 1.6,
			pinholeHeightFrac: 1.18
		},
		layers: {
			constellations: true,
			constellationBoundaries: false,
			equator: false,
			ecliptic: true,
			galacticEquator: false,
			planets: false
		},
		aspect,
		createdAt: '2026-10-27T12:00:00.000Z'
	};
}

function documentPages(): DocPage[] {
	return [
		{ id: 'p1', orientation: 'portrait', items: [] },
		{
			id: 'p2',
			orientation: 'portrait',
			items: [
				{ id: 'a', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } },
				{ id: 'b', chart: chart('pinhole'), frame: { x: 12, y: 120, w: 80, h: 50 } }
			]
		},
		{ id: 'p3', orientation: 'landscape', items: [] }
	];
}

function setup(pageId: string | null = 'p2') {
	const store = new DocumentStore(null);
	store.pages = documentPages();
	const onclose = vi.fn();
	const notify = vi.fn();
	const target = document.createElement('div');
	document.body.append(target);
	const props = $state({ store, pageId, onclose, notify });
	// The parent clears pageId when the editor closes itself.
	onclose.mockImplementation(() => (props.pageId = null));
	const component = mount(PageEditor, { target, props });
	flushSync();
	const dialog = target.querySelector('dialog')!;
	const cleanup = () => {
		unmount(component);
		target.remove();
	};
	return { store, props, onclose, notify, dialog, target, cleanup };
}

function key(element: Element, keyName: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent('keydown', {
		key: keyName,
		bubbles: true,
		cancelable: true,
		...init
	});
	element.dispatchEvent(event);
	flushSync();
	return event;
}

function click(element: Element) {
	element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

function charts(dialog: HTMLDialogElement): HTMLElement[] {
	return Array.from(
		dialog.querySelectorAll<HTMLElement>(
			'.slot[data-role="current"] [aria-roledescription="chart"]'
		)
	);
}

function currentPaper(dialog: HTMLDialogElement) {
	return dialog.querySelector('.slot[data-role="current"] [data-paper]')!;
}

describe('PageEditor', () => {
	let cleanup: (() => void) | null = null;
	afterEach(() => {
		cleanup?.();
		cleanup = null;
		vi.restoreAllMocks();
	});

	it('stays closed without a page and opens on the page it is given', () => {
		const ctx = setup(null);
		cleanup = ctx.cleanup;
		expect(ctx.dialog.open).toBe(false);
		expect(ctx.dialog.querySelector('.stage')).toBeNull();

		ctx.props.pageId = 'p2';
		flushSync();
		expect(ctx.dialog.open).toBe(true);
		expect(currentPaper(ctx.dialog).getAttribute('aria-label')).toBe(
			'Page 2, A4 portrait, 2 charts'
		);
		expect(ctx.store.selectedPageId).toBe('p2');
		// Previous, current and next side by side.
		const roles = Array.from(ctx.dialog.querySelectorAll('.slot'), (slot) =>
			slot.getAttribute('data-role')
		);
		expect(roles).toEqual(['prev', 'current', 'next']);
		const titleId = ctx.dialog.getAttribute('aria-labelledby')!;
		expect(ctx.dialog.querySelector(`[id="${titleId}"]`)?.textContent).toBe('PDF document');
	});

	it('names each chart by its place, projection and size', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		expect(charts(ctx.dialog).map((el) => el.getAttribute('aria-label'))).toEqual([
			'Chart 1 of 2, stereographic, 90 by 90 mm',
			'Chart 2 of 2, pinhole, 80 by 50 mm'
		]);
	});

	it('closes on Escape and calls onclose once', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const event = key(ctx.dialog.querySelector('button[aria-label="Close"]')!, 'Escape');
		expect(event.defaultPrevented).toBe(true);
		expect(ctx.onclose).toHaveBeenCalledTimes(1);
		expect(ctx.dialog.open).toBe(false);
	});

	it('closes from ⊗ and from the backdrop, not from a click inside', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		click(currentPaper(ctx.dialog));
		expect(ctx.onclose).not.toHaveBeenCalled();

		click(ctx.dialog);
		expect(ctx.onclose).toHaveBeenCalledTimes(1);

		ctx.props.pageId = 'p2';
		flushSync();
		click(ctx.dialog.querySelector('button[aria-label="Close"]')!);
		expect(ctx.onclose).toHaveBeenCalledTimes(2);
	});

	it('removes the focused chart on Delete, with an undo, and focuses the next one', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const [first] = charts(ctx.dialog);
		first.focus();
		key(first, 'Delete');
		expect(ctx.store.page('p2')!.items.map((it) => it.id)).toEqual(['b']);
		expect(ctx.notify).toHaveBeenCalledWith('Chart removed', expect.any(Function));
		await tick();
		await tick();
		expect(document.activeElement?.getAttribute('aria-label')).toBe(
			'Chart 1 of 1, pinhole, 80 by 50 mm'
		);

		const undo = ctx.notify.mock.calls[0][1] as () => void;
		undo();
		flushSync();
		expect(ctx.store.page('p2')!.items.map((it) => it.id)).toEqual(['a', 'b']);
	});

	it('removes on Backspace too, and ⌘Z puts the chart back', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const [, second] = charts(ctx.dialog);
		key(second, 'Backspace');
		expect(ctx.store.page('p2')!.items.map((it) => it.id)).toEqual(['a']);
		key(currentPaper(ctx.dialog), 'z', { metaKey: true });
		expect(ctx.store.page('p2')!.items.map((it) => it.id)).toEqual(['a', 'b']);
	});

	it('nudges the focused chart 1 mm with an arrow and 10 mm with Shift', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const update = vi.spyOn(ctx.store, 'updateItem');
		const [, second] = charts(ctx.dialog);

		key(second, 'ArrowRight');
		expect(update).toHaveBeenLastCalledWith('p2', 'b', { x: 13, y: 120, w: 80, h: 50 });

		key(second, 'ArrowDown', { shiftKey: true });
		expect(update).toHaveBeenLastCalledWith('p2', 'b', { x: 13, y: 130, w: 80, h: 50 });

		// The content box stops it: at the margin a nudge left only clamps.
		const [first] = charts(ctx.dialog);
		key(first, 'ArrowLeft');
		expect(update).toHaveBeenLastCalledWith('p2', 'a', { x: 12, y: 12, w: 90, h: 90 });
		// A nudge is the chart's: the page stays.
		expect(ctx.store.selectedPageId).toBe('p2');
	});

	it('switches pages with ←/→ when no chart has the focus', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const close = ctx.dialog.querySelector('button[aria-label="Close"]')!;
		key(close, 'ArrowRight');
		expect(ctx.store.selectedPageId).toBe('p3');
		expect(currentPaper(ctx.dialog).getAttribute('aria-label')).toBe(
			'Page 3, A4 landscape, 0 charts'
		);
		// The last page has no next one.
		key(close, 'ArrowRight');
		expect(ctx.store.selectedPageId).toBe('p3');

		key(close, 'ArrowLeft');
		key(close, 'ArrowLeft');
		expect(ctx.store.selectedPageId).toBe('p1');
		expect(ctx.dialog.querySelectorAll('.slot')).toHaveLength(2);
	});

	it('keeps its keys from the window, where the generator has its shortcuts', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const onWindowKey = vi.fn();
		window.addEventListener('keydown', onWindowKey);
		try {
			key(currentPaper(ctx.dialog), 'P', { shiftKey: true });
			key(charts(ctx.dialog)[0], 'ArrowUp');
			expect(onWindowKey).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener('keydown', onWindowKey);
		}
	});

	it('jumps to a page from the strip and adds one with ⊕', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const strip = ctx.dialog.querySelector('[data-strip]')!;
		const current = () => strip.querySelector('[aria-current="page"]')?.getAttribute('aria-label');
		expect(current()).toBe('Go to page 2, 2 charts');

		click(strip.querySelector('button[aria-label="Go to page 1, 0 charts"]')!);
		expect(ctx.store.selectedPageId).toBe('p1');
		expect(current()).toBe('Go to page 1, 0 charts');

		click(strip.querySelector('button[aria-label="Add page"]')!);
		expect(ctx.store.pageCount).toBe(4);
		expect(ctx.store.selectedPageId).toBe(ctx.store.pages[3].id);
		expect(current()).toBe('Go to page 4, 0 charts');
	});

	it('makes a neighbouring page current on a click', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		click(ctx.dialog.querySelector('.slot[data-role="prev"] [data-paper]')!);
		expect(ctx.store.selectedPageId).toBe('p1');
	});

	it('turns a page with its orientation toggle', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const orientation = vi.spyOn(ctx.store, 'setOrientation');
		const group = ctx.dialog.querySelector('[role="radiogroup"][aria-label="Page 2 orientation"]')!;
		click(group.querySelector('[role="radio"][aria-label="Landscape"]')!);
		expect(orientation).toHaveBeenCalledWith('p2', 'landscape');
		expect(ctx.store.page('p2')!.orientation).toBe('landscape');
		expect(group.querySelector('[aria-checked="true"]')?.getAttribute('aria-label')).toBe(
			'Landscape'
		);
	});

	it('closes itself when the document has no page left to show', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		ctx.store.pages = [];
		flushSync();
		expect(ctx.onclose).toHaveBeenCalled();
		expect(ctx.dialog.open).toBe(false);
	});
});
