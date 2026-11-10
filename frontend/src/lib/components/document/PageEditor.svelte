<script lang="ts">
	/**
	 * The page editor: the previous, current and next page side by side over the
	 * dimmed app, a strip of every page below, ⊗ at the top right.
	 *
	 * A native modal `<dialog>`, like the About dialog: the top layer, the app behind
	 * it inert, the focus back where it was on close. It is open while `pageId` is set
	 * and calls `onclose` when it closes itself (Escape, ⊗, the backdrop); it moves
	 * between pages on its own and mirrors the current one in `store.selectedPageId`.
	 *
	 * A chart is carried by the pointer, free of the paper, and let go it settles on
	 * the page its centre is over or nearest to, snapped with `snapMove` (Shift held
	 * shows the lines it would snap to); out of reach of every page it goes back.
	 * Charts on the current page resize by their corners (`snapResize`, aspect locked).
	 * The store is written once, on release. From the keyboard a chart nudges by 1 mm
	 * (Shift: 10), + and − step its size, Page Up/Down move it to the page before or
	 * after, and Delete removes it; ←/→ elsewhere change the page. A selected chart's
	 * toolbar does the same without a drag.
	 *
	 * ⌘Z / Ctrl+Z is the toast's Undo, as on the page behind (which the modal keeps
	 * from these keys): a chart removed here, or a page deleted in the panel.
	 */
	import { tick } from 'svelte';
	import { MAX_ITEMS_PER_PAGE, type DocumentStore } from '$lib/document/document.svelte';
	import {
		fitFrame,
		pageSize,
		placeFrame,
		snapMove,
		snapResize,
		snapThresholdMm,
		stepSize,
		type ResizeAnchor,
		type SnapGuide
	} from '$lib/document/geometry';
	import { plural } from '$lib/document/labels';
	import type { DocItem, DocPage, PageOrientation, Rect } from '$lib/document/types';
	import { prefersReducedMotion } from '$lib/ui/motion';
	import { isModShortcut } from '$lib/shortcuts';
	import type { ChartAction } from './EditorItem.svelte';
	import EditorPage, { type PageDrag } from './EditorPage.svelte';
	import EditorStrip from './EditorStrip.svelte';
	import {
		anchorOf,
		cornerOf,
		landingPage,
		EDITOR_LAYOUT,
		editorLayout,
		frameUnderPointer,
		nudgeDelta,
		offsetBox,
		resizeRect,
		mmToScreen,
		screenToMm,
		sizeStep,
		spokenSize,
		type Box,
		type Point,
		type Size,
		type SlotRole
	} from './editor-geometry';

	interface Props {
		store: DocumentStore;
		/** The page to open on; null keeps the editor closed. */
		pageId: string | null;
		/** The editor closed itself (Escape, ⊗, the backdrop); clear `pageId`. */
		onclose: () => void;
		/** Show a toast, with an Undo button when `undo` is given. */
		notify: (message: string, undo?: () => void) => void;
		/** ⌘Z / Ctrl+Z: run the toast's Undo, if it has one. */
		undo: () => void;
		/** ⌘ is the command modifier (Apple), not Ctrl. */
		apple: boolean;
	}

	let { store, pageId, onclose, notify, undo, apple }: Props = $props();

	/** A press must travel this far, px, before it drags: a click selects without snapping. */
	const DRAG_SLOP_PX = 3;
	/**
	 * The catch zone around every page, px: a chart let go with its centre within
	 * this of a page lands on that page, brought to the nearest place it may be.
	 */
	const DROP_SLACK_PX = 40;
	/** How long the guides a keyboard nudge lands on stay drawn, ms. */
	const FLASH_MS = 700;
	/** The snap-back after a drag let go off every page. */
	const RETURN_MS = 200;
	/** How long a chart let go over a page takes to come to rest in its place. */
	const SETTLE_MS = 220;
	/** Stage size before the first measurement (and in tests, which have no layout). */
	const FALLBACK_STAGE: Size = { w: 1200, h: 640 };

	const id = $props.id();
	const hintId = `${id}-hint`;

	let dialogEl = $state<HTMLDialogElement>();
	let stageEl = $state<HTMLDivElement>();
	let stageSize = $state<Size>(FALLBACK_STAGE);
	/** Pages slide once the stage has its size; before that they would slide in from the fallback. */
	let animated = $state(false);
	/** The page shown in the middle; follows `pageId` and moves on its own. */
	let currentId = $derived(pageId);
	/** Where the current page was, for when it disappears from under the editor. */
	let lastIndex = 0;
	let announcement = $state('');
	let returningId = $state<string | null>(null);
	/** A chart coming to rest after it was let go over a page. */
	let settlingId = $state<string | null>(null);
	let flash = $state.raw<{ pageId: string; guides: SnapGuide[] } | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	/** The strip's height, px: the toast, lodged in the dialog, sits above it. */
	let stripHeight = $state(0);
	/** True from the press on the backdrop to the click: a drag that ends there is no click. */
	let pressedOnBackdrop = false;

	const open = $derived(pageId !== null);
	const pages = $derived(store.pages);
	const index = $derived.by(() => {
		const found = currentId === null ? -1 : store.pageIndex(currentId);
		return found >= 0 ? found : Math.min(lastIndex, pages.length - 1);
	});
	const current = $derived<DocPage | null>(pages[index] ?? null);
	const prev = $derived<DocPage | null>(index > 0 ? pages[index - 1] : null);
	const next = $derived<DocPage | null>(pages[index + 1] ?? null);

	const layout = $derived(
		editorLayout(stageSize, {
			prev: prev ? pageSize(prev.orientation) : null,
			current: pageSize(current?.orientation ?? 'portrait'),
			next: next ? pageSize(next.orientation) : null
		})
	);

	interface Slot {
		role: SlotRole;
		page: DocPage;
		number: number;
		box: Box;
	}

	const slots = $derived.by(() => {
		const list: Slot[] = [];
		const add = (role: SlotRole, page: DocPage | null, at: number) => {
			const box = layout.slots[role];
			if (page && box) list.push({ role, page, number: at + 1, box });
		};
		add('prev', prev, index - 1);
		add('current', current, index);
		add('next', next, index + 1);
		return list;
	});

	const chartCount = $derived(store.chartCount);
	const summary = $derived(`${plural(pages.length, 'page')} · ${plural(chartCount, 'chart')} · A4`);

	$effect(() => {
		if (index >= 0) lastIndex = index;
	});

	// Open and close with the prop. The content renders first, so the stage can be measured.
	$effect(() => {
		const dialog = dialogEl;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// The dialog itself takes the focus: on ⊗, Safari would ring it on every open. Tab reaches ⊗.
			dialog.focus({ preventScroll: true });
			measureStage();
			// Two frames: the first paints at the measured size, the next may animate.
			requestAnimationFrame(() => requestAnimationFrame(() => (animated = dialog.open)));
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	// The current page is the selected one; a document emptied under the editor closes it.
	$effect(() => {
		if (!open) return;
		if (current) store.selectedPageId = current.id;
		else if (dialogEl?.open) closeEditor();
		else onclose();
	});

	$effect(() => {
		const el = stageEl;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => measureStage());
		observer.observe(el);
		return () => observer.disconnect();
	});

	// Keys with the focus lost to the body (its element removed) still belong to the editor.
	$effect(() => {
		if (!open) return;
		const onKeydown = (event: KeyboardEvent) => {
			if (event.target === document.body || event.target === document.documentElement) {
				handleKeydown(event);
			}
		};
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
	});

	// The strip grows a scrollbar with more pages, which shrinks the stage: measured with it.
	function measureStage() {
		if (!stageEl) return;
		const { clientWidth: w, clientHeight: h } = stageEl;
		stageSize = w > 0 && h > 0 ? { w, h } : FALLBACK_STAGE;
		stripHeight = dialogEl?.querySelector<HTMLElement>('[data-strip]')?.offsetHeight ?? 0;
	}

	function closeEditor() {
		dialogEl?.close();
	}

	function handleClose() {
		endDrag();
		clearTimeout(flashTimer);
		flash = null;
		animated = false;
		store.flush();
		if (pageId !== null) onclose();
	}

	function handleCancel(event: Event) {
		// Escape mid-drag (or a platform's back gesture) drops the drag, not the editor.
		if (session) {
			event.preventDefault();
			cancelDrag();
		}
	}

	function handleBackdropPointerDown(event: PointerEvent) {
		pressedOnBackdrop = event.target === dialogEl;
	}

	function handleBackdropClick(event: MouseEvent) {
		// The content fills the dialog box, so a click on the dialog itself is on the backdrop.
		if (pressedOnBackdrop && event.target === dialogEl) closeEditor();
		pressedOnBackdrop = false;
	}

	function announce(message: string) {
		// Cleared first, so the same words twice are read twice.
		announcement = '';
		void tick().then(() => (announcement = message));
	}

	/** Show page `id`; `quiet` when the caller says something itself. */
	function setCurrent(id: string, focusStrip = false, quiet = false) {
		const at = store.pageIndex(id);
		// Mid-drag (a second finger on the strip) the pages stay put under the chart.
		if (at < 0 || session) return;
		if (id !== current?.id && !quiet) announce(`Page ${at + 1} of ${pages.length}`);
		currentId = id;
		if (focusStrip) {
			void tick().then(() =>
				dialogEl?.querySelector<HTMLElement>('[data-strip] [aria-current="page"]')?.focus()
			);
		}
	}

	function step(by: number, focusStrip: boolean) {
		const page = pages[index + by];
		if (page) setCurrent(page.id, focusStrip);
	}

	function addPage() {
		if (session || !store.canAddPage) return;
		const id = store.addPage();
		setCurrent(id);
		announce(`Page ${pages.length} added`);
	}

	/**
	 * Delete an empty page (its label's button, or Delete with the focus on the page).
	 * A page with charts on it is not deleted from here: its charts are removed one by
	 * one, or the page is deleted in the pages panel. The page that takes its place is
	 * shown; with none left the editor closes. The toast's Undo brings it back.
	 */
	function deletePage(id: string) {
		const page = store.page(id);
		if (session || !page || page.items.length > 0) return;
		const number = store.pageIndex(id) + 1;
		const restore = store.removePage(id);
		notify(`Page ${number} deleted`, () => {
			if (!restore() || !open) return;
			setCurrent(id, false, true);
			announce(`Page ${number} restored`);
			void tick().then(focusPaper);
		});
		// The button went with its page: the focus goes to the page now shown.
		void tick().then(focusPaper);
	}

	function setOrientation(id: string, orientation: PageOrientation) {
		if (!session) store.setOrientation(id, orientation);
	}

	/** Keys on the dialog. They go no further: the generator's shortcuts are behind the modal. */
	function handleKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			if (session) cancelDrag();
			else closeEditor();
			return;
		}
		// By the key's place, not its character: Ctrl+Z on a Russian layout types "я".
		if (isModShortcut(event, 'KeyZ', apple)) {
			event.preventDefault();
			if (!event.repeat && !session) undo();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey || session) return;
		const target = event.target as Element | null;
		// Delete on the page itself (no chart selected) deletes it, if it is empty.
		if (event.key === 'Delete' || event.key === 'Backspace') {
			if (current?.items.length === 0 && target?.matches?.('[data-paper]')) {
				event.preventDefault();
				if (!event.repeat) deletePage(current.id);
			}
			return;
		}
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		// A focused chart takes the arrows itself; a text field would want them too.
		if (target?.closest?.('[data-item-id], input, textarea, select')) return;
		event.preventDefault();
		step(event.key === 'ArrowLeft' ? -1 : 1, Boolean(target?.closest?.('[data-strip]')));
	}

	// === Pointer drags ===

	interface Session {
		kind: 'move' | 'resize';
		pageId: string;
		itemId: string;
		aspect: number;
		pointerId: number;
		element: HTMLElement;
		listeners: AbortController;
		/** Screen px at the press. */
		start: Point;
		startFrame: Rect;
		/** Every page on the stage at the press, screen px. */
		boxes: { id: string; box: Box }[];
		scale: number;
		/** Move: the grabbed point, mm from the chart's top-left. */
		grab: Point;
		/** Resize: the fixed corner, and the dragged one at the press, mm. */
		anchor: ResizeAnchor;
		anchorPoint: Point;
		corner: Point;
		moved: boolean;
		/** Shift is held: a chart being carried shows the lines it would snap to. */
		shift: boolean;
		/** The pointer's last applied position: Shift pressed with the pointer at rest redraws from it. */
		last: Point | null;
		/** The pointer's latest position, applied once per frame. */
		pending: Point | null;
		frameRequest: number;
	}

	interface DragView {
		kind: 'moving' | 'detached' | 'resizing';
		pageId: string;
		itemId: string;
		/** The page it would land on; null out of reach of every page. */
		targetId: string | null;
		/**
		 * Where the chart is drawn, its own page's mm. Moving, that is wherever the
		 * pointer has it, on a page or off: it is not held to the paper. Resizing, it
		 * is the snapped frame, which is also what the resize commits.
		 */
		frame: Rect;
		/** Moving: where it would come to rest if let go now, the target page's mm. */
		landing: Rect | null;
		/** The lines a resize is snapped to; a chart being carried shows its own only with Shift held. */
		guides: SnapGuide[];
	}

	let session: Session | null = null;
	let drag = $state.raw<DragView | null>(null);
	/** A chart is off its place: in the hand, or on its way to rest or back. */
	const carrying = $derived(
		(drag !== null && drag.kind !== 'resizing') || settlingId !== null || returningId !== null
	);
	/** Set for the click a drag's release ends in. */
	let swallowClick = false;

	function handleClickCapture(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.stopPropagation();
		event.preventDefault();
	}

	function pageBoxes(): { id: string; box: Box }[] {
		const origin = stageEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
		return slots.map((slot) => ({
			id: slot.page.id,
			box: offsetBox(slot.box, origin.left, origin.top)
		}));
	}

	/** A press that may start a drag: the primary button, and no drag already going. */
	function claimPointer(event: PointerEvent): boolean {
		if (session || !current) return false;
		if (event.pointerType === 'mouse' && event.button !== 0) return false;
		// No text selection, no native image drag; the focus is set by hand instead.
		event.preventDefault();
		return true;
	}

	/** The page a chart is on: the current one, or a neighbour it is grabbed from. */
	function pageOf(item: DocItem): DocPage | undefined {
		return store.pages.find((page) => page.items.some((it) => it.id === item.id));
	}

	function beginSession(
		event: PointerEvent,
		item: DocItem,
		pageId: string,
		kind: Session['kind'],
		extra: Partial<Pick<Session, 'grab' | 'anchor' | 'anchorPoint' | 'corner'>>
	) {
		const element = event.currentTarget as HTMLElement;
		const listeners = new AbortController();
		const { signal } = listeners;
		session = {
			kind,
			pageId,
			itemId: item.id,
			aspect: item.chart.aspect,
			pointerId: event.pointerId,
			element,
			listeners,
			start: { x: event.clientX, y: event.clientY },
			startFrame: { ...item.frame },
			boxes: pageBoxes(),
			scale: layout.scale,
			grab: { x: 0, y: 0 },
			anchor: 'nw',
			anchorPoint: { x: 0, y: 0 },
			corner: { x: 0, y: 0 },
			moved: false,
			shift: event.shiftKey,
			last: null,
			pending: null,
			frameRequest: 0,
			...extra
		};
		try {
			element.setPointerCapture(event.pointerId);
		} catch {
			// No capture (a synthetic event): the listeners below still see the pointer.
		}
		element.addEventListener('pointermove', handlePointerMove, { signal });
		element.addEventListener('pointerup', handlePointerUp, { signal });
		element.addEventListener('pointercancel', () => cancelDrag(), { signal });
		element.addEventListener('lostpointercapture', () => cancelDrag(), { signal });
		// Shift pressed or let go with the pointer at rest shows or hides the lines at once.
		const handleShift = (keyEvent: KeyboardEvent) => {
			const s = session;
			if (!s || keyEvent.key !== 'Shift') return;
			s.shift = keyEvent.type === 'keydown';
			if (s.last) update(s, s.last);
		};
		window.addEventListener('keydown', handleShift, { signal, capture: true });
		window.addEventListener('keyup', handleShift, { signal, capture: true });
	}

	function startMove(event: PointerEvent, item: DocItem) {
		const page = pageOf(item);
		const box = page && pageBoxes().find((b) => b.id === page.id)?.box;
		if (!page || !box || !claimPointer(event)) return;
		// A neighbour's chart is not focusable; it takes the focus once it lands on the current page.
		(event.currentTarget as HTMLElement).focus({ preventScroll: true });
		const pointer = screenToMm({ x: event.clientX, y: event.clientY }, box, layout.scale);
		beginSession(event, item, page.id, 'move', {
			grab: { x: pointer.x - item.frame.x, y: pointer.y - item.frame.y }
		});
	}

	function startResize(event: PointerEvent, item: DocItem, handle: ResizeAnchor) {
		if (!claimPointer(event)) return;
		event.stopPropagation();
		const chartEl = (event.currentTarget as HTMLElement)
			.closest('[data-item-id]')
			?.querySelector<HTMLElement>('[role="button"]');
		chartEl?.focus({ preventScroll: true });
		const anchor = anchorOf(handle);
		beginSession(event, item, current!.id, 'resize', {
			anchor,
			anchorPoint: cornerOf(item.frame, anchor),
			corner: cornerOf(item.frame, handle)
		});
	}

	function handlePointerMove(event: PointerEvent) {
		const s = session;
		if (!s || event.pointerId !== s.pointerId) return;
		s.shift = event.shiftKey;
		s.pending = { x: event.clientX, y: event.clientY };
		if (!s.frameRequest) {
			s.frameRequest = requestAnimationFrame(() => {
				if (session !== s) return;
				s.frameRequest = 0;
				applyPending(s);
			});
		}
	}

	function applyPending(s: Session) {
		const point = s.pending;
		s.pending = null;
		if (point) update(s, point);
	}

	function handlePointerUp(event: PointerEvent) {
		const s = session;
		if (!s || event.pointerId !== s.pointerId) return;
		cancelAnimationFrame(s.frameRequest);
		s.frameRequest = 0;
		s.pending = { x: event.clientX, y: event.clientY };
		applyPending(s);
		commit(s);
	}

	function update(s: Session, point: Point) {
		s.last = point;
		const dx = point.x - s.start.x;
		const dy = point.y - s.start.y;
		if (!s.moved && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
		s.moved = true;
		const threshold = snapThresholdMm(s.scale);
		const base = { pageId: s.pageId, itemId: s.itemId };

		if (s.kind === 'resize') {
			const page = store.page(s.pageId);
			if (!page) return;
			const corner = { x: s.corner.x + dx / s.scale, y: s.corner.y + dy / s.scale };
			const raw = resizeRect(s.anchor, s.anchorPoint, corner);
			const others = page.items.filter((it) => it.id !== s.itemId).map((it) => it.frame);
			const snapped = snapResize(raw, s.anchor, s.aspect, others, page.orientation, threshold);
			drag = { ...base, kind: 'resizing', targetId: s.pageId, landing: null, ...snapped };
			return;
		}

		// The chart goes wherever the pointer takes it, on the paper or off it: it is in
		// the hand, not on a page, and nothing is drawn for it on the pages unless Shift
		// is held, which shows the lines it would snap to. Where it would come to rest
		// is worked out beside it; it only goes there when let go.
		const home = s.boxes.find((b) => b.id === s.pageId)?.box;
		if (!home) return;
		let frame: Rect = {
			...s.startFrame,
			x: s.startFrame.x + dx / s.scale,
			y: s.startFrame.y + dy / s.scale
		};
		const centre = mmToScreen(
			{ x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 },
			home,
			s.scale
		);
		const targetId = landingPage(centre, s.boxes, DROP_SLACK_PX);
		const target = targetId === null ? undefined : store.page(targetId);
		const box = s.boxes.find((b) => b.id === targetId)?.box;
		if (!target || !box) {
			// Out of reach of every page: let go here, it goes back where it was.
			drag = { ...base, kind: 'detached', targetId: null, frame, landing: null, guides: [] };
			return;
		}
		// A chart too large for the target page shrinks to fit it, as it will on the drop.
		const size =
			target.id === s.pageId
				? s.startFrame
				: fitFrame({ ...s.startFrame, x: 0, y: 0 }, s.aspect, target.orientation);
		if (size.w !== s.startFrame.w || size.h !== s.startFrame.h) {
			frame = frameUnderPointer(screenToMm(point, home, s.scale), s.grab, s.startFrame, size);
		}
		const raw = frameUnderPointer(screenToMm(point, box, s.scale), s.grab, s.startFrame, size);
		const others = target.items.filter((it) => it.id !== s.itemId).map((it) => it.frame);
		const landing = snapMove(raw, others, target.orientation, threshold);
		drag = {
			...base,
			kind: 'moving',
			targetId: target.id,
			frame,
			landing: landing.frame,
			guides: s.shift ? landing.guides : []
		};
	}

	/** The chart's element in the editor, on whichever page it is. */
	function itemElement(itemId: string): HTMLElement | null {
		return (
			Array.from(dialogEl?.querySelectorAll<HTMLElement>('[data-item-id]') ?? []).find(
				(element) => element.dataset.itemId === itemId
			) ?? null
		);
	}

	function commit(s: Session) {
		const view = drag;
		// Where the chart is on screen as it is let go: it settles from there.
		const held = s.moved ? (itemElement(s.itemId)?.getBoundingClientRect() ?? null) : null;
		endDrag();
		if (!s.moved || !view) return;
		// The click this release ends in must not make the page it was grabbed on current.
		swallowClick = true;
		setTimeout(() => (swallowClick = false));
		if (view.kind === 'resizing') {
			store.updateItem(s.pageId, s.itemId, view.frame);
		} else if (view.targetId === null || !view.landing) {
			snapBack(s.itemId);
		} else if (view.targetId === s.pageId) {
			store.updateItem(s.pageId, s.itemId, view.landing);
			settle(s.itemId, held);
		} else if (store.moveItem(s.itemId, view.targetId, view.landing)) {
			announce(`Chart moved to page ${store.pageIndex(view.targetId) + 1}`);
			settle(s.itemId, held);
			// Its element is gone with it: the focus goes to it on the current page, else stays here.
			const itemId = s.itemId;
			void tick().then(() => {
				const moved = dialogEl?.querySelector<HTMLElement>(
					`.slot[data-role="current"] [data-item-id="${itemId}"] [role="button"]`
				);
				if (moved) moved.focus({ preventScroll: true });
				else focusPaper();
			});
		} else {
			snapBack(s.itemId);
			announce(`Page ${store.pageIndex(view.targetId) + 1} is full`);
		}
	}

	/**
	 * The chart has been let go and is already where it belongs in the document;
	 * on screen it is played there from where the hand left it (`held`), so that it
	 * comes to rest instead of jumping the last of the way. Its element may be a new
	 * one, on another page: found again once the page has drawn it.
	 */
	function settle(itemId: string, held: DOMRect | null) {
		if (!held || prefersReducedMotion()) return;
		settlingId = itemId;
		const done = () => {
			if (settlingId === itemId) settlingId = null;
		};
		void tick().then(() => {
			const element = itemElement(itemId);
			if (!element || typeof element.animate !== 'function') return done();
			const rest = element.getBoundingClientRect();
			if (rest.width <= 0) return done();
			const dx = held.left + held.width / 2 - (rest.left + rest.width / 2);
			const dy = held.top + held.height / 2 - (rest.top + rest.height / 2);
			const scale = held.width / rest.width;
			const move = element.animate(
				[{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }],
				{ duration: SETTLE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
			);
			move.onfinish = done;
			move.oncancel = done;
		});
	}

	function cancelDrag() {
		const s = session;
		if (!s) return;
		const moved = s.moved && drag !== null;
		endDrag();
		if (moved) snapBack(s.itemId);
	}

	function endDrag() {
		const s = session;
		if (!s) return;
		session = null;
		cancelAnimationFrame(s.frameRequest);
		s.listeners.abort();
		try {
			if (s.element.hasPointerCapture?.(s.pointerId)) s.element.releasePointerCapture(s.pointerId);
		} catch {
			// Already released.
		}
		drag = null;
	}

	function snapBack(itemId: string) {
		returningId = itemId;
		setTimeout(() => {
			if (returningId === itemId) returningId = null;
		}, RETURN_MS);
	}

	/** What `page` draws for the drag going on (or the guides of the last nudge). */
	function pageDrag(page: DocPage): PageDrag | null {
		const view = drag;
		if (!view) {
			return flash?.pageId === page.id
				? { itemId: null, frame: null, kind: 'moving', guides: flash.guides, target: false }
				: null;
		}
		const isSource = view.pageId === page.id;
		const isTarget = view.targetId === page.id;
		if (!isSource && !isTarget) return null;
		return {
			itemId: isSource ? view.itemId : null,
			// Its own page's mm, wherever on the stage that puts it: the page draws it
			// past its own edges, above the others.
			frame: isSource ? view.frame : null,
			kind: view.kind,
			guides: isTarget ? view.guides : [],
			target: isTarget
		};
	}

	// === Keyboard on a chart ===

	function handleItemKeydown(event: KeyboardEvent, item: DocItem) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const delta = nudgeDelta(event.key, event.shiftKey);
		const step = sizeStep(event.key, event.code);
		let action: (() => void) | null = null;
		if (delta) action = () => nudge(item, delta);
		else if (step !== 0) action = () => handleItemAction(item, step > 0 ? 'larger' : 'smaller');
		else if (event.key === 'PageUp') action = () => handleItemAction(item, 'prev');
		else if (event.key === 'PageDown') action = () => handleItemAction(item, 'next');
		else if (event.key === 'Delete' || event.key === 'Backspace') action = () => removeChart(item);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		if (!session) action();
	}

	/** The toolbar's buttons and their keys: a size step, or a move to the page either side. */
	function handleItemAction(item: DocItem, action: ChartAction) {
		if (session) return;
		if (action === 'smaller' || action === 'larger') resizeStep(item, action === 'larger' ? 1 : -1);
		else moveToPage(item, action === 'prev' ? -1 : 1);
	}

	function resizeStep(item: DocItem, direction: 1 | -1) {
		const page = current;
		if (!page) return;
		const frame = stepSize(item.frame, item.chart.aspect, page.orientation, direction);
		if (!frame) {
			announce(direction > 0 ? 'Already the largest size' : 'Already the smallest size');
			return;
		}
		store.updateItem(page.id, item.id, frame);
		announce(spokenSize(frame));
	}

	/** To the page before or after, where it fits clear of the charts there (`placeFrame`). */
	function moveToPage(item: DocItem, by: -1 | 1) {
		const target = pages[index + by];
		const number = index + by + 1;
		if (!target) {
			announce(by < 0 ? 'No page before this one' : 'No page after this one');
			return;
		}
		if (target.items.length >= MAX_ITEMS_PER_PAGE) {
			announce(`Page ${number} is full`);
			return;
		}
		const others = target.items.map((it) => it.frame);
		const frame = placeFrame(item.frame, item.chart.aspect, others, target.orientation);
		if (!store.moveItem(item.id, target.id, frame)) return;
		setCurrent(target.id, false, true);
		announce(`Chart moved to page ${number}`);
		void tick().then(() => focusChart(item.id));
	}

	/** Moves by `delta` mm through `snapMove` with no reach: it only clamps, and shows the lines it lands on. */
	function nudge(item: DocItem, delta: Point) {
		const page = current;
		if (!page) return;
		const others = page.items.filter((it) => it.id !== item.id).map((it) => it.frame);
		const moved = { ...item.frame, x: item.frame.x + delta.x, y: item.frame.y + delta.y };
		const { frame, guides } = snapMove(moved, others, page.orientation, 0);
		store.updateItem(page.id, item.id, frame);
		announce(`${Math.round(frame.x)}, ${Math.round(frame.y)} mm`);
		clearTimeout(flashTimer);
		flash = guides.length > 0 ? { pageId: page.id, guides } : null;
		if (flash) flashTimer = setTimeout(() => (flash = null), FLASH_MS);
	}

	function removeChart(item: DocItem) {
		const page = current;
		if (!page) return;
		const at = page.items.findIndex((it) => it.id === item.id);
		const restore = store.removeItem(page.id, item.id);
		notify('Chart removed', () => undoRemoval(page.id, item.id, restore));
		// The focus goes to the chart that took its place, else the one before, else the page.
		void tick().then(() => {
			const charts = chartElements();
			const nextChart = charts[Math.min(at, charts.length - 1)];
			if (nextChart) nextChart.focus({ preventScroll: true });
			else focusPaper();
		});
	}

	/**
	 * The toast's Undo for a chart removed here (its button or ⌘Z): back on its page,
	 * which the editor shows, with the focus on it. Nothing to say if it did not come
	 * back, or the editor has closed meanwhile.
	 */
	function undoRemoval(pageId: string, itemId: string, restore: () => boolean) {
		if (!restore() || !open) return;
		if (pageId !== current?.id) setCurrent(pageId, false, true);
		announce('Chart restored');
		void tick().then(() => focusChart(itemId));
	}

	function focusChart(itemId: string) {
		dialogEl
			?.querySelector<HTMLElement>(`[data-item-id="${itemId}"] [role="button"]`)
			?.focus({ preventScroll: true });
	}

	function chartElements(): HTMLElement[] {
		return Array.from(
			dialogEl?.querySelectorAll<HTMLElement>(
				'.slot[data-role="current"] [data-item-id] [role="button"]'
			) ?? []
		);
	}

	function focusPaper() {
		dialogEl
			?.querySelector<HTMLElement>('.slot[data-role="current"] [data-paper]')
			?.focus({ preventScroll: true });
	}
</script>

<!-- Escape is handled here (it also cancels a drag); the backdrop click only mirrors it for the pointer. -->
<dialog
	bind:this={dialogEl}
	class="editor"
	class:is-animated={animated}
	tabindex="-1"
	style:--strip-h={stripHeight > 0 ? `${stripHeight}px` : undefined}
	aria-labelledby="{id}-title"
	aria-describedby="{id}-summary"
	onkeydown={handleKeydown}
	oncancel={handleCancel}
	onclose={handleClose}
	onpointerdown={handleBackdropPointerDown}
	onclick={handleBackdropClick}
	onclickcapture={handleClickCapture}
>
	{#if open && current}
		<div class="content">
			<header class="bar">
				<!-- First in the dialog: the first stop for Tab. -->
				<button
					class="close"
					type="button"
					aria-label="Close"
					title="Close · Esc"
					onclick={closeEditor}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="6.25" />
						<path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />
					</svg>
				</button>
				<div class="title">
					<h2 id="{id}-title">PDF document</h2>
					<p class="summary" id="{id}-summary">{summary}</p>
				</div>
			</header>

			<div class="stage" class:is-carrying={carrying} bind:this={stageEl}>
				{#each slots as slot (slot.page.id)}
					<EditorPage
						page={slot.page}
						number={slot.number}
						prevPage={slot.role === 'current' && prev ? slot.number - 1 : null}
						nextPage={slot.role === 'current' && next ? slot.number + 1 : null}
						role={slot.role}
						box={slot.box}
						labelHeight={EDITOR_LAYOUT.labelHeight}
						narrow={layout.narrow}
						drag={pageDrag(slot.page)}
						{returningId}
						{settlingId}
						{carrying}
						{hintId}
						onactivate={(id) => setCurrent(id)}
						onorientation={setOrientation}
						ondelete={deletePage}
						onmovestart={startMove}
						onresizestart={startResize}
						onitemkeydown={handleItemKeydown}
						onremove={removeChart}
						onitemaction={handleItemAction}
					/>
				{/each}
			</div>

			<EditorStrip
				{pages}
				currentId={current.id}
				canAdd={store.canAddPage}
				onselect={(id) => setCurrent(id)}
				onadd={addPage}
			/>

			<p class="sr-only" id={hintId}>
				Drag to move it, holding Shift to see the lines it will snap to, or use the arrow keys, with
				Shift for 10 millimetres; Page Up and Page Down move it to the page before or after. Drag a
				corner to resize it, or press plus or minus. Delete removes it.
			</p>
			<p class="sr-only" aria-live="polite">{announcement}</p>
		</div>
	{/if}
</dialog>

<style>
	/* The paper and ink tokens are the app's (tokens.css), shared with the pages panel. */
	.editor {
		/* The dialog's distance from the window's edge. */
		--editor-inset: 12px;
		/*
		 * The toast lodges in the dialog while it is open (Toast.svelte): above the
		 * strip of mini pages, which would otherwise sit under it.
		 */
		--toast-bottom: calc(var(--editor-inset) + var(--strip-h, 88px) + 12px);

		position: fixed;
		inset: 0;
		box-sizing: border-box;
		width: auto;
		height: auto;
		max-width: none;
		max-height: none;
		margin: var(--editor-inset);
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--hairline);
		border-radius: 16px;
		background: var(--panel);
		color: var(--fg-2);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
	}

	.editor[open] {
		animation: editor-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.editor::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}

	.editor[open]::backdrop {
		animation: backdrop-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.editor:focus {
		outline: none;
	}

	@keyframes editor-in {
		from {
			opacity: 0;
			transform: scale(0.985);
		}
	}

	@keyframes backdrop-in {
		from {
			opacity: 0;
		}
	}

	.content {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		height: 100%;
	}

	.bar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'title close';
		align-items: center;
		gap: 16px;
		height: 56px;
		padding: 0 12px 0 20px;
	}

	.title {
		grid-area: title;
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-width: 0;
	}

	h2 {
		margin: 0;
		color: var(--fg-1);
		font:
			500 15px/20px Inter,
			system-ui,
			sans-serif;
		white-space: nowrap;
	}

	.summary {
		margin: 0;
		overflow: hidden;
		color: var(--fg-3);
		font:
			400 12px/16px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.close {
		grid-area: close;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--fg-2);
		cursor: pointer;
		transition:
			background var(--ease-ui),
			color var(--ease-ui);
	}

	.close svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	@media (hover: hover) {
		.close:hover {
			background: var(--fill-hover);
			color: var(--fg-1);
		}
	}

	.close:active {
		background: var(--fill-press);
		color: var(--fg-1);
	}

	.close:focus-visible {
		outline: 2px solid transparent;
		outline-offset: 2px;
		color: var(--fg-1);
		box-shadow: var(--ring);
	}

	.stage {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	/*
	 * A chart in the hand is not held to the stage either: carried over the bar above
	 * or the strip below, it stays whole and on top of them.
	 */
	.stage.is-carrying {
		z-index: 1;
		overflow: visible;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* A phone: the whole screen, no frame of dimmed app around it. */
	@media (max-width: 743px) {
		.editor {
			--editor-inset: 0px;
			border: 0;
			border-radius: 0;
		}

		.bar {
			height: 52px;
			padding: 0 8px 0 16px;
		}
	}

	@media (max-width: 360px) {
		.summary {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.editor[open],
		.editor[open]::backdrop {
			animation: none;
		}
	}
</style>
