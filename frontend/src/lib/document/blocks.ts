/**
 * The blocks of a page, read: which are charts, which are set in type, where one
 * is, what it takes up. Pure functions, no DOM.
 *
 * A page holds one list, in the order it is drawn: the charts first, the texts and
 * tables over them. The arranger lays out charts and a text reads one, so each asks
 * for its own kind here (`chartsOf`, `typesetOf`); a chart's index, to the arranger
 * and in a page's layout, is its place among the charts.
 */

import { rotatedBounds } from './geometry';
import type { ChartBlock, DocBlock, DocPage, Rect, TypesetBlock } from './types';

type Blocks = Pick<DocPage, 'blocks'>;

export function isChart(block: DocBlock): block is ChartBlock {
	return block.kind === 'chart';
}

function isTypeset(block: DocBlock): block is TypesetBlock {
	return block.kind !== 'chart';
}

/** The charts of a page, in their order on it. */
export function chartsOf(page: Blocks): ChartBlock[] {
	return page.blocks.filter(isChart);
}

/** The texts and tables of a page, in their order on it. */
export function typesetOf(page: Blocks): TypesetBlock[] {
	return page.blocks.filter(isTypeset);
}

/** Whether a page holds nothing at all: no chart and no text. */
export function isBlank(page: Blocks): boolean {
	return page.blocks.length === 0;
}

/** The block `id` and the page it is on; null when no page has it. */
export function findBlock<P extends Blocks>(
	pages: readonly P[],
	id: string
): { page: P; block: DocBlock } | null {
	for (const page of pages) {
		const block = page.blocks.find((it) => it.id === id);
		if (block) return { page, block };
	}
	return null;
}

/** What a block takes up on its page: its frame, or the upright box around it when turned. */
export function blockBounds(block: Pick<DocBlock, 'frame'> & { rotation?: number }): Rect {
	return rotatedBounds(block.frame, block.rotation);
}

/** A block's place among those of its layer: a chart's among the charts, a text's among the type. */
export function layerIndex(page: Blocks, id: string): number {
	const block = page.blocks.find((it) => it.id === id);
	if (!block) return -1;
	const layer: DocBlock[] = isChart(block) ? chartsOf(page) : typesetOf(page);
	return layer.indexOf(block);
}

/**
 * Put `block` on `page`, in its layer: a chart under the type, a text or a table over
 * the charts. `at` is its place among those of its layer (`layerIndex`); on top of
 * them when absent or past their end.
 */
export function insertBlock(page: Blocks, block: DocBlock, at = Infinity): void {
	const charts = chartsOf(page).length;
	const [from, to] = isChart(block) ? [0, charts] : [charts, page.blocks.length];
	page.blocks.splice(Math.min(from + at, to), 0, block);
}

/** `blocks` in the order a page keeps them: the charts first, each kind in the order it came. */
export function layered(blocks: readonly DocBlock[]): DocBlock[] {
	return [...blocks.filter(isChart), ...blocks.filter(isTypeset)];
}
