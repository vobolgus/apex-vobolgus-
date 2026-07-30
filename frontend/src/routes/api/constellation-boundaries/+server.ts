import { backendUrl } from '$lib/server/backend';
import { error, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ fetch }) => {
	const response = await fetch(backendUrl('/api/constellation-boundaries'));
	if (!response.ok) {
		throw error(response.status, 'Failed to load constellation boundaries');
	}

	return new Response(await response.text(), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
};
