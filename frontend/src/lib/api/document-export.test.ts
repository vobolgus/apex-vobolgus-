import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDocument } from './document-export';
import type { DocumentRequest } from './wire/request';

/** A document of one bare A4 page, as it is posted. */
const REQUEST: DocumentRequest = {
	pages: [{ width_mm: 210, height_mm: 297, items: [], texts: [] }]
};

describe('exportDocument', () => {
	let created: string[];
	let revoked: string[];
	const originalCreate = URL.createObjectURL;
	const originalRevoke = URL.revokeObjectURL;

	beforeEach(() => {
		created = [];
		revoked = [];
		URL.createObjectURL = () => {
			const url = `blob:test/${created.length}`;
			created.push(url);
			return url;
		};
		URL.revokeObjectURL = (url: string) => {
			revoked.push(url);
		};
	});

	afterEach(() => {
		URL.createObjectURL = originalCreate;
		URL.revokeObjectURL = originalRevoke;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function okResponse(text = '<svg/>') {
		return { ok: true, status: 200, blob: async () => new Blob([text]), text: async () => text };
	}

	function mockFetch(
		respond: (url: string, init: RequestInit) => unknown = () => okResponse()
	): ReturnType<typeof vi.fn> {
		const fetchMock = vi.fn(async (url: string, init: RequestInit) => respond(url, init));
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('posts the document and downloads one PDF', async () => {
		const fetchMock = mockFetch();
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		await expect(exportDocument(() => REQUEST)).resolves.toEqual({ ok: true });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/export/document');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(JSON.parse(init.body as string)).toEqual(REQUEST);
		expect(click).toHaveBeenCalledTimes(1);
		const link = click.mock.contexts[0] as HTMLAnchorElement;
		expect(link.download).toMatch(/^skycharts-\d+\.pdf$/);
		expect(link.href).toBe(created[0]);
		expect(revoked).toEqual([created[0]]);
	});

	it('logs a failed export, downloads nothing and passes on why it was refused', async () => {
		mockFetch(() => ({ ok: false, status: 400, text: async () => 'too many pages' }));
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(exportDocument(() => REQUEST)).resolves.toEqual({
			ok: false,
			message: 'too many pages'
		});

		expect(click).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledTimes(1);
		expect(String(error.mock.calls[0][0])).toContain('400 too many pages');
	});

	it("reads the refusal out of the proxy's JSON error", async () => {
		const body = JSON.stringify({ message: 'a document needs 1 to 100 pages, got 101' });
		mockFetch(() => ({ ok: false, status: 400, text: async () => body }));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(exportDocument(() => REQUEST)).resolves.toEqual({
			ok: false,
			message: 'a document needs 1 to 100 pages, got 101'
		});
	});

	it('has no reason to give when the backend failed or is away', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockFetch(() => ({ ok: false, status: 500, text: async () => 'PDF conversion error' }));
		await expect(exportDocument(() => REQUEST)).resolves.toEqual({ ok: false, message: null });
		mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
		await expect(exportDocument(() => REQUEST)).resolves.toEqual({ ok: false, message: null });
	});

	it('does not call the backend for an empty document', async () => {
		const fetchMock = mockFetch();
		await expect(exportDocument(() => ({ pages: [] }))).resolves.toEqual({
			ok: false,
			message: null
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('waits for the request, and fails as an export does when it cannot be made', async () => {
		const fetchMock = mockFetch();
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		await expect(exportDocument(async () => REQUEST)).resolves.toEqual({ ok: true });
		expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual(REQUEST);
		expect(click).toHaveBeenCalledTimes(1);

		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failing = () => Promise.reject(new Error('no catalogue'));
		await expect(exportDocument(failing)).resolves.toEqual({ ok: false, message: null });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledTimes(1);
	});
});
