// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartsOf, typesetOf } from './blocks';
import { DocumentStore } from './document.svelte';
import { MAX_ITEMS_PER_PAGE, MAX_TEXTS_PER_PAGE } from '$lib/api/wire/limits';
import { chart } from './test-support';
import { DEFAULT_TEXT_STYLE } from './text';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('DocumentStore: copy and paste', () => {
	const style = { ...DEFAULT_TEXT_STYLE };

	it('pastes a copied chart where it was when that is free, else clear of everything', () => {
		const doc = new DocumentStore(null);
		const first = doc.addPage();
		const second = doc.addPage();
		doc.addChart(chart());
		const [page, other] = doc.pages;
		expect(page.id).toBe(first);
		doc.setFrame(first, chartsOf(page)[0].id, { x: 12, y: 12, w: 90, h: 90 });
		const copy = doc.copyBlock(chartsOf(page)[0].id)!;
		expect(copy).toEqual({ kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 90, h: 90 } });

		// On another page its place is free.
		const there = doc.pasteBlock(second, copy);
		expect(there).toMatchObject({ kind: 'chart' });
		expect(chartsOf(other)).toHaveLength(1);
		expect(chartsOf(other)[0].frame).toEqual({ x: 12, y: 12, w: 90, h: 90 });
		expect(chartsOf(other)[0].id).not.toBe(chartsOf(page)[0].id);
		expect(other.manual).toBe(true);

		// On its own page the original is in it: the copy goes in the nearest free place, under
		// it and a gutter clear (as near as the place beside it, and lower wins).
		const here = doc.pasteBlock(first, copy) as { id: string };
		expect(chartsOf(page)).toHaveLength(2);
		const pasted = chartsOf(page).find((it) => it.id === here.id)!;
		expect(pasted.frame).toEqual({ x: 12, y: 108, w: 90, h: 90 });
		expect(doc.chartCount).toBe(3);
		// The copy is its own chart: changing one leaves the other.
		expect(pasted.chart).not.toBe(chartsOf(page)[0].chart);
	});

	it('pastes a copied text a little off the one in its place, turn and style kept', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const id = doc.addBlock(pageId, {
			kind: 'text',
			text: 'Key {lat}',
			style: { ...style, bold: true },
			frame: { x: 40, y: 100, w: 100, h: 6 },
			rotation: 180,
			chartId: 'chart-a'
		})!;
		const copy = doc.copyBlock(id)!;
		expect(copy).toEqual({
			kind: 'text',
			text: 'Key {lat}',
			style: { ...style, bold: true },
			frame: { x: 40, y: 100, w: 100, h: 6 },
			rotation: 180
		});
		const first = doc.pasteBlock(pageId, copy) as { id: string };
		const second = doc.pasteBlock(pageId, copy) as { id: string };
		const texts = typesetOf(doc.pages[0]);
		expect(texts.map((it) => it.id)).toEqual([id, first.id, second.id]);
		// Each in the free place nearest to the original: under it, then over it.
		expect(texts.map((it) => [it.frame.x, it.frame.y])).toEqual([
			[40, 100],
			[40, 112],
			[40, 88]
		]);
		expect(texts[1]).toMatchObject({ text: 'Key {lat}', rotation: 180, style: { bold: true } });
		// It reads the chart nearest to where it lands, not the one its original was told.
		expect(texts[1]).not.toHaveProperty('chartId');
		// An upright copy carries no turn.
		const plain = doc.copyBlock(
			doc.addBlock(pageId, { kind: 'text', text: 'x', style, frame: copy.frame })!
		)!;
		expect(plain).not.toHaveProperty('rotation');
	});

	it('keeps the size of a copy; with no room it goes over what is there, under the pointer', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const big = { kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 186, h: 186 } };
		expect(doc.pasteBlock(pageId, big)).toMatchObject({ kind: 'chart' });
		const [page] = doc.pages;
		// 81 mm are left under it: no place for another 186 mm disc, which is not made smaller.
		doc.pasteBlock(pageId, big, { x: 150, y: 250 });
		expect(chartsOf(page)[1].frame).toEqual({ x: 12, y: 99, w: 186, h: 186 });
		// In the middle of the page it is centred on the pointer.
		const small = { kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 60, h: 60 } };
		for (const it of chartsOf(page)) it.frame = { x: 12, y: 12, w: 186, h: 273 };
		doc.pasteBlock(pageId, small, { x: 100, y: 150 });
		expect(chartsOf(page)[2].frame).toEqual({ x: 70, y: 120, w: 60, h: 60 });
		// With no pointer over the page it stands off what is exactly in its place.
		doc.pasteBlock(pageId, small);
		expect(chartsOf(page)[3].frame).toEqual({ x: 17, y: 17, w: 60, h: 60 });

		// A text likewise: at its own width, its middle under the pointer.
		const words = { kind: 'text', text: 'x', style, frame: { x: 12, y: 12, w: 80, h: 6 } };
		doc.pasteBlock(pageId, words, { x: 105, y: 200 });
		expect(typesetOf(page)[0].frame).toEqual({ x: 65, y: 197, w: 80, h: 6 });
		// A copy from a larger page is only as much smaller as this page makes it.
		const wide = { kind: 'text', text: 'x', style, frame: { x: 12, y: 12, w: 273, h: 6 } };
		const other = doc.addPage();
		doc.pasteBlock(other, wide);
		expect(typesetOf(doc.pages[1])[0].frame).toEqual({ x: 12, y: 12, w: 186, h: 6 });
	});

	it('pastes nothing past the limits, and nothing that is no copy', () => {
		const doc = new DocumentStore(null);
		const pageId = doc.addPage();
		const text = { kind: 'text', text: 'x', style, frame: { x: 12, y: 12, w: 80, h: 6 } };
		for (let i = 0; i < MAX_TEXTS_PER_PAGE; i++)
			expect(doc.pasteBlock(pageId, text)).not.toBe('full');
		expect(doc.pasteBlock(pageId, text)).toBe('full');
		const item = { kind: 'chart', chart: chart(), frame: { x: 12, y: 12, w: 40, h: 40 } };
		expect(doc.pasteBlock(pageId, item)).toMatchObject({ kind: 'chart' });
		// The page filled by hand: finding fifty free places is not what is tested here.
		for (let i = 1; i < MAX_ITEMS_PER_PAGE; i++) {
			doc.pages[0].blocks.push({
				kind: 'chart',
				id: `filler-${i}`,
				chart: chart(),
				frame: item.frame
			});
		}
		expect(doc.pasteBlock(pageId, item)).toBe('full');

		for (const bad of [
			null,
			'text',
			{ kind: 'table', frame: text.frame },
			{ ...text, frame: null },
			{ ...text, style: { ...style, font: 'comic' } },
			{ ...text, text: 7 },
			{ ...item, chart: { view: {} } }
		]) {
			expect(doc.pasteBlock(doc.addPage(), bad), JSON.stringify(bad)).toBeNull();
		}
		expect(doc.pasteBlock('nowhere', text)).toBeNull();
		expect(doc.copyBlock('gone')).toBeNull();
	});
});
