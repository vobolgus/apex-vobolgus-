import { describe, expect, it } from 'vitest';
import { chartsOf, typesetOf } from '$lib/document/blocks';
import { chart } from '$lib/document/test-support';
import { DEFAULT_TEXT_STYLE } from '$lib/document/text';
import type { ChartBlock, DocPage } from '$lib/document/types';
import { previewOf, templateTiles, type TileOptions } from './tiles';

const DISC: ChartBlock = {
	kind: 'chart',
	id: 'disc',
	chart: { ...chart(), marks: [{ raDeg: 1, decDeg: 2, radiusDeg: 3 }] },
	frame: { x: 12, y: 12, w: 90, h: 90 }
};
const FRAME: ChartBlock = {
	kind: 'chart',
	id: 'frame',
	chart: chart(1.6),
	frame: { x: 108, y: 12, w: 90, h: 56.25 }
};

function page(...charts: ChartBlock[]): DocPage {
	return {
		id: 'p1',
		orientation: 'portrait',
		blocks: [
			...charts,
			{
				kind: 'text',
				id: 'note',
				text: 'Kept as it is',
				style: DEFAULT_TEXT_STYLE,
				frame: { x: 12, y: 200, w: 80, h: 6 }
			}
		]
	};
}

const OPTIONS: TileOptions = {
	orientation: 'portrait',
	swap: false,
	language: 'en',
	height: () => 6,
	room: 10,
	failed: false,
	example: { name: 'M 42 · Orion Nebula', raDeg: 83.8, decDeg: -5.4, fovDeg: 20 }
};

function byId(tiles: ReturnType<typeof templateTiles>) {
	return Object.fromEntries(tiles.map((tile) => [tile.info.id, tile]));
}

describe('templateTiles', () => {
	it('offers every template, each with what it makes of the page drawn', () => {
		const tiles = templateTiles(page(DISC, FRAME), OPTIONS);
		expect(tiles.map((tile) => tile.info.id)).toEqual([
			'charts',
			'caption',
			'pair',
			'finder',
			'sheet'
		]);
		for (const tile of tiles) {
			expect(tile.blocked).toBeNull();
			expect(tile.preview?.orientation).toBe(tile.laid[0].orientation);
		}
	});

	it('says how many pages a template makes when it makes more than one', () => {
		const tiles = byId(templateTiles(page(DISC, FRAME), OPTIONS));
		expect(tiles.pair.note).toBe('Side by side');
		expect(tiles.caption.laid).toHaveLength(2);
		expect(tiles.caption.note).toBe('One to a page · 2 pages');
	});

	it('blocks a template the page has too few charts for, laying out nothing', () => {
		const tiles = byId(templateTiles(page(DISC), OPTIONS));
		expect(tiles.pair.blocked).toBe('Needs 2 charts');
		expect(tiles.pair.note).toBe('Needs 2 charts');
		expect(tiles.pair.laid).toEqual([]);
		expect(tiles.pair.preview).toBeNull();
	});

	it('blocks one that makes more pages than the document has room for', () => {
		const tiles = byId(templateTiles(page(DISC, FRAME), { ...OPTIONS, room: 0 }));
		expect(tiles.caption.blocked).toBe('No room for 2 pages');
		expect(tiles.charts.blocked).toBeNull();
	});

	it('blocks a finder card while there is no catalogue to choose its object from', () => {
		const tiles = byId(templateTiles(page(DISC), { ...OPTIONS, failed: true }));
		expect(tiles.finder.blocked).toBe('No catalogue to choose from');
		expect(tiles.finder.laid.length).toBeGreaterThan(0);
	});
});

describe('previewOf', () => {
	it('draws the page’s own charts in their new frames, its own text, and the template’s', () => {
		const source = page(DISC, FRAME);
		const [laid] = templateTiles(source, OPTIONS)[2].laid;
		const preview = previewOf(source, laid);
		expect(preview.id).toBe('p1-preview');
		const charts = chartsOf(preview);
		expect(charts.map((it) => it.id).sort()).toEqual(['disc', 'frame']);
		for (const placed of laid.charts) {
			expect(charts.find((it) => it.id === placed.id)?.frame).toEqual(placed.frame);
		}
		const texts = typesetOf(preview);
		expect(texts[0].id).toBe('note');
		expect(texts.slice(1).map((it) => it.id)).toEqual(
			laid.texts.map((_, i) => `preview-text-${i}`)
		);
	});

	it('rings a chart only where the template rings it', () => {
		const source = page(DISC);
		const [laid] = templateTiles(source, OPTIONS)[0].laid;
		const disc = chartsOf(previewOf(source, laid))[0];
		expect(disc.chart.marks).toBeUndefined();
		const ringed = previewOf(source, {
			...laid,
			charts: laid.charts.map((it) => ({ ...it, marks: [{ raDeg: 5, decDeg: 6, radiusDeg: 1 }] }))
		});
		expect(chartsOf(ringed)[0].chart.marks).toEqual([{ raDeg: 5, decDeg: 6, radiusDeg: 1 }]);
	});
});
