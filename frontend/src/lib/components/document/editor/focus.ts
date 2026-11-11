/**
 * Where the focus is, and where it is sent, in the page editor: every look into the
 * dialog's own DOM that the controllers need, in one place.
 *
 * A block is found by its `data-block-id`, its focusable part by `role="button"`, the
 * page shown by its slot's `data-role="current"`, the paper by `data-paper`. Before
 * the dialog is there, nothing is found and nothing is focused.
 */

const CURRENT = '.slot[data-role="current"]';

export class EditorFocus {
	readonly #root: () => HTMLElement | undefined;

	constructor(root: () => HTMLElement | undefined) {
		this.#root = root;
	}

	/** A block's element in the editor, on whichever page it is. */
	element(blockId: string): HTMLElement | null {
		return (
			Array.from(this.#root()?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []).find(
				(element) => element.dataset.blockId === blockId
			) ?? null
		);
	}

	/** Onto a block: it is selected. */
	block(blockId: string): void {
		this.#root()
			?.querySelector<HTMLElement>(`[data-block-id="${blockId}"] [role="button"]`)
			?.focus({ preventScroll: true });
	}

	/** Onto a block if it is on the page shown; says whether it was. */
	blockOnCurrent(blockId: string): boolean {
		const block = this.#root()?.querySelector<HTMLElement>(
			`${CURRENT} [data-block-id="${blockId}"] [role="button"]`
		);
		block?.focus({ preventScroll: true });
		return Boolean(block);
	}

	/** Onto the block at `index` on the page shown, else the last one, else the page itself. */
	blockAt(index: number): void {
		const blocks = Array.from(
			this.#root()?.querySelectorAll<HTMLElement>(`${CURRENT} [data-block-id] [role="button"]`) ??
				[]
		);
		const block = blocks[Math.min(index, blocks.length - 1)];
		if (block) block.focus({ preventScroll: true });
		else this.paper();
	}

	/** Onto the page shown: nothing on it is selected. */
	paper(): void {
		this.#root()
			?.querySelector<HTMLElement>(`${CURRENT} [data-paper]`)
			?.focus({ preventScroll: true });
	}

	/** Onto the page shown, in the strip of every page. */
	strip(): void {
		this.#root()
			?.querySelector<HTMLElement>('[data-strip] [aria-current="page"]')
			?.focus({ preventScroll: true });
	}

	/** The id of the block of the page shown that has the focus (itself, its field or its toolbar). */
	selectedId(): string | null {
		const selected = (document.activeElement as Element | null)?.closest<HTMLElement>(
			`${CURRENT} [data-block-id]`
		);
		return selected?.dataset.blockId ?? null;
	}

	/** Whether the focus is on something in the editor, not left on the dialog or lost to the body. */
	isInside(): boolean {
		const root = this.#root();
		return Boolean(root?.contains(document.activeElement)) && document.activeElement !== root;
	}
}
