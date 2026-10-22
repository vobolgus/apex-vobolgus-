import { redirect, type RequestHandler } from '@sveltejs/kit';

// The generator used to live at /generator and is now the app's only page, at /.
// Keep old links and bookmarks working with a permanent redirect.
export const GET: RequestHandler = () => {
	throw redirect(308, '/');
};
