// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { chartsOf } from '$lib/document/blocks';
import { DocumentStore } from '$lib/document/document.svelte';
import { pageSize } from '$lib/document/geometry';
import type { ChartSnapshot, DocPage } from '$lib/document/types';
import { ToastStore } from '$lib/ui/toast.svelte';
import { editorLayout } from './editor/screen-geometry';
import PageEditor from './PageEditor.svelte';

// No backend here: every preview is one made-up URL.
vi.mock('$lib/document/render', () => ({
	chartPreviewUrl: () => Promise.resolve('blob:preview')
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
		{ id: 'p1', orientation: 'portrait', blocks: [] },
		{
			id: 'p2',
			orientation: 'portrait',
			blocks: [
				{ kind: 'chart', id: 'a', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } },
				{
					kind: 'chart',
					id: 'b',
					chart: chart('pinhole'),
					frame: { x: 12, y: 120, w: 80, h: 50 }
				}
			]
		},
		{ id: 'p3', orientation: 'landscape', blocks: [] }
	];
}

function setup(pageId: string | null = 'p2', apple = true) {
	const store = new DocumentStore(null);
	store.pages = documentPages();
	const onclose = vi.fn();
	// The page's toast: what `notify` shows, ⌘Z takes back.
	const toast = new ToastStore();
	const notify = vi.fn((message: string, undo?: () => void) => {
		toast.show(message, undo);
	});
	const undo = () => toast.undo();
	const target = document.createElement('div');
	document.body.append(target);
	const props = $state({ store, pageId, onclose, notify, undo, apple });
	// The parent clears pageId when the editor closes itself.
	onclose.mockImplementation(() => (props.pageId = null));
	const component = mount(PageEditor, { target, props });
	flushSync();
	const dialog = target.querySelector('dialog')!;
	const cleanup = () => {
		unmount(component);
		target.remove();
	};
	return { store, props, onclose, notify, toast, dialog, target, cleanup };
}

function liveRegion(dialog: HTMLDialogElement) {
	return dialog.querySelector('[aria-live="polite"]')!;
}

