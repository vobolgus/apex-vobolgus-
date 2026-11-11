/**
 * A page as the store changes it: what it has room for, how a frame is fitted to it,
 * where a pasted copy goes, how its charts are put in the arranger's places and how
 * it remembers the way it was laid out. No state and no DOM: each is given the page
 * it reads or changes.
 */

import { MAX_ITEMS_PER_PAGE, MAX_TEXTS_PER_PAGE } from '$lib/api/wire/limits';
import type { PlacedChart } from './arrange';
import { blockBounds, chartsOf, typesetOf } from './blocks';
import {
	clampPosition,
	contentBox,
	fitFrame,
	GUTTER_MM,
	nearestFreePlace,
	overlaps,
	sameFrame
} from './geometry';
import type { LaidPage } from './templates';
import { fitTextFrame, normalizeRotation } from './text';
import type {
	BlockKind,
	ChartBlock,
	DocPage,
	PageLayout,
	PageOrientation,
	PageTemplate,
	Rect,
	TurnMemo,
	TypesetBlock
} from './types';

/** How far a copy pasted with no room and no pointer stands off what is in its place, mm down and right. */
const PASTE_OFFSET_MM = 5;

/** Whether `page` takes another block of `kind`: charts and type each have their limit. */
export function hasRoom(page: DocPage, kind: BlockKind): boolean {
	return kind === 'chart'
		? chartsOf(page).length < MAX_ITEMS_PER_PAGE
		: typesetOf(page).length < MAX_TEXTS_PER_PAGE;
}

/**
 * `frame` as `block` may have it on a page turned `o`: a chart's at its aspect inside
 * the content box (`fitFrame`), a text's or a table's at its turn (`fitTextFrame`).
 */
export function fittedFrame(
	block: Pick<ChartBlock, 'kind' | 'chart'> | Pick<TypesetBlock, 'kind' | 'rotation'>,
	frame: Rect,
	o: PageOrientation
): Rect {
	return block.kind === 'chart'
		? fitFrame(frame, block.chart.aspect, o)
		: fitTextFrame(frame, o, block.rotation);
}

/** Turn a text or a table to `degrees`; an upright one carries no `rotation`. */
export function setRotation(text: Pick<TypesetBlock, 'rotation'>, degrees: number) {
	const rotation = normalizeRotation(degrees);
	if (rotation === 0) delete text.rotation;
	else text.rotation = rotation;
}

/**
 * Where a pasted `frame` (turned `rotation`, already the size it will be) goes on
 * `page`: see `pasteBlock`. What it takes up on the page is what is placed.
 */
export function pastePlace(
	page: DocPage,
	frame: Rect,
	rotation: number,
	at: { x: number; y: number } | undefined
): Rect {
	const box = contentBox(page.orientation);
	const others = page.blocks.map(blockBounds);
	const bounds = blockBounds({ frame, rotation });
	const clear = !others.some((other) => overlaps(bounds, other, GUTTER_MM));
	let place = clear ? bounds : nearestFreePlace(bounds, others, page.orientation);
	if (!place && at) {
		// No room: over what is there, under the pointer.
		place = clampPosition({ ...bounds, x: at.x - bounds.w / 2, y: at.y - bounds.h / 2 }, box);
	}
	if (!place) {
		// And with no pointer, off whatever lies exactly where it was, so that it shows.
		place = bounds;
		const taken = (it: Rect) =>
			others.some((other) => Math.abs(other.x - it.x) < 0.5 && Math.abs(other.y - it.y) < 0.5);
		for (let i = 0; i < MAX_ITEMS_PER_PAGE && taken(place); i++) {
			const next = clampPosition(
				{ ...place, x: place.x + PASTE_OFFSET_MM, y: place.y + PASTE_OFFSET_MM },
				box
			);
			if (sameFrame(next, place)) break;
			place = next;
		}
	}
	return { ...frame, x: frame.x + place.x - bounds.x, y: frame.y + place.y - bounds.y };
}

/**
 * Put a page's charts in the arranger's order with its frames (copied), under the
 * type as ever; `added` is the chart Add brings (index −1). The charts keep their
 * identity.
 */
export function placeCharts(page: DocPage, plan: readonly PlacedChart[], added?: ChartBlock) {
	const charts = chartsOf(page);
	const placed = plan.map(({ index, frame }) => {
		const block = index < 0 ? added! : charts[index];
		block.frame = { ...frame };
		return block;
	});
	page.blocks = [...placed, ...typesetOf(page)];
}

/**
 * Set how a page was laid out. An absent field is the default (automatic, no
 * layout, no memo, no template), so a change that passes only `manual` forgets the
 * layout (its frames are no longer the arranger's), the turn memo, and the template
 * the page was laid out as (it is no longer what that made).
 */
export function setLayout(
	page: DocPage,
	{
		manual,
		layout,
		turnMemo,
		template
	}: { manual?: boolean; layout?: PageLayout; turnMemo?: TurnMemo; template?: PageTemplate }
) {
	if (manual) page.manual = true;
	else delete page.manual;
	if (layout) page.layout = layout;
	else delete page.layout;
	if (turnMemo) page.turnMemo = turnMemo;
	else delete page.turnMemo;
	if (template) page.template = { ...template };
	else delete page.template;
}

