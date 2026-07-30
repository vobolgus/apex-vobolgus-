import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		allowedHosts: ['astro.vobolgus.com']
	},
	optimizeDeps: {
		include: ['moveable']
	}
});
