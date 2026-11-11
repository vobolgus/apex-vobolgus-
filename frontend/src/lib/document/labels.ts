/**
 * What the editor calls things, in English: counts of pages and charts, one
 * spelling everywhere a page is named, what a block is called aloud, what a table
 * lists and how, and the names
 * of the languages a page is written in. The words set on a page, in each of
 * those languages, are in `words/`.
 */

import { lookOf } from './table';
import type { BlockKind, Language, TableLook, TableSource, TableSpec } from './types';

/** "1 page", "3 pages", "0 charts". */
export function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A page's charts in its name: "no charts", "1 chart", "3 charts". */
export function chartCountLabel(count: number): string {
	return count === 0 ? 'no charts' : plural(count, 'chart');
}

/** What a block is called when the editor speaks of it: a table is a text there. */
export function spokenKind(kind: BlockKind): 'Chart' | 'Text' {
	return kind === 'chart' ? 'Chart' : 'Text';
}

/** Why page `number` took no block of `kind` moved to it by the keys. */
export function pageFullLabel(number: number, kind: BlockKind): string {
	return kind === 'chart' ? `Page ${number} is full` : `Page ${number} holds no more text`;
}

/** A language by its name in English, as its buttons are named: "Russian". */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', ru: 'Russian' };

/** What each source is called in the editor: a table's name, its toolbar. */
export const TABLE_SOURCE_NAMES: Record<TableSource, string> = {
	messier: 'Messier objects',
	stars: 'Stars'
};

export const TABLE_LOOK_NAMES: Record<TableLook, string> = {
	names: 'Names',
	details: 'Details'
};

/** What a table is called: "Messier objects, names, 5 rows". */
export function tableName(spec: TableSpec): string {
	const look = TABLE_LOOK_NAMES[lookOf(spec)].toLowerCase();
	return `${TABLE_SOURCE_NAMES[spec.source]}, ${look}, ${spec.rows} ${spec.rows === 1 ? 'row' : 'rows'}`;
}
