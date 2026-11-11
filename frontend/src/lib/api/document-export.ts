/**
 * The document's export: the whole of it posted to the backend, and the PDF that
 * comes back downloaded. What is posted is the caller's to make (`documentRequest`
 * of `$lib/document/render`, with the measure and the catalogues of the moment).
 */

import { downloadFile } from './export';
import type { DocumentRequest } from './wire/request';

/** How a document export went; `message` is the backend's reason for refusing it. */
export type DocumentExportResult = { ok: true } | { ok: false; message: string | null };

/**
 * Download the whole document as one PDF. `request` is asked for inside, so that
 * what it waits for (the fonts, a catalogue) fails as the export does. Errors are
 * logged rather than thrown, as `exportChart` does; the result says whether a file
 * was downloaded and, when the backend refused the document (a 400, which trying
 * again will not change), why. A document of no pages is not sent.
 */
export async function exportDocument(
	request: () => DocumentRequest | Promise<DocumentRequest>
): Promise<DocumentExportResult> {
	let message: string | null = null;
	try {
		const body = await request();
		if (body.pages.length === 0) return { ok: false, message: null };
		const response = await fetch('/api/export/document', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			const text = await response.text();
			// A 400 says what is wrong with the document, a 429 how long to wait.
			if (response.status === 400 || response.status === 429) message = refusal(text);
			throw new Error(`Document export failed: ${response.status} ${text}`);
		}
		const url = URL.createObjectURL(await response.blob());
		downloadFile(url, `skycharts-${Date.now()}.pdf`);
		URL.revokeObjectURL(url);
		return { ok: true };
	} catch (error) {
		console.error(error);
		return { ok: false, message };
	}
}

/** The backend's plain-text reason, which the proxy wraps as `{ "message": … }`. */
function refusal(body: string): string | null {
	let text = body;
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
			text = String(parsed.message);
		}
	} catch {
		// Plain text already.
	}
	text = text.trim();
	return text === '' ? null : text;
}
