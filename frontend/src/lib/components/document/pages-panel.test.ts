// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { DocumentStore, MAX_PAGES } from '$lib/document/document.svelte';
import type { ChartSnapshot, DocItem } from '$lib/document/types';
import PagesPanel from './PagesPanel.svelte';

const preview = vi.hoisted(() => ({
	url: vi.fn<(item: DocItem) => Promise<string>>(() => Promise.resolve('blob:preview'))
}));

vi.mock('$lib/document/render', () => ({ itemPreviewUrl: preview.url }));

// jsdom has no ResizeObserver, which `bind:offsetWidth` (the panel's footprint) uses.
beforeAll(() => {
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

function chart(aspect = 1): ChartSnapshot {
	return {
		view: {
			projection: aspect === 1 ? 'stereographic' : 'pinhole',
			orientation: { x: 0, y: 0, z: 0, w: 1 },
			stereoFovDeg: 180,
			pinholeFovDeg: 100,
			pinholeAspectRatio: aspect === 1 ? 1.61 : aspect,
			pinholeHeightFrac: 1.18
		},
		layers: {
			constellations: true,
			constellationBoundaries: false,
			equator: false,
			ecliptic: false,
			galacticEquator: false,
			planets: false
		},
		aspect,
		createdAt: '2026-10-27T12:00:00.000Z'
	};
}

function setup(store = new DocumentStore(null)) {
	const target = document.createElement('div');
	document.body.append(target);
	const onopen = vi.fn();
	const notify = vi.fn();
	const onemptied = vi.fn();
	const component = mount(PagesPanel, { target, props: { store, onopen, notify, onemptied } });
	flushSync();
	const cleanup = () => {
		unmount(component);
		target.remove();
	};
	return { target, store, component, onopen, notify, onemptied, cleanup };
}

function thumbs(root: ParentNode): HTMLButtonElement[] {
	return Array.from(root.querySelectorAll<HTMLButtonElement>('button.thumb'));
}

function button(root: ParentNode, name: string): HTMLButtonElement {
	const match = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
		(el) => el.getAttribute('aria-label') === name
	);
	if (!match) throw new Error(`no button named ${name}`);
	return match;
}

function keydown(element: Element, key: string) {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	element.dispatchEvent(event);
	flushSync();
	return event;
}

/** Let `await tick()` inside the panel's handlers run. */
async function settle() {
	await tick();
	await tick();
	flushSync();
}

describe('PagesPanel', () => {
	let cleanup: (() => void) | null = null;
	beforeEach(() => {
		preview.url.mockClear();
	});
	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it('is not there while the document is empty', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		expect(ctx.target.querySelector('aside')).toBeNull();

		ctx.store.addChart(chart());
		flushSync();
		expect(ctx.target.querySelector('aside')?.getAttribute('aria-label')).toBe('PDF pages');
	});

	it('names each thumbnail by its page and charts, and marks the selected page', () => {
		const store = new DocumentStore(null);
		store.addChart(chart());
		store.addChart(chart());
		const second = store.addPage();
		store.selectedPageId = second;
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		const names = thumbs(ctx.target).map((el) => el.getAttribute('aria-label'));
		expect(names).toEqual(['Page 1, 2 charts', 'Page 2, no charts']);
		expect(thumbs(ctx.target).map((el) => el.getAttribute('aria-current'))).toEqual([null, 'true']);
		const numbers = Array.from(ctx.target.querySelectorAll('.number')).map((el) => el.textContent);
		expect(numbers).toEqual(['1', '2']);
	});

	it('draws a page as a sheet in mm × scale with its charts placed on it', () => {
		const store = new DocumentStore(null);
		store.addChart(chart(), 'data:image/png;base64,AAAA');
		store.addPage('landscape');
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		const sheets = ctx.target.querySelectorAll<HTMLElement>('.sheet');
		expect(sheets[0].style.width).toBe('88px');
		expect(parseFloat(sheets[0].style.height)).toBeCloseTo((297 * 88) / 210, 3);
		expect(parseFloat(sheets[1].style.width)).toBeCloseTo((297 * 88) / 210, 3);
		expect(sheets[1].style.height).toBe('88px');

		const item = store.pages[0].items[0];
		const chartEl = sheets[0].querySelector<HTMLElement>('.chart')!;
		const scale = 88 / 210;
		expect(parseFloat(chartEl.style.left)).toBeCloseTo(item.frame.x * scale, 6);
		expect(parseFloat(chartEl.style.width)).toBeCloseTo(item.frame.w * scale, 6);
	});

	it('shows the thumb until the vector preview loads, then the preview', async () => {
		const store = new DocumentStore(null);
		store.addChart(chart(), 'data:image/png;base64,AAAA');
		const ctx = setup(store);
		cleanup = ctx.cleanup;
		const img = () => ctx.target.querySelector<HTMLImageElement>('.chart img');

		expect(img()?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
		await vi.waitFor(() => expect(img()?.getAttribute('src')).toBe('blob:preview'));
		expect(preview.url).toHaveBeenCalledWith(store.pages[0].items[0]);
	});

	it('fetches a new preview once a resize has settled, not on every move', async () => {
		vi.useFakeTimers();
		try {
			const store = new DocumentStore(null);
			store.addChart(chart());
			const ctx = setup(store);
			cleanup = ctx.cleanup;
			await vi.advanceTimersByTimeAsync(0);
			expect(preview.url).toHaveBeenCalledTimes(1);

			const page = store.pages[0];
			const item = page.items[0];
			for (const w of [120, 110, 100, 90]) {
				store.updateItem(page.id, item.id, { ...item.frame, w, h: w });
				flushSync();
				await vi.advanceTimersByTimeAsync(50);
			}
			expect(preview.url).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(400);
			expect(preview.url).toHaveBeenCalledTimes(2);
			expect(preview.url.mock.lastCall?.[0]).toMatchObject({ frame: { w: 90, h: 90 } });
		} finally {
			vi.useRealTimers();
		}
	});

	it('opens the editor on a click on a thumbnail', () => {
		const store = new DocumentStore(null);
		store.addChart(chart());
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		thumbs(ctx.target)[0].click();
		expect(ctx.onopen).toHaveBeenCalledWith(store.pages[0].id);
	});

	it('deletes a page from its ⊖ and offers an Undo that puts it back', () => {
		const store = new DocumentStore(null);
		store.addChart(chart());
		const second = store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		button(ctx.target, 'Delete page 2').click();
		flushSync();
		expect(store.pages.map((p) => p.id)).not.toContain(second);
		expect(thumbs(ctx.target)).toHaveLength(1);
		expect(ctx.notify).toHaveBeenCalledWith('Page 2 deleted', expect.any(Function));
		expect(ctx.onopen).not.toHaveBeenCalled();

		const undo = ctx.notify.mock.lastCall![1] as () => void;
		undo();
		flushSync();
		expect(store.pages.map((p) => p.id)).toEqual([store.pages[0].id, second]);
		expect(thumbs(ctx.target)).toHaveLength(2);
	});

	it("gives the focus to the restored page when the toast's Undo took it along", async () => {
		const store = new DocumentStore(null);
		store.addPage();
		const second = store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		thumbs(ctx.target)[1].focus();
		keydown(thumbs(ctx.target)[1], 'Delete');
		await settle();
		// The Undo button the toast drops as it closes: the focus falls to the body.
		(document.activeElement as HTMLElement).blur();
		const undo = ctx.notify.mock.lastCall![1] as () => void;
		undo();
		await settle();
		await settle();
		expect(document.activeElement).toBe(thumbs(ctx.target)[1]);
		expect(document.activeElement?.closest('[data-page-id]')?.getAttribute('data-page-id')).toBe(
			second
		);
	});

	it('leaves the focus alone when an undo comes from somewhere else', async () => {
		const store = new DocumentStore(null);
		store.addPage();
		store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;
		const elsewhere = document.createElement('button');
		document.body.append(elsewhere);
		try {
			button(ctx.target, 'Delete page 2').click();
			flushSync();
			elsewhere.focus();
			(ctx.notify.mock.lastCall![1] as () => void)();
			await settle();
			await settle();
			expect(thumbs(ctx.target)).toHaveLength(2);
			expect(document.activeElement).toBe(elsewhere);
		} finally {
			elsewhere.remove();
		}
	});

	it('Delete on a focused thumbnail deletes the page and focuses the one in its place', async () => {
		const store = new DocumentStore(null);
		store.addPage();
		store.addPage();
		const third = store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		thumbs(ctx.target)[1].focus();
		const event = keydown(thumbs(ctx.target)[1], 'Delete');
		expect(event.defaultPrevented).toBe(true);
		await settle();
		expect(ctx.notify).toHaveBeenCalledWith('Page 2 deleted', expect.any(Function));
		expect(document.activeElement).toBe(thumbs(ctx.target)[1]);
		expect(document.activeElement?.closest('[data-page-id]')?.getAttribute('data-page-id')).toBe(
			third
		);
	});

	it('hands the focus back when the last page goes', async () => {
		const store = new DocumentStore(null);
		store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		thumbs(ctx.target)[0].focus();
		keydown(thumbs(ctx.target)[0], 'Backspace');
		await settle();
		expect(store.pageCount).toBe(0);
		expect(ctx.target.querySelector('aside')).toBeNull();
		expect(ctx.onemptied).toHaveBeenCalledOnce();
	});

	it('moves between thumbnails with the arrows, kept from the window', () => {
		const store = new DocumentStore(null);
		store.addPage();
		store.addPage();
		store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;
		const onWindowKey = vi.fn();
		window.addEventListener('keydown', onWindowKey);
		try {
			const list = thumbs(ctx.target);
			list[0].focus();
			keydown(list[0], 'ArrowDown');
			expect(document.activeElement).toBe(list[1]);
			keydown(list[1], 'End');
			expect(document.activeElement).toBe(list[2]);
			keydown(list[2], 'ArrowDown');
			expect(document.activeElement).toBe(list[2]);
			keydown(list[2], 'Home');
			expect(document.activeElement).toBe(list[0]);
			keydown(list[0], 'ArrowUp');
			expect(document.activeElement).toBe(list[0]);
			expect(onWindowKey).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener('keydown', onWindowKey);
		}
	});

	it('adds an empty page from ⊕', async () => {
		const store = new DocumentStore(null);
		store.addChart(chart());
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		button(ctx.target, 'Add page').click();
		await settle();
		expect(store.pageCount).toBe(2);
		expect(thumbs(ctx.target).map((el) => el.getAttribute('aria-label'))).toEqual([
			'Page 1, 1 chart',
			'Page 2, no charts'
		]);
		// The focus stays on ⊕; a screen reader hears what it did.
		expect(ctx.target.querySelector('[role="status"]')?.textContent).toBe('Page 2 added');
	});

	it('turns ⊕ off once the document has the most pages it may', () => {
		const store = new DocumentStore(null);
		for (let i = 0; i < MAX_PAGES; i++) store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;
		const add = button(ctx.target, 'Add page');
		expect(add.disabled).toBe(true);
		expect(add.title).toBe('A PDF document has at most 100 pages');
		add.click();
		expect(store.pageCount).toBe(MAX_PAGES);
	});

	it('collapses to a tab with the page count and expands again', () => {
		const store = new DocumentStore(null);
		store.addPage();
		store.addPage();
		const ctx = setup(store);
		cleanup = ctx.cleanup;
		const tab = button(ctx.target, 'PDF pages, 2');
		const panel = ctx.target.querySelector('aside')!;

		expect(tab.getAttribute('aria-expanded')).toBe('true');
		expect(tab.getAttribute('aria-controls')).toBe(panel.id);
		expect(panel.inert).toBe(false);
		expect(tab.querySelector('.count')).toBeNull();

		tab.click();
		flushSync();
		expect(store.panelOpen).toBe(false);
		expect(tab.getAttribute('aria-expanded')).toBe('false');
		expect(panel.inert).toBe(true);
		expect(ctx.target.querySelector('.dock')?.classList.contains('collapsed')).toBe(true);
		expect(tab.querySelector('.count')?.textContent).toBe('2');

		tab.click();
		flushSync();
		expect(store.panelOpen).toBe(true);
		expect(panel.inert).toBe(false);
	});

	it('reveal opens a collapsed panel', async () => {
		const store = new DocumentStore(null);
		const { pageId } = store.addChart(chart());
		store.panelOpen = false;
		const ctx = setup(store);
		cleanup = ctx.cleanup;

		await ctx.component.reveal(pageId);
		flushSync();
		expect(store.panelOpen).toBe(true);
		expect(ctx.target.querySelector('.dock')?.classList.contains('collapsed')).toBe(false);
	});
});
