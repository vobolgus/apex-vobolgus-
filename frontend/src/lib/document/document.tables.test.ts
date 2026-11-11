// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { typesetOf } from './blocks';
import { DocumentStore } from './document.svelte';
import { clipboardCopy, DOCUMENT_STORAGE_KEY } from './storage';
import { memoryStorage, saved, specOf } from './test-support';
import { DEFAULT_TEXT_STYLE } from './text';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('DocumentStore: tables', () => {
	const style = { ...DEFAULT_TEXT_STYLE };
	const frame = { x: 12, y: 100, w: 186, h: 40 };

	it('keeps a table as a block that is not typed, and changes what it lists', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, {
			kind: 'table',
			style,
			frame,
			table: { source: 'messier', rows: 10 }
		})!;
		const table = () => typesetOf(doc.pages[0])[0];
		expect(table()).toMatchObject({ kind: 'table', table: { source: 'messier', rows: 10 } });
		expect(table()).not.toHaveProperty('text');
		// How it looks is kept with it; a look there is not is the look of names.
		doc.updateTypeset(pageId, id, { table: { source: 'messier', look: 'details', rows: 10 } });
		expect(specOf(table())).toEqual({ source: 'messier', look: 'details', rows: 10 });
		doc.updateTypeset(pageId, id, {
			table: { source: 'messier', look: 'fancy' as never, rows: 10 }
		});
		expect(specOf(table())!.look).toBe('names');
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 25 } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 25 });
		// Rows are whole and within the limits; a source there is not is not taken.
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 900 } });
		expect(specOf(table())!.rows).toBe(40);
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 0 } });
		expect(specOf(table())!.rows).toBe(1);
		doc.updateTypeset(pageId, id, { table: { source: 'comets' as never, rows: 5 } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 1 });
		// Its language is kept when it is Russian; English is none said.
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 5, language: 'ru' } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 5, language: 'ru' });
		doc.updateTypeset(pageId, id, { table: { source: 'stars', rows: 1, language: 'en' } });
		expect(specOf(table())).toEqual({ source: 'stars', look: 'names', rows: 1 });
		// A text does not become a table by being told a spec.
		const words = doc.addBlock(pageId, { kind: 'text', text: 'Hello', style, frame })!;
		doc.updateTypeset(pageId, words, { table: { source: 'stars', rows: 5 } });
		expect(typesetOf(doc.pages[0])[1]).not.toHaveProperty('table');
		// Nor is a table typed in by being told words.
		doc.updateTypeset(pageId, id, { text: 'Hello' });
		expect(table()).not.toHaveProperty('text');
	});

	it('saves a table, copies and pastes it, and reads back only what is a table', () => {
		const storage = memoryStorage();
		const doc = new DocumentStore(storage);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, {
			kind: 'table',
			style,
			frame,
			table: { source: 'stars', rows: 7 }
		})!;
		const copy = doc.copyBlock(id)!;
		expect(copy).toEqual({ kind: 'table', table: { source: 'stars', rows: 7 }, style, frame });
		// On the clipboard it is what a table always was there: a text of no words, with a spec.
		expect(clipboardCopy(copy)).toEqual({
			kind: 'text',
			text: '',
			style,
			frame,
			table: { source: 'stars', rows: 7 }
		});
		const turned = clipboardCopy({
			kind: 'table',
			table: { source: 'stars', rows: 7 },
			style,
			frame,
			rotation: 90
		});
		expect(turned).toMatchObject({ kind: 'text', text: '', rotation: 90 });
		expect(doc.pasteBlock(doc.addPage(), turned)).toMatchObject({ kind: 'table' });
		doc.removePage(doc.pages[1].id);
		const pasted = doc.pasteBlock(pageId, copy) as { kind: string; id: string };
		expect(pasted.kind).toBe('table');
		expect(specOf(typesetOf(doc.pages[0]).find((text) => text.id === pasted.id)!)).toEqual({
			source: 'stars',
			look: 'names',
			rows: 7
		});
		// A copy made when a table was a text with a spec and no words is still a table.
		const old = { kind: 'text', text: '', style, frame, table: { source: 'messier', rows: 4 } };
		const older = doc.pasteBlock(pageId, old) as { kind: string; id: string };
		expect(older.kind).toBe('table');
		expect(typesetOf(doc.pages[0]).find((text) => text.id === older.id)).toMatchObject({
			kind: 'table',
			table: { source: 'messier', look: 'names', rows: 4 }
		});
		doc.removeBlock(pageId, older.id);
		doc.flush();
		// Saved, a table is a text of no words that carries its spec.
		const raw = saved(storage);
		expect(raw.pages[0].texts![0]).toMatchObject({ text: '', table: { source: 'stars', rows: 7 } });
		expect(raw.pages[0].texts![0]).not.toHaveProperty('kind');
		// A spec that does not read as one leaves the text it was saved as; one that nearly
		// does is put right.
		(raw.pages[0].texts![0] as { table: unknown }).table = { source: 'comets', rows: 7 };
		(raw.pages[0].texts![1] as { table: unknown }).table = { source: 'messier', rows: 3.4 };
		storage.data.set(DOCUMENT_STORAGE_KEY, JSON.stringify(raw));
		const again = new DocumentStore(storage);
		again.load();
		expect(typesetOf(again.pages[0])).toHaveLength(2);
		expect(typesetOf(again.pages[0])[0]).toMatchObject({ kind: 'text', text: '' });
		expect(typesetOf(again.pages[0])[0]).not.toHaveProperty('table');
		expect(typesetOf(again.pages[0])[1]).not.toHaveProperty('text');
		expect(specOf(typesetOf(again.pages[0])[1])).toEqual({
			source: 'messier',
			look: 'names',
			rows: 3
		});
	});
});
