import { describe, expect, it } from 'vitest';
import { tableName } from './labels';

describe('tableName', () => {
	it('names a table by what it lists and how', () => {
		expect(tableName({ source: 'messier', rows: 10 })).toBe('Messier objects, names, 10 rows');
		expect(tableName({ source: 'stars', look: 'details', rows: 1 })).toBe('Stars, details, 1 row');
	});
});
