import { describe, expect, it } from 'vitest';
import { typesetOf } from '$lib/document/blocks';
import { DocumentStore } from '$lib/document/document.svelte';
import { layTemplate, TEMPLATES } from '$lib/document/templates';
import { chart } from '$lib/document/test-support';
import { TemplatePicking } from './pick.svelte';

const ANCHOR = { left: 10, top: 20, right: 110, bottom: 60 };
const template = (id: string) => TEMPLATES.find((info) => info.id === id)!;

describe('TemplatePicking', () => {
	it('holds the page being laid out while its picker is open, and while the page is there', () => {
		const store = new DocumentStore(null);
		const { pageId } = store.addChart(chart());
		const picking = new TemplatePicking(() => store);
		expect(picking.picking).toBeNull();
		expect(picking.page).toBeUndefined();

		picking.open(pageId, ANCHOR);
		expect(picking.picking).toEqual({ pageId, anchor: ANCHOR });
		expect(picking.page?.id).toBe(pageId);
		// The page deleted under the picker: there is nothing to lay out.
		store.removePage(pageId);
		expect(picking.page).toBeUndefined();

		picking.close();
		expect(picking.picking).toBeNull();
	});

	it('lays the page out as the choice, with the words to say of it and the way back', () => {
		const store = new DocumentStore(null);
		store.addPage();
		const { pageId } = store.addChart(chart(1.6));
		const picking = new TemplatePicking(() => store);
		const number = store.pageIndex(pageId) + 1;
		const caption = template('caption');

		const applied = picking.apply(pageId, caption, layTemplate('caption', store.page(pageId)!))!;
		expect(applied.message).toBe(`Page ${number} laid out as “${caption.name}”`);
		expect(applied.restored).toBe(`Page ${number} as it was`);
		expect(typesetOf(store.page(pageId)!).length).toBeGreaterThan(0);
		expect(applied.restore()).toBe(true);
		expect(typesetOf(store.page(pageId)!)).toEqual([]);
		// Once: there is nothing more to take back.
		expect(applied.restore()).toBe(false);
	});

	it('says on how many pages, and nothing when the document does not take the layout', () => {
		const store = new DocumentStore(null);
		const { pageId } = store.addChart(chart());
		store.addChart(chart());
		const picking = new TemplatePicking(() => store);
		const sheet = template('sheet');
		const laid = layTemplate('sheet', store.page(pageId)!);
		expect(laid.length).toBe(2);
		expect(picking.apply(pageId, sheet, laid)?.message).toBe(
			`Page 1 laid out as “${sheet.name}”, on 2 pages`
		);
		expect(store.pageCount).toBe(2);
		// A layout that does not account for the page's charts is not the page's.
		expect(picking.apply(pageId, sheet, laid)).toBeNull();
		expect(picking.apply('nowhere', sheet, laid)).toBeNull();
	});
});
