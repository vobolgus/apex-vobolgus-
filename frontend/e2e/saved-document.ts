import type { Page } from '@playwright/test';

/**
 * The document as the browser keeps it, for the specs to seed and to read back.
 *
 * It is saved in a shape with a number, under a key that carries it
 * (`src/lib/document/storage.ts`): a page's `blocks`, each of a `kind`. The shape
 * before, under its own key: a page's charts in `items`, its texts in `texts`, a
 * table a text with a spec and no words. A spec that seeds that first shape
 * (`seedFirstShape`) has the app bring it over as it loads.
 */

export const STORAGE_KEY = 'skycharts.document.v2';
export const FIRST_SHAPE_STORAGE_KEY = 'skycharts.document.v1';

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
export function documentOf<P>(pages: readonly P[]): { pages: readonly P[] } {
	return { pages };
}

async function seed(page: Page, key: string, document: unknown): Promise<void> {
	await page.goto('/');
	await page.evaluate(([at, doc]) => localStorage.setItem(at as string, JSON.stringify(doc)), [
		key,
		document
	] as const);
	await page.reload();
	await page.waitForSelector('canvas');
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** Put `document` in storage, in the shape written now, and load the app with it. */
export function seedDocument(page: Page, document: unknown): Promise<void> {
	return seed(page, STORAGE_KEY, document);
}

/** Put `document` in storage as the first shape was kept, and load the app with it. */
export function seedFirstShape(page: Page, document: unknown): Promise<void> {
	return seed(page, FIRST_SHAPE_STORAGE_KEY, document);
}

/** What is in storage under each shape's key, as it is: null where nothing is. */
export async function savedDocuments(
	page: Page
): Promise<{ now: { pages: SavedPage[] } | null; first: { pages: FirstShapePage[] } | null }> {
	return page.evaluate(
		([now, first]) => {
			const read = (key: string) => {
				const raw = localStorage.getItem(key);
				return raw ? JSON.parse(raw) : null;
			};
			return { now: read(now), first: read(first) };
		},
		[STORAGE_KEY, FIRST_SHAPE_STORAGE_KEY] as const
	);
}

/** A page as the first shape kept it. */
interface FirstShapePage extends Omit<SavedPage, 'blocks'> {
	items: object[];
	texts?: object[];
}

/**
 * The saved pages (saves are debounced: poll this). A document seeded in the first
 * shape stays in it until something changes; its pages are given in blocks all the
 * same, so a spec reads one shape.
 */
export async function savedPages(page: Page): Promise<SavedPage[]> {
	const { now, first } = await savedDocuments(page);
	if (now) return now.pages;
	return (first?.pages ?? []).map(({ items, texts, ...rest }) => ({
		...rest,
		blocks: [
			...items.map((item) => ({ ...item, kind: 'chart' }) as SavedChart),
			...(texts ?? []).map(
				(text) => ({ ...text, kind: 'table' in text ? 'table' : 'text' }) as SavedType
			)
		]
	}));
}

export function chartsOf(saved: SavedPage): SavedChart[] {
	return saved.blocks.filter((block): block is SavedChart => block.kind === 'chart');
}

/** A page's texts and tables, in their order on it. */
export function typesetOf(saved: SavedPage): SavedType[] {
	return saved.blocks.filter((block): block is SavedType => block.kind !== 'chart');
}
