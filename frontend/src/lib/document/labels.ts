/** Words for counts of pages and charts, one spelling everywhere a page is named. */

/** "1 page", "3 pages", "0 charts". */
export function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A page's charts in its name: "no charts", "1 chart", "3 charts". */
export function chartCountLabel(count: number): string {
	return count === 0 ? 'no charts' : plural(count, 'chart');
}
