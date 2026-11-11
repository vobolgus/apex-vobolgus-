import type { Page } from '@playwright/test';

/**
 * The document as the browser keeps it, for the specs to seed and to read back.
 *
 * It is saved as it always was (`src/lib/document/storage.ts`): a page's charts in
 * `items`, its texts in `texts`, a table a text with a spec and no words.
 */

export const STORAGE_KEY = 'skycharts.document.v1';

export interface Frame {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SavedChart {
	id: string;
	frame: Frame;
	chart: { marks?: unknown[]; view: { projection: string; pinholeFovDeg: number } };
	closeUpOf?: string;
}

export interface SavedText {
	id: string;
	frame: Frame;
	style: { font: string; size: number; bold: boolean; italic: boolean; align: string };
	/** What it says; a table says nothing. */
	text: string;
	/** A table's spec; a text has none. */
	table?: { source: string; look?: string; rows: number; language?: string };
	role?: string;
	chartId?: string;
	rotation?: number;
}

export interface SavedPage {
	id: string;
	orientation: string;
	manual?: boolean;
	template?: { id: string; language: string };
	items: SavedChart[];
	/** Absent on a page with no text. */
	texts?: SavedText[];
}

/** Put `document` in storage and load the app with it. */
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

/** The saved pages (saves are debounced: poll this). */
export async function savedPages(page: Page): Promise<SavedPage[]> {
	return page.evaluate((key) => {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw).pages : [];
	}, STORAGE_KEY);
}

/** The keys the browser keeps anything under. */
export async function storageKeys(page: Page): Promise<string[]> {
	return page.evaluate(() => Object.keys(localStorage));
}

export function chartsOf(saved: SavedPage): SavedChart[] {
	return saved.items;
}

/** A page's texts and tables, in their order on it. */
export function typesetOf(saved: SavedPage): SavedText[] {
	return saved.texts ?? [];
}
