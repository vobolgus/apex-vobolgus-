import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessierEntry } from '$lib/api/wire/payload';
import { documentRequest } from '$lib/document/render';
import { chart } from '$lib/document/test-support';
import { DEFAULT_TEXT_STYLE } from '$lib/document/text';
import type { DocPage, TableSource } from '$lib/document/types';
import { measureText } from '$lib/renderer/text-measure.svelte';
import { catalog } from '$lib/state/catalog.svelte';
import { typesetRequest } from './typeset.svelte';

const loadMessier = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock('$lib/api/catalog', () => ({ loadMessier }));

const PLEIADES: MessierEntry = {
	m: 45,
	name: 'Pleiades',
	kind: 'Open Cluster',
	constellation: 'Tau',
	mag: 1.6,
	ra_deg: 0,
	dec_deg: 0
};

const style = { ...DEFAULT_TEXT_STYLE };

/** A sky that takes in all but its far point, with words under it and a table of `source`. */
function pageWith(source: TableSource | null): DocPage {
	const sky = chart();
	const page: DocPage = {
		id: 'p',
		orientation: 'portrait',
		blocks: [
			{
				kind: 'chart',
				id: 'a',
				chart: { ...sky, view: { ...sky.view, stereoFovDeg: 350 } },
				frame: { x: 30, y: 30, w: 150, h: 150 }
			},
			{
				kind: 'text',
				id: 't',
				text: 'Field {fov}, and words enough to wrap onto a second line of it',
				style,
				frame: { x: 12, y: 200, w: 60, h: 6 }
			}
		]
	};
	if (source) {
		page.blocks.push({
			kind: 'table',
			id: 'l',
			table: { source, rows: 5 },
			style,
			frame: { x: 100, y: 200, w: 90, h: 20 }
		});
	}
	return page;
}

afterEach(() => {
	catalog.messier = [];
	vi.clearAllMocks();
});

describe('typesetRequest', () => {
	it("is the document's request, set with the faces' measure and the catalogues as they are", async () => {
		const pages = [pageWith(null), pageWith('stars')].map((page, i) => ({ ...page, id: `p${i}` }));
		const request = await typesetRequest(pages);
		expect(request).toEqual(
			documentRequest(pages, measureText, { messier: catalog.messier, stars: catalog.stars })
		);
		expect(request.pages[0].texts![0].lines.length).toBeGreaterThan(1);
		// Neither a text nor a table of stars needs the Messier catalogue.
		expect(loadMessier).not.toHaveBeenCalled();
	});

	it('has the Messier catalogue before a table that lists it is set', async () => {
		loadMessier.mockImplementation(async () => {
			catalog.messier = [PLEIADES];
			return true;
		});
		const pages = [pageWith('messier')];
		const request = await typesetRequest(pages);
		expect(loadMessier).toHaveBeenCalledTimes(1);
		expect(request).toEqual(
			documentRequest(pages, measureText, { messier: [PLEIADES], stars: catalog.stars })
		);
		expect(request.pages[0].texts![1].lines.map((line) => line.text)).toContain('M 45');
	});
});
