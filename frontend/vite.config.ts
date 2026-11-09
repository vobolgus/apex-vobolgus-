import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// In production the backend serves the page and `/api/*` from one origin. The dev
	// and preview servers stand in for that by forwarding `/api` to the backend.
	const env = loadEnv(mode, process.cwd(), '');
	const proxy = { '/api': env.BACKEND_URL || 'http://localhost:8080' };
	return {
		plugins: [sveltekit()],
		server: {
			allowedHosts: ['astro.vobolgus.com'],
			proxy
		},
		preview: { proxy }
	};
});
