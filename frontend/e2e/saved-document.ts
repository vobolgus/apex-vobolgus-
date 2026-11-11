import type { Page } from '@playwright/test';

/**
 * The document as the browser keeps it, for the specs to seed and to read back.
 *
 * It is saved in a shape with a number (`src/lib/document/storage.ts`): a page's
 * `blocks`, each of a `kind`. The shape before had none: a page's charts in `items`,
 * its texts in `texts`, a table a text with a spec and no words. A spec that seeds
 * that first shape has the app bring it over as it loads.
 */

export const STORAGE_KEY = 'skycharts.document.v1';

export interface Frame {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SavedChart {
	kind: 'chart';
	id: string;
	frame: Frame;
	chart: { marks?: unknown[]; view: { projection: string; pinholeFovDeg: number } };
	closeUpOf?: string;
}

export interface SavedType {
	kind: 'text' | 'table';
	id: string;
	frame: Frame;
	style: { font: string; size: number; bold: boolean; italic: boolean; align: string };
	/** A text's words; a table has none. */
	text?: string;
	/** A table's spec; a text has none. */
	table?: { source: string; look?: string; rows: number; language?: string };
	role?: string;
	chartId?: string;
	rotation?: number;
}

export type SavedBlock = SavedChart | SavedType;

export interface SavedPage {
	id: string;
	orientation: string;
	manual?: boolean;
	template?: { id: string; language: string };
	blocks: SavedBlock[];
}

/** `pages` as a document in the shape the app writes now. */
export function documentOf(pages: readonly unknown[]) {
	return { version: 2, pages };
}

/** Put `document` in storage, in whichever shape it is, and load the app with it. */
export async function seedDocument(page: Page, document: unknown): Promise<void> {
	await page.goto('/');
	await page.evaluate(([key, doc]) => localStorage.setItem(key as string, JSON.stringify(doc)), [
		STORAGE_KEY,
		document
	] as const);
	await page.reload();
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** What is in storage, as it is: null when nothing is. */
export async function savedDocument(page: Page): Promise<Record<string, unknown> | null> {
	return page.evaluate((key) => {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	}, STORAGE_KEY);
}

/**
 * The saved pages (saves are debounced: poll this). A document seeded in the first
 * shape stays in it until something changes; its pages are given in blocks all the
 * same, so a spec reads one shape.
 */
export async function savedPages(page: Page): Promise<SavedPage[]> {
	const saved = await savedDocument(page);
	const pages = (saved?.pages ?? []) as (SavedPage & { items?: object[]; texts?: object[] })[];
	return pages.map(({ items, texts, ...rest }) =>
		items === undefined
			? (rest as SavedPage)
			: {
					...rest,
					blocks: [
						...items.map((item) => ({ ...item, kind: 'chart' }) as SavedChart),
						...(texts ?? []).map(
							(text) => ({ ...text, kind: 'table' in text ? 'table' : 'text' }) as SavedType
						)
					]
				}
	);
}

export function chartsOf(saved: SavedPage): SavedChart[] {
	return saved.blocks.filter((block): block is SavedChart => block.kind === 'chart');
}

/** A page's texts and tables, in their order on it. */
export function typesetOf(saved: SavedPage): SavedType[] {
	return saved.blocks.filter((block): block is SavedType => block.kind !== 'chart');
}
