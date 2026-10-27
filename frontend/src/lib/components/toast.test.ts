// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { ToastStore } from '$lib/ui/toast.svelte';
import Toast from './Toast.svelte';

function setup() {
	const target = document.createElement('div');
	document.body.append(target);
	const store = new ToastStore();
	const component = mount(Toast, { target, props: { store } });
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
		expect(button.textContent).toBe('Undo');
		button.click();
		flushSync();
		expect(undo).toHaveBeenCalledOnce();
		expect(ctx.store.current).toBeNull();
		expect(ctx.region.querySelector('.toast')).toBeNull();
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
