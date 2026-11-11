/**
 * Words for counts of pages and charts, one spelling everywhere a page is named,
 * and the names of the languages a template or a table writes in.
 */

import type { TemplateLanguage } from './templates';

/** "1 page", "3 pages", "0 charts". */
export function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A page's charts in its name: "no charts", "1 chart", "3 charts". */
export function chartCountLabel(count: number): string {
	return count === 0 ? 'no charts' : plural(count, 'chart');
}

/** A language by its name in English, as its buttons are named: "Russian". */
export const LANGUAGE_NAMES: Record<TemplateLanguage, string> = { en: 'English', ru: 'Russian' };