/** Let `tick().then(…)` inside the editor run. */
async function settle() {
	await tick();
	await tick();
	flushSync();
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
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['b']);
		expect(ctx.notify).toHaveBeenCalledWith('Chart removed', expect.any(Function));
		await tick();
		await tick();
		expect(document.activeElement?.getAttribute('aria-label')).toBe(
			'Chart 1 of 1, pinhole, 80 by 50 mm'
		);

		const undo = ctx.notify.mock.calls[0][1] as () => void;
		undo();
		flushSync();
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['a', 'b']);
	});

	it('removes on Backspace too, and ⌘Z puts the chart back through the toast', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const [, second] = charts(ctx.dialog);
		key(second, 'Backspace');
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['a']);
		expect(ctx.toast.current?.message).toBe('Chart removed');
		key(currentPaper(ctx.dialog), 'z', { metaKey: true, code: 'KeyZ' });
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['a', 'b']);
		// The toast goes with it, and a second ⌘Z has nothing left to take back.
		expect(ctx.toast.current).toBeNull();
		await settle();
		expect(document.activeElement?.getAttribute('aria-label')).toBe(
			'Chart 2 of 2, pinhole, 80 by 50 mm'
		);
		expect(liveRegion(ctx.dialog).textContent).toBe('Chart restored');
	});

	it('takes ⌘Z by the key, so Ctrl+Z works on a Russian layout', () => {
		const ctx = setup('p2', false);
		cleanup = ctx.cleanup;
		key(charts(ctx.dialog)[0], 'Delete');
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['b']);
		// ⌘ is not the modifier here.
		key(currentPaper(ctx.dialog), 'я', { metaKey: true, code: 'KeyZ' });
		expect(chartsOf(ctx.store.page('p2')!)).toHaveLength(1);
		key(currentPaper(ctx.dialog), 'я', { ctrlKey: true, code: 'KeyZ' });
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['a', 'b']);
	});

	it('runs any Undo the toast offers on ⌘Z, also one from the panel', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const pageUndo = vi.fn();
		ctx.toast.show('Page 4 deleted', pageUndo);
		key(currentPaper(ctx.dialog), 'z', { metaKey: true, code: 'KeyZ' });
		expect(pageUndo).toHaveBeenCalledOnce();
		expect(ctx.toast.current).toBeNull();
	});

	it("brings a chart back with the toast's Undo button: its page shown, the chart focused", async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		key(charts(ctx.dialog)[0], 'Delete');
		await settle();
		// Elsewhere meanwhile: the Undo shows page 2 again.
		key(ctx.dialog.querySelector('button[aria-label="Close"]')!, 'ArrowRight');
		expect(ctx.store.selectedPageId).toBe('p3');
		expect(ctx.toast.undo()).toBe(true);
		flushSync();
		expect(ctx.store.selectedPageId).toBe('p2');
		await settle();
		expect(document.activeElement?.getAttribute('aria-label')).toBe(
			'Chart 1 of 2, stereographic, 90 by 90 mm'
		);
		expect(liveRegion(ctx.dialog).textContent).toBe('Chart restored');
		// Spent: ⌘Z neither moves nor announces anything.
		key(charts(ctx.dialog)[1], 'z', { metaKey: true, code: 'KeyZ' });
		expect(chartsOf(ctx.store.page('p2')!)).toHaveLength(2);
	});

	it('steps the focused chart through the sizes with + and −', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const [first] = charts(ctx.dialog);
		first.focus();
		key(first, '+', { code: 'Equal', shiftKey: true });
		expect(chartsOf(ctx.store.page('p2')!)[0].frame).toEqual({ x: 12, y: 12, w: 122, h: 122 });
		await settle();
		expect(liveRegion(ctx.dialog).textContent).toBe('122 by 122 mm');
		key(charts(ctx.dialog)[0], '-', { code: 'Minus' });
		key(charts(ctx.dialog)[0], '-', { code: 'Minus' });
		expect(chartsOf(ctx.store.page('p2')!)[0].frame).toEqual({ x: 12, y: 12, w: 87, h: 87 });
	});

	it('moves the focused chart to the next page with Page Down, and back with Page Up', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const [, second] = charts(ctx.dialog);
		second.focus();
		key(second, 'PageDown');
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['a']);
		expect(chartsOf(ctx.store.page('p3')!).map((it) => it.id)).toEqual(['b']);
		// Clear of nothing on the empty landscape page: at its top-left, its size kept.
		expect(chartsOf(ctx.store.page('p3')!)[0].frame).toEqual({ x: 12, y: 12, w: 80, h: 50 });
		expect(ctx.store.selectedPageId).toBe('p3');
		await settle();
		expect(liveRegion(ctx.dialog).textContent).toBe('Chart moved to page 3');
		expect(document.activeElement?.getAttribute('aria-label')).toBe(
			'Chart 1 of 1, pinhole, 80 by 50 mm'
		);

		key(document.activeElement!, 'PageUp');
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['a', 'b']);
		expect(ctx.store.selectedPageId).toBe('p2');
		// Placed clear of the disc on page 2.
		const [disc, moved] = chartsOf(ctx.store.page('p2')!).map((it) => it.frame);
		expect(moved.x >= disc.x + disc.w + 6 || moved.y >= disc.y + disc.h + 6).toBe(true);
	});

	it("offers the same through a selected chart's toolbar", async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const item = ctx.dialog.querySelector('.slot[data-role="current"] [data-item-id="a"]')!;
		const tool = (name: string) =>
			Array.from(item.querySelectorAll<HTMLButtonElement>('.tools button')).find(
				(el) => el.getAttribute('aria-label') === name
			);
		expect(tool('Move chart 1 to page 1')).toBeDefined();
		expect(tool('Move chart 1 to page 3')).toBeDefined();

		click(tool('Make chart 1 larger')!);
		expect(chartsOf(ctx.store.page('p2')!)[0].frame.w).toBe(122);
		click(tool('Make chart 1 smaller')!);
		expect(chartsOf(ctx.store.page('p2')!)[0].frame.w).toBe(90);

		click(tool('Move chart 1 to page 1')!);
		expect(chartsOf(ctx.store.page('p1')!).map((it) => it.id)).toEqual(['a']);
		expect(ctx.store.selectedPageId).toBe('p1');
		await settle();
		// The first page has nothing before it.
		const moved = ctx.dialog.querySelector('.slot[data-role="current"] [data-item-id="a"]')!;
		const names = Array.from(moved.querySelectorAll('.tools button'), (el) =>
			el.getAttribute('aria-label')
		);
		expect(names).toEqual([
			'Make chart 1 smaller',
			'Make chart 1 larger',
			'Move chart 1 to page 2'
		]);
	});

	it("ignores a tap's click on the ⊖ it revealed: a pointer click counts where it was pressed", () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const item = ctx.dialog.querySelector('.slot[data-role="current"] [data-item-id="a"]')!;
		const chartEl = item.querySelector('[role="button"]')!;
		const remove = item.querySelector<HTMLButtonElement>('button.remove')!;
		// The press selects the chart; the click the tap ends in lands on the ⊖ now there.
		chartEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		remove.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		flushSync();
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['a', 'b']);

		// Pressed on the ⊖ itself, it removes.
		remove.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		remove.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		flushSync();
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.id)).toEqual(['b']);
	});

	it('nudges the focused chart 1 mm with an arrow and 10 mm with Shift', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const update = vi.spyOn(ctx.store, 'setFrame');
		const [, second] = charts(ctx.dialog);

		key(second, 'ArrowRight');
		expect(update).toHaveBeenLastCalledWith('p2', 'b', { x: 13, y: 120, w: 80, h: 50 });
		// Moved by hand: Add to PDF leaves this page's charts where they are from now on.
		expect(ctx.store.page('p2')!.manual).toBe(true);

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
			'Page 3, A4 landscape, no charts'
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

		click(strip.querySelector('button[aria-label="Go to page 1, no charts"]')!);
		expect(ctx.store.selectedPageId).toBe('p1');
		expect(current()).toBe('Go to page 1, no charts');

		click(strip.querySelector('button[aria-label="Add page"]')!);
		expect(ctx.store.pageCount).toBe(4);
		expect(ctx.store.selectedPageId).toBe(ctx.store.pages[3].id);
		expect(current()).toBe('Go to page 4, no charts');
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
		const before = chartsOf(ctx.store.page('p2')!).map((it) => ({ ...it.frame }));
		click(group.querySelector('[role="radio"][aria-label="Landscape"]')!);
		// With the measure for its text, should a template have laid the page out.
		expect(orientation).toHaveBeenCalledWith('p2', 'landscape', expect.any(Function));
		expect(ctx.store.page('p2')!.orientation).toBe('landscape');
		expect(group.querySelector('[aria-checked="true"]')?.getAttribute('aria-label')).toBe(
			'Landscape'
		);
		// Its charts are laid out again on the turned page; turning back puts them where they were.
		const turned = chartsOf(ctx.store.page('p2')!).map((it) => it.frame);
		turned.forEach((frame) => expect(frame.x + frame.w).toBeLessThanOrEqual(285 + 1e-9));
		expect(turned).not.toEqual(before);
		click(group.querySelector('[role="radio"][aria-label="Portrait"]')!);
		expect(chartsOf(ctx.store.page('p2')!).map((it) => it.frame)).toEqual(before);
	});

	it('offers to delete a page only while it is empty, and Undo brings it back', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const remove = (number: number) =>
			ctx.dialog.querySelector<HTMLElement>(`button[aria-label="Delete page ${number}"]`);
		// Pages 1 and 3 are empty, page 2 has charts on it.
		expect(remove(1)).not.toBeNull();
		expect(remove(2)).toBeNull();
		expect(remove(3)).not.toBeNull();

		// A neighbour deleted: the current page stays the current one, now page 1.
		click(remove(1)!);
		await settle();
		expect(ctx.store.pages.map((page) => page.id)).toEqual(['p2', 'p3']);
		expect(ctx.store.selectedPageId).toBe('p2');
		expect(ctx.notify).toHaveBeenLastCalledWith('Page 1 deleted', expect.any(Function));
		expect(document.activeElement).toBe(currentPaper(ctx.dialog));

		ctx.toast.undo();
		await settle();
		expect(ctx.store.pages.map((page) => page.id)).toEqual(['p1', 'p2', 'p3']);
		expect(ctx.store.selectedPageId).toBe('p1');
		expect(liveRegion(ctx.dialog).textContent).toBe('Page 1 restored');
	});

	it('deletes the empty current page on Delete, and shows the page that took its place', async () => {
		const ctx = setup('p3');
		cleanup = ctx.cleanup;
		// Not with a chart on the page: Delete on the paper of page 2 does nothing.
		const full = setup('p2');
		key(currentPaper(full.dialog), 'Delete');
		expect(full.store.pageCount).toBe(3);
		full.cleanup();

		const event = key(currentPaper(ctx.dialog), 'Delete');
		await settle();
		expect(event.defaultPrevented).toBe(true);
		expect(ctx.store.pages.map((page) => page.id)).toEqual(['p1', 'p2']);
		// The last page went: the one before it is shown.
		expect(ctx.store.selectedPageId).toBe('p2');
		expect(ctx.dialog.open).toBe(true);
	});

	it('closes when its only page is deleted', async () => {
		const ctx = setup('p1');
		cleanup = ctx.cleanup;
		ctx.store.pages = [{ id: 'p1', orientation: 'portrait', blocks: [] }];
		flushSync();
		click(ctx.dialog.querySelector('button[aria-label="Delete page 1"]')!);
		await settle();
		expect(ctx.store.pageCount).toBe(0);
		expect(ctx.onclose).toHaveBeenCalled();
		expect(ctx.dialog.open).toBe(false);
	});

	it('closes itself when the document has no page left to show', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		ctx.store.pages = [];
		flushSync();
		expect(ctx.onclose).toHaveBeenCalled();
		expect(ctx.dialog.open).toBe(false);
	});

	describe('a pointer drag', () => {
		/** The stage has no layout here: it is the fallback's size, at the window's corner. */
		const { scale, slots } = editorLayout(
			{ w: 1200, h: 640 },
			{ prev: pageSize('portrait'), current: pageSize('portrait'), next: pageSize('landscape') }
		);

		/** Where a point of the current page, mm, is on screen. */
		function onPage(x: number, y: number) {
			const paper = slots.current!;
			return { clientX: paper.left + x * scale, clientY: paper.top + y * scale };
		}

		function pointer(element: Element, type: string, at: { clientX: number; clientY: number }) {
			const event = new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				...at
			});
			element.dispatchEvent(event);
			flushSync();
			return event;
		}

		/** Let the move the pointer made be applied: once a frame. */
		async function frame() {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			flushSync();
		}

		function itemOf(dialog: HTMLDialogElement, id: string) {
			return dialog.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
		}

		it('carries a chart with the pointer and writes the document once, on the release', async () => {
			const ctx = setup();
			cleanup = ctx.cleanup;
			const update = vi.spyOn(ctx.store, 'setFrame');
			const [, second] = charts(ctx.dialog);
			pointer(second, 'pointerdown', onPage(40, 140));
			expect(document.activeElement).toBe(second);
			pointer(second, 'pointermove', onPage(70, 150));
			await frame();
			expect(itemOf(ctx.dialog, 'b').dataset.state).toBe('moving');
			expect(ctx.dialog.querySelector('.stage')!.classList.contains('is-carrying')).toBe(true);
			expect(update).not.toHaveBeenCalled();

			pointer(second, 'pointerup', onPage(70, 150));
			expect(update).toHaveBeenCalledTimes(1);
			const [pageId, blockId, landed] = update.mock.calls[0];
			expect([pageId, blockId]).toEqual(['p2', 'b']);
			// Thirty millimetres right and ten down, give or take the snap.
			expect(Math.abs(landed.x - 42)).toBeLessThanOrEqual(8 / scale);
			expect(Math.abs(landed.y - 130)).toBeLessThanOrEqual(8 / scale);
			expect(landed.w).toBe(80);
			expect(itemOf(ctx.dialog, 'b').dataset.state).not.toBe('moving');
		});

		it('takes a press that does not travel for a click: nothing is moved', () => {
			const ctx = setup();
			cleanup = ctx.cleanup;
			const update = vi.spyOn(ctx.store, 'setFrame');
			const [first] = charts(ctx.dialog);
			pointer(first, 'pointerdown', onPage(50, 50));
			pointer(first, 'pointerup', {
				clientX: onPage(50, 50).clientX + 2,
				clientY: onPage(50, 50).clientY
			});
			expect(update).not.toHaveBeenCalled();
			expect(itemOf(ctx.dialog, 'a').dataset.state).toBe('idle');
			// And the keys are the chart's again: no drag is left going.
			key(first, 'ArrowRight');
			expect(update).toHaveBeenCalledTimes(1);
		});

		it('drops the drag on Escape, not the editor: the chart goes back', async () => {
			const ctx = setup();
			cleanup = ctx.cleanup;
			const update = vi.spyOn(ctx.store, 'setFrame');
			const [first] = charts(ctx.dialog);
			pointer(first, 'pointerdown', onPage(50, 50));
			pointer(first, 'pointermove', onPage(90, 90));
			await frame();
			expect(itemOf(ctx.dialog, 'a').dataset.state).toBe('moving');

			const event = key(first, 'Escape');
			expect(event.defaultPrevented).toBe(true);
			expect(ctx.dialog.open).toBe(true);
			expect(itemOf(ctx.dialog, 'a').dataset.state).toBe('returning');
			// The pointer let go afterwards ends nothing.
			pointer(first, 'pointerup', onPage(90, 90));
			expect(update).not.toHaveBeenCalled();
			expect(chartsOf(ctx.store.page('p2')!)[0].frame).toEqual({ x: 12, y: 12, w: 90, h: 90 });
		});

		it('resizes a chart by a corner, its aspect kept, and leaves the keys alone meanwhile', async () => {
			const ctx = setup();
			cleanup = ctx.cleanup;
			const handle = itemOf(ctx.dialog, 'a').querySelector('[data-handle="se"]')!;
			pointer(handle, 'pointerdown', onPage(102, 102));
			pointer(handle, 'pointermove', onPage(122, 122));
			await frame();
			expect(itemOf(ctx.dialog, 'a').dataset.state).toBe('resizing');
			// A drag is going on: a key on the chart moves nothing.
			const update = vi.spyOn(ctx.store, 'setFrame');
			key(charts(ctx.dialog)[0], 'ArrowRight');
			expect(update).not.toHaveBeenCalled();

			pointer(handle, 'pointerup', onPage(122, 122));
			const frameNow = chartsOf(ctx.store.page('p2')!)[0].frame;
			expect(frameNow.x).toBe(12);
			expect(frameNow.y).toBe(12);
			expect(frameNow.w).toBeCloseTo(frameNow.h);
			expect(Math.abs(frameNow.w - 110)).toBeLessThanOrEqual(8 / scale);
		});
	});
});
