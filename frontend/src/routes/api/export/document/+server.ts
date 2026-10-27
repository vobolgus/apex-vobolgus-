import { backendUrl } from '$lib/server/backend';
import { error, type RequestHandler } from '@sveltejs/kit';

/**
 * The document's multi-page PDF: the pages go to the backend as they are, and the
 * file is streamed back rather than held here whole (it may run to a hundred MB).
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	const response = await fetch(backendUrl('/api/export/document'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: await request.text()
	});

	if (!response.ok) {
		const message = await response.text();
		throw error(response.status, message || 'Export failed');
	}

	return new Response(response.body, {
		status: 200,
		headers: {
			'content-type': response.headers.get('content-type') ?? 'application/pdf',
			'content-disposition':
				response.headers.get('content-disposition') ?? 'attachment; filename="skycharts.pdf"'
		}
	});
};
