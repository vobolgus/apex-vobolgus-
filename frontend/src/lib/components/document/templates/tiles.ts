/**
 * The template picker's tiles: each template as what it would make of the page,
 * with the page's own charts, and whether it can be chosen.
 */

import { chartsOf, typesetOf } from '$lib/document/blocks';
import { plural } from '$lib/document/labels';
import {
	layTemplate,
	TEMPLATES,
	type CloseUp,
	type LaidPage,
	type TemplateInfo,
	type TemplateLanguage
} from '$lib/document/templates';
import type { ChartBlock, DocPage, PageOrientation, TextStyle } from '$lib/document/types';

export interface Tile {
	info: TemplateInfo;
	laid: LaidPage[];
	/** The first page it makes, to draw. */
	preview: DocPage | null;
	/** Why it cannot be chosen, or null when it can. */
	blocked: string | null;
	note: string;
}

/** How the templates are laid out for the picker: as its controls under the tiles have them. */
export interface TileOptions {
	orientation: PageOrientation;
	swap: boolean;
	language: TemplateLanguage;
	/** How tall text set in `style` is at `width`, mm. */
	height: (text: string, style: TextStyle, width: number) => number;
	/** How many more pages the document can take. */
	room: number;
	/** The Messier catalogue could not be had: a finder card has nothing to choose from. */
	failed: boolean;
	/** The close-up a finder card is shown with, as an example: the sky's brightest object. */
	example: CloseUp | undefined;
}

/** A finder card of `page` with the close-up `closeUp`. */
export function layFinder(
	page: DocPage,
	options: Omit<TileOptions, 'room' | 'failed' | 'example'>,
	closeUp: CloseUp | undefined
): LaidPage[] {
	const { orientation, swap, height, language } = options;
	return layTemplate('finder', page, { orientation, swap, height, closeUp, language });
}

/** Every template as a tile for `page`. */
export function templateTiles(page: DocPage, options: TileOptions): Tile[] {
	const { orientation, swap, height, language, room, failed, example } = options;
	const charts = chartsOf(page).length;
	return TEMPLATES.map((info): Tile => {
		const finder = info.id === 'finder';
		const laid =
			charts < info.minCharts
				? []
				: finder
					? layFinder(page, options, example)
					: layTemplate(info.id, page, { orientation, swap, height, language });
		const blocked =
			charts < info.minCharts
				? `Needs ${plural(info.minCharts, 'chart')}`
				: laid.length - 1 > room
					? `No room for ${plural(laid.length, 'page')}`
					: finder && failed
						? 'No catalogue to choose from'
						: null;
		const pages = laid.length > 1 ? ` · ${laid.length} pages` : '';
		return {
			info,
			laid,
			preview: laid[0] ? previewOf(page, laid[0]) : null,
			blocked,
			note: blocked ?? `${info.note}${pages}`
		};
	});
}

/** A laid page as a page to draw: the page's own charts in their new frames, and the text. */
export function previewOf(page: DocPage, laid: LaidPage): DocPage {
	const own = chartsOf(page);
	const kept = typesetOf(page).filter((text) => text.role === undefined);
	const placed = laid.charts.flatMap(({ id: chartId, frame, chart, marks }): ChartBlock[] => {
		if (chart) return [{ kind: 'chart', id: chartId, chart, frame }];
		const item = own.find((it) => it.id === chartId);
		if (!item) return [];
		// Ringed where the template rings it, and nowhere else, as the page will be.
		const shown = { ...item.chart };
		if (marks?.length) shown.marks = marks;
		else delete shown.marks;
		return [{ ...item, chart: shown, frame }];
	});
	const texts = laid.texts.map((text, i) => ({ ...text, id: `preview-text-${i}` }));
	return {
		id: `${page.id}-preview`,
		orientation: laid.orientation,
		blocks: [...placed, ...kept, ...texts]
	};
}
