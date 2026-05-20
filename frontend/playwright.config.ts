import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression safety net for the generator page.
 *
 * Expects the Vite dev server to be already running on port 5174 (and the
 * Rust backend on 8080). We intentionally do NOT auto-start `webServer`
 * because both services are usually managed externally during development.
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: 'list',
	outputDir: 'e2e-results/',
	expect: {
		toHaveScreenshot: {
			maxDiffPixelRatio: 0.001
		}
	},
	use: {
		baseURL: 'http://localhost:5174',
		headless: true,
		viewport: { width: 1280, height: 800 },
		trace: 'retain-on-failure'
	},
	webServer: undefined,
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
