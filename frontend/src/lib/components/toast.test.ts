// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { ToastStore } from '$lib/ui/toast.svelte';
import Toast from './Toast.svelte';

function setup(apple = true) {
	const target = document.createElement('div');
	document.body.append(target);
	const store = new ToastStore();
	const component = mount(Toast, { target, props: { store, apple } });
	flushSync();
	const region = target.querySelector('[role="status"]')!;
	const cleanup = () => {
		unmount(component);
		target.remove();
	};
	return { target, store, region, cleanup };
}

/** The toast follows the store a task after its effect runs, once its live region is in place. */
async function shown() {
	flushSync();
	await new Promise((resolve) => setTimeout(resolve));
	flushSync();
}

describe('Toast', () => {
	let cleanup: (() => void) | null = null;
	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it('has its live region in place, empty, before any message', () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		expect(ctx.region).not.toBeNull();
		expect(ctx.region.textContent?.trim()).toBe('');
	});

	it('shows the message and an Undo that runs the action once', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const undo = vi.fn();
		ctx.store.show('Page 2 deleted', undo);
		await shown();

		expect(ctx.region.querySelector('.message')?.textContent).toBe('Page 2 deleted');
		const button = ctx.region.querySelector<HTMLButtonElement>('button.undo')!;
		expect(button.getAttribute('aria-label')).toBe('Undo');
		button.click();
		flushSync();
		expect(undo).toHaveBeenCalledOnce();
		expect(ctx.store.current).toBeNull();
		// It leaves rather than vanishes: on its way out it is inert, so Undo cannot run twice.
		const leaving = ctx.region.querySelector<HTMLElement>('.toast')!;
		expect(leaving.classList.contains('leaving')).toBe(true);
		expect(leaving.inert).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 200));
		flushSync();
		expect(ctx.region.querySelector('.toast')).toBeNull();
	});

	it('gives way at once to a toast that replaces one on its way out', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		ctx.store.show('First');
		await shown();
		ctx.store.dismiss();
		flushSync();
		expect(ctx.region.querySelector('.toast.leaving')).not.toBeNull();

		ctx.store.show('Second');
		await shown();
		const toast = ctx.region.querySelector('.toast')!;
		expect(toast.querySelector('.message')?.textContent).toBe('Second');
		expect(toast.classList.contains('leaving')).toBe(false);
		// The first one's exit timer does not take the second with it.
		await new Promise((resolve) => setTimeout(resolve, 200));
		flushSync();
		expect(ctx.region.querySelector('.message')?.textContent).toBe('Second');
	});

	it('is simply gone when the system asks for less motion', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
		const ctx = setup();
		cleanup = () => {
			ctx.cleanup();
			vi.unstubAllGlobals();
		};
		ctx.store.show('Saved');
		await shown();
		ctx.store.dismiss();
		flushSync();
		expect(ctx.region.querySelector('.toast')).toBeNull();
	});

	it('shows and announces the Undo shortcut for the platform', async () => {
		const mac = setup(true);
		cleanup = mac.cleanup;
		mac.store.show('Page 2 deleted', () => {});
		await shown();
		const button = mac.region.querySelector('button.undo')!;
		expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+Z');
		expect(button.querySelector('kbd')?.textContent).toBe('⌘Z');
		expect(mac.region.textContent).toContain('or press Command Z');
		mac.cleanup();

		const other = setup(false);
		cleanup = other.cleanup;
		other.store.show('Page 2 deleted', () => {});
		await shown();
		const otherButton = other.region.querySelector('button.undo')!;
		expect(otherButton.getAttribute('aria-keyshortcuts')).toBe('Control+Z');
		expect(otherButton.querySelector('kbd')?.textContent).toBe('Ctrl+Z');
		expect(other.region.textContent).toContain('or press Control Z');
	});

	it('has no Undo when the action cannot be undone', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		ctx.store.show('Preparing the PDF…');
		await shown();
		expect(ctx.region.querySelector('.message')?.textContent).toBe('Preparing the PDF…');
		expect(ctx.region.querySelector('button')).toBeNull();
	});

	it('holds its timeout while the pointer is on it', async () => {
		const ctx = setup();
		cleanup = ctx.cleanup;
		const pause = vi.spyOn(ctx.store, 'pause');
		const resume = vi.spyOn(ctx.store, 'resume');
		ctx.store.show('Page 1 deleted', () => {});
		await shown();
		const toastEl = ctx.region.querySelector('.toast')!;

		toastEl.dispatchEvent(new PointerEvent('pointerenter'));
		expect(pause).toHaveBeenCalledOnce();
		toastEl.dispatchEvent(new PointerEvent('pointerleave'));
		expect(resume).toHaveBeenCalledOnce();
	});
});
