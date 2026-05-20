import { backendUrl } from '$lib/server/backend';
import { error, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, fetch }) => {
	const upstream = new URL(backendUrl('/api/catalog/full'));
	upstream.search = url.search;

	const response = await fetch(upstream);
	if (!response.ok) {
		throw error(response.status, 'Failed to load full catalog');
	}

	return new Response(await response.text(), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
};
