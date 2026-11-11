import { describe, expect, it } from 'vitest';
import { pageFullLabel, spokenKind, tableName } from './labels';

describe('tableName', () => {
	it('names a table by what it lists and how', () => {
		expect(tableName({ source: 'messier', rows: 10 })).toBe('Messier objects, names, 10 rows');
		expect(tableName({ source: 'stars', look: 'details', rows: 1 })).toBe('Stars, details, 1 row');
	});
});

describe('spokenKind', () => {
	it('calls a chart a chart, and a text and a table both a text', () => {
		expect(spokenKind('chart')).toBe('Chart');
		expect(spokenKind('text')).toBe('Text');
		expect(spokenKind('table')).toBe('Text');
	});

	it('says why a page took no more of a kind', () => {
		expect(pageFullLabel(2, 'chart')).toBe('Page 2 is full');
		expect(pageFullLabel(3, 'text')).toBe('Page 3 holds no more text');
		expect(pageFullLabel(3, 'table')).toBe('Page 3 holds no more text');
	});
});
