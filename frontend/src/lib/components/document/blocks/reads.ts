/**
 * Which chart a text or a table reads, as the editor shows it: the Reads row under
 * its toolbar, and the numbers on its page's charts while it is selected.
 *
 * A block reads the chart nearest to it unless it was told one (`chartId`), on its
 * page or on another (`boundChartBlock`). Which one is a question only for words that read
 * a chart (a table's, a text's with fields), and only with a choice to make: two
 * charts on its page, or charts on other pages.
 */

import { chartsOf } from '$lib/document/blocks';
import { boundChartBlock, hasFields } from '$lib/document/text';
import type { DocPage, TypesetBlock } from '$lib/document/types';

/** A chart on another page, to read: its id, and what to call it. */
interface ChartChoice {
	id: string;
	/** "Page 2 · chart 1". */
	label: string;
}

/** What a block reads, told apart as its Reads row tells it. */
interface Reading {
	/** 0-based position on its page of the chart it reads, null when that is not on its page. */
	at: number | null;
	/** It was told a chart of its page; else it reads that one for being the nearest. */
	pinned: boolean;
	/** The id of the chart on another page it reads, null when it reads none there. */
	other: string | null;
}

/** The charts on the pages other than `page`, in the document's order. */
export function otherCharts(page: DocPage, pages: readonly DocPage[]): ChartChoice[] {
	return pages.flatMap((sheet, at) =>
		sheet.id === page.id
			? []
			: chartsOf(sheet).map((chart, i) => ({
					id: chart.id,
					label: `Page ${at + 1} · chart ${i + 1}`
				}))
	);
}

/** Whether what a block says reads a chart: a table's rows always do, a text's words with fields. */
export function readsAChart(block: TypesetBlock, words: string): boolean {
	return block.kind === 'table' || hasFields(words);
}

/** What the block on `page` reads, against the charts of the other pages (`others`). */
export function readingOf(
	page: DocPage,
	block: TypesetBlock,
	pages: readonly DocPage[],
	others: readonly ChartChoice[]
): Reading {
	const charts = chartsOf(page);
	const id = boundChartBlock(page, block, pages)?.id;
	const at = charts.findIndex((chart) => chart.id === id);
	return {
		at: at < 0 ? null : at,
		pinned: charts.some((chart) => chart.id === block.chartId),
		other: id !== undefined && others.some((other) => other.id === id) ? id : null
	};
}

/**
 * The chart on `page` that the selected block reads, while that is a question: the
 * page has two charts or more, and the block's words read one, or it is being typed
 * in (`editingId`) and may come to. The charts then show their numbers, this one
 * marked. Null otherwise, and with no block selected.
 */
export function linkedChartId(
	page: DocPage,
	pages: readonly DocPage[],
	selected: TypesetBlock | undefined,
	editingId: string | null
): string | null {
	if (!selected || chartsOf(page).length < 2) return null;
	const words = selected.kind === 'text' ? selected.text : '';
	if (!readsAChart(selected, words) && editingId !== selected.id) return null;
	return boundChartBlock(page, selected, pages)?.id ?? null;
}
