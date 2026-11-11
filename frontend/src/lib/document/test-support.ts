/** What the document's tests share: a chart to put on a page, and a storage to save to. */

import { expect } from 'vitest';
import { contentBox } from './geometry';
import { DOCUMENT_STORAGE_KEY } from './storage';
import type {
	ChartBlock,
	ChartSnapshot,
	DocPage,
	Rect,
	TableSpec,
	TextBlock,
	TypesetBlock
} from './types';

/** A disc at `aspect` 1, else a pinhole frame of that aspect. */
export function chart(aspect = 1): ChartSnapshot {
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
			ecliptic: true,
			galacticEquator: false,
			planets: false
		},
		aspect,
		createdAt: '2026-10-27T12:00:00.000Z'
	};
}

/** A storage in memory that counts its writes, and takes none longer than `limit`. */
export function memoryStorage(limit = Infinity) {
	const data = new Map<string, string>();
	const storage = {
		data,
		writes: 0,
		getItem: (key: string) => data.get(key) ?? null,
		removeItem: (key: string) => void data.delete(key),
		setItem(key: string, value: string) {
			storage.writes += 1;
			if (value.length > limit) throw new DOMException('Quota exceeded', 'QuotaExceededError');
			data.set(key, value);
		}
	};
	return storage;
}

/** A text as storage holds it; a table is one of no words that carries its spec. */
export type SavedText = Omit<TextBlock, 'kind'> & { table?: TableSpec };

/** A page as storage holds it: its charts in `items`, its texts and tables in `texts`. */
export interface SavedPage extends Omit<DocPage, 'blocks'> {
	items: Omit<ChartBlock, 'kind'>[];
	texts?: SavedText[];
}

/** The document as `storage` holds it. */
export function saved(storage: ReturnType<typeof memoryStorage>): { pages: SavedPage[] } {
	return JSON.parse(storage.data.get(DOCUMENT_STORAGE_KEY)!);
}

export function expectInside(frame: Rect, page: DocPage) {
	const box = contentBox(page.orientation);
	expect(frame.x).toBeGreaterThanOrEqual(box.x - 1e-9);
	expect(frame.y).toBeGreaterThanOrEqual(box.y - 1e-9);
	expect(frame.x + frame.w).toBeLessThanOrEqual(box.x + box.w + 1e-9);
	expect(frame.y + frame.h).toBeLessThanOrEqual(box.y + box.h + 1e-9);
}

/** What a text says, for a test to compare; a table has no words of its own. */
export function wordsOf(block: Pick<TypesetBlock, 'kind'> & { text?: string }): string | undefined {
	return block.kind === 'text' ? block.text : undefined;
}

/** What a table lists, for a test to compare; a text has no spec. */
export function specOf(
	block: Pick<TypesetBlock, 'kind'> & { table?: TableSpec }
): TableSpec | undefined {
	return block.kind === 'table' ? block.table : undefined;
}