/**
 * Where a text is on its page once the page is turned from `from` to `to`: it keeps
 * its place in the content box, which is as far across and down it as before, and
 * its share of the width; turning back puts it where it was.
 */
export function turnedTextFrame(
	text: Pick<TypesetBlock, 'frame' | 'rotation'>,
	from: PageOrientation,
	to: PageOrientation
): Rect {
	const was = contentBox(from);
	const box = contentBox(to);
	const { x, y, w, h } = text.frame;
	return fitTextFrame(
		{
			x: box.x + ((x - was.x) * box.w) / was.w,
			y: box.y + ((y - was.y) * box.h) / was.h,
			w: (w * box.w) / was.w,
			h
		},
		to,
		text.rotation
	);
}

/** What `undo` of an Add compares: a page changed since the Add takes no undo. */
export function pageState(page: DocPage): string {
	const { orientation, manual, layout, turnMemo } = page;
	const items = chartsOf(page).map((it) => [it.id, it.frame]);
	return JSON.stringify([orientation, items, !!manual, layout ?? null, turnMemo ?? null]);
}

// === A page and its template ===

/** Whether a page's text says what a template's does: a table has no words of its own. */
function sameWords(
	a: Pick<TypesetBlock, 'kind'> & { text?: string },
	b: Pick<TypesetBlock, 'kind'> & { text?: string }
): boolean {
	return a.kind === b.kind && a.text === b.text;
}

/**
 * The pages a template makes of `page` (`layTemplate`), as the document holds them:
 * the first has the page's id, the rest ids from `newId`. A chart keeps what it had
 * (its thumbnail) in its new frame, with the marks the template gives it and no
 * others; one the template made gets an id, and the text that points at it by name
 * follows. The owner's own texts (no `role`) stay on the first page, before the
 * template's. `page` is plain data, and is left as it is.
 */
export function laidPages(
	page: DocPage,
	laid: readonly LaidPage[],
	newId: () => string
): DocPage[] {
	const made = laid.flatMap((part) => part.charts).filter((chart) => chart.chart !== undefined);
	const ids = made.map((chart) => ({ name: chart.id, id: newId() }));
	const idOf = (name: string | undefined) => ids.find((it) => it.name === name)?.id ?? name;
	const own = typesetOf(page).filter((text) => text.role === undefined);
	return laid.map((part, at): DocPage => {
		const id = at === 0 ? page.id : newId();
		const charts = part.charts.map((entry): ChartBlock => {
			const source = chartsOf(page).find((it) => it.id === entry.id);
			const chart = { ...(entry.chart ?? source!.chart) };
			if (entry.marks?.length) chart.marks = entry.marks.map((mark) => ({ ...mark }));
			else delete chart.marks;
			const block: ChartBlock = {
				...source,
				kind: 'chart',
				id: idOf(entry.id)!,
				chart,
				frame: fitFrame(entry.frame, chart.aspect, part.orientation)
			};
			if (entry.closeUpOf !== undefined) block.closeUpOf = entry.closeUpOf;
			return block;
		});
		const texts = [
			...(at === 0 ? structuredClone(own) : []),
			...part.texts.map((text) => {
				const added: TypesetBlock = { ...text, id: newId() };
				if (text.chartId !== undefined) added.chartId = idOf(text.chartId);
				return added;
			})
		]
			.slice(0, MAX_TEXTS_PER_PAGE)
			.map((text) => ({
				...text,
				frame: fitTextFrame(text.frame, part.orientation, text.rotation)
			}));
		const next: DocPage = { id, orientation: part.orientation, blocks: [...charts, ...texts] };
		// Arranged by the arranger while it holds charts alone; by hand with text among them.
		setLayout(
			next,
			texts.length > 0
				? { manual: true, template: part.template }
				: { layout: part.layout, template: part.template }
		);
		return next;
	});
}

/**
 * Which of a page's own blocks a layout of its template places (`layTemplate`,
 * `again`): its chart for each place, in the layout's order, and its text for each
 * text of the layout, by part and words, and by chart where the part belongs to one
 * (a caption, a key). Null when the layout is not this page and nothing else: a chart
 * to make or to drop, a chart or a text of the template not accounted for once.
 */
export function templateParts(
	page: DocPage,
	laid: LaidPage
): { charts: ChartBlock[]; texts: TypesetBlock[] } | null {
	const own = chartsOf(page);
	const roled = typesetOf(page).filter((text) => text.role !== undefined);
	const charts = laid.charts.map((placed) =>
		placed.chart ? undefined : own.find((block) => block.id === placed.id)
	);
	const texts = laid.texts.map((placed) =>
		roled.find(
			(text) =>
				text.role === placed.role &&
				sameWords(text, placed) &&
				(placed.chartId === undefined || text.chartId === placed.chartId)
		)
	);
	const each = (list: readonly unknown[]) => list.every((it, i) => list.indexOf(it) === i);
	const whole =
		!laid.dropped?.length &&
		charts.length === own.length &&
		texts.length === roled.length &&
		each(charts) &&
		each(texts);
	const found = <T>(list: (T | undefined)[]): list is T[] => list.every((it) => it !== undefined);
	return whole && found(charts) && found(texts) ? { charts, texts } : null;
}
