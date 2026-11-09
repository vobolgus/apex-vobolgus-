import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// The page is one prerendered HTML file plus hashed assets: the backend serves
		// `build/` itself (backend/src/static_site.rs), so there is no Node server to run.
		// `precompress` writes a .br and a .gz next to every file, which the backend
		// sends as they are; `404.html` is what it answers for a path that is no file.
		adapter: adapter({ fallback: '404.html', precompress: true })
	}
};

export default config;
