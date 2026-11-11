/**
 * Chart export.
 *
 * PNG is produced client-side straight from the canvas; SVG and PDF are
 * rendered by the backend from a RenderConfig of the current view.
 */

import type { RenderConfig } from './wire/request';

export type ExportFormat = 'PNG' | 'SVG' | 'PDF';

/** Trigger a browser download for `href` under `filename`. */
function downloadFile(href: string, filename: string) {
	const link = document.createElement('a');
	link.download = filename;
	link.href = href;
	link.click();
}

/** Whether a file was downloaded. */
export interface ExportResult {
	ok: boolean;
}

/**
 * Export the chart in `format`. `config` is only built for SVG and PDF. Errors
 * are logged rather than thrown; the result says whether a file was downloaded,
 * so the page can tell the user when one was not.
 */
export async function exportChart(
	canvas: HTMLCanvasElement | null,
	format: ExportFormat,
	config: () => RenderConfig
): Promise<ExportResult> {
	if (!canvas) return { ok: false };
	const extension = format.toLowerCase();

	try {
		if (format === 'PNG') {
			downloadFile(canvas.toDataURL('image/png'), `skychart-${Date.now()}.png`);
			return { ok: true };
		}
		const response = await fetch(`/api/export?format=${extension}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config())
		});
		if (!response.ok) throw new Error(`Export failed: ${response.status}`);
		const url = URL.createObjectURL(await response.blob());
		downloadFile(url, `skychart-${Date.now()}.${extension}`);
		URL.revokeObjectURL(url);
		return { ok: true };
	} catch (error) {
		console.error(error);
		return { ok: false };
	}
}
