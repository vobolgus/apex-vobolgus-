import { backendUrl } from '$lib/server/backend';
import { error, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const format = url.searchParams.get('format');
	const upstreamPath = format === 'svg' ? '/api/export?format=svg' : '/api/export';
	const response = await fetch(backendUrl(upstreamPath), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: await request.text()
	});

	if (!response.ok) {
		const message = await response.text();
		throw error(response.status, message || 'Export failed');
	}

	if (format === 'svg') {
		return new Response(await response.text(), {
			status: 200,
			headers: {
				'content-type': response.headers.get('content-type') ?? 'image/svg+xml; charset=utf-8'
			}
		});
	}

	return new Response(await response.arrayBuffer(), {
		status: 200,
		headers: {
			'content-type': response.headers.get('content-type') ?? 'application/pdf',
			'content-disposition': response.headers.get('content-disposition') ?? 'attachment; filename="sky_chart.pdf"'
		}
	});
};
