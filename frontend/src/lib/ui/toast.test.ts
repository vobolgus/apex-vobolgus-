import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION_MS, ToastStore } from './toast.svelte';

describe('ToastStore', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows a message for 6 s', () => {
		const toast = new ToastStore();
		expect(TOAST_DURATION_MS).toBe(6000);
		toast.show('Page 2 deleted');
		expect(toast.current?.message).toBe('Page 2 deleted');
		expect(toast.current?.undo).toBeUndefined();

		vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
		expect(toast.current).not.toBeNull();
		vi.advanceTimersByTime(1);
		expect(toast.current).toBeNull();
	});

	it('shows one toast at a time: a new one replaces the old and restarts the clock', () => {
		const toast = new ToastStore();
		const first = toast.show('Page 1 deleted', () => {});
		vi.advanceTimersByTime(5000);
		const second = toast.show('Page 2 deleted');
		expect(second).not.toBe(first);
		expect(toast.current).toEqual({ id: second, message: 'Page 2 deleted' });

		vi.advanceTimersByTime(5000);
		expect(toast.current?.id).toBe(second);
		vi.advanceTimersByTime(1000);
		expect(toast.current).toBeNull();
	});

	it('gives the same message twice a new id', () => {
		const toast = new ToastStore();
		const a = toast.show('Added');
		const b = toast.show('Added');
		expect(b).not.toBe(a);
	});

	it('undo runs the action once and hides the toast', () => {
		const toast = new ToastStore();
		const undo = vi.fn();
		toast.show('Page 2 deleted', undo);

		expect(toast.undo()).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		expect(toast.current).toBeNull();
		expect(toast.undo()).toBe(false);
		expect(undo).toHaveBeenCalledOnce();
	});

	it('undo without an action does nothing', () => {
		const toast = new ToastStore();
		toast.show('Preparing the PDF…');
		expect(toast.undo()).toBe(false);
		expect(toast.current).not.toBeNull();
	});

	it('dismiss with an id only hides that toast', () => {
		const toast = new ToastStore();
		const stale = toast.show('Preparing the PDF…');
		toast.show('Page 1 deleted', () => {});
		toast.dismiss(stale);
		expect(toast.current?.message).toBe('Page 1 deleted');
		toast.dismiss();
		expect(toast.current).toBeNull();
	});

	it('pauses while hovered or focused and resumes with the time that was left', () => {
		const toast = new ToastStore();
		toast.show('Page 2 deleted', () => {});
		vi.advanceTimersByTime(4000);
		toast.pause();
		vi.advanceTimersByTime(60_000);
		expect(toast.current).not.toBeNull();

		toast.resume();
		vi.advanceTimersByTime(1999);
		expect(toast.current).not.toBeNull();
		vi.advanceTimersByTime(1);
		expect(toast.current).toBeNull();
	});

	it('a new toast is not held by the pause of the one it replaced', () => {
		const toast = new ToastStore();
		toast.show('Page 1 deleted');
		toast.pause();
		toast.show('Page 2 deleted');
		vi.advanceTimersByTime(TOAST_DURATION_MS);
		expect(toast.current).toBeNull();
	});

	it('holds a message with no timeout until it is dismissed', () => {
		const toast = new ToastStore();
		const id = toast.hold('Preparing the PDF…');
		vi.advanceTimersByTime(60_000);
		expect(toast.current).toEqual({ id, message: 'Preparing the PDF…' });
		// Hovering and leaving it does not start a clock either.
		toast.pause();
		toast.resume();
		vi.advanceTimersByTime(60_000);
		expect(toast.current?.id).toBe(id);
		toast.dismiss(id);
		expect(toast.current).toBeNull();
	});

	it('times out a toast shown after a held one', () => {
		const toast = new ToastStore();
		toast.hold('Preparing the PDF…');
		toast.show('Couldn’t export the PDF.');
		vi.advanceTimersByTime(TOAST_DURATION_MS);
		expect(toast.current).toBeNull();
	});

	it('takes another duration', () => {
		const toast = new ToastStore(100);
		toast.show('Quick');
		vi.advanceTimersByTime(100);
		expect(toast.current).toBeNull();
	});
});
