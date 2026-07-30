import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

/**
 * Flat ESLint config for the SvelteKit frontend (Svelte 5 runes + TypeScript).
 *
 * `eslint-config-prettier` and `svelte.configs.prettier` come last so that
 * formatting is owned by Prettier alone and never double-reported here.
 */
export default ts.config(
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'dist/',
			'node_modules/',
			'e2e-results/',
			'playwright-report/',
			'static/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// TypeScript already reports genuinely undefined identifiers, and the
			// base rule cannot see type-only globals.
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// The app links with plain `href="/route"`; adopting `resolve()` everywhere
			// is a separate decision, not something the linter should force here.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// Playwright glue pokes at intercepted request bodies; typing those is noise.
		files: ['e2e/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
