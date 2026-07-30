/**
 * Chart export.
 *
 * PNG is produced client-side straight from the canvas; SVG and PDF are
 * rendered by the backend, which needs the current projection and layer state.
 */

export type ExportFormat = 'PNG' | 'SVG' | 'PDF';

export interface ExportLayers {
	planets: boolean;
	equator: boolean;
	ecliptic: boolean;
	galacticEquator: boolean;
}

export interface ExportRequest {
	format: ExportFormat;
	projection: string;
	layers: ExportLayers;
}

/** Trigger a browser download for `href` under `filename`. */
function downloadFile(href: string, filename: string) {
	const link = document.createElement('a');
	link.download = filename;
	link.href = href;
	link.click();
}

/**
 * Export the chart in `format`. Errors are logged rather than thrown: the call
 * sites are click handlers with nothing useful to do with a rejection.
 */
export async function exportChart(
	canvas: HTMLCanvasElement | null,
	{ format, projection, layers }: ExportRequest
): Promise<void> {
	if (!canvas) return;
	const extension = format.toLowerCase();

	if (format === 'PNG') {
		downloadFile(canvas.toDataURL('image/png'), `skychart-${Date.now()}.png`);
		return;
	}

	try {
		const response = await fetch('/api/export', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				format: extension,
				projection,
				layers: {
					planets: layers.planets,
					equator: layers.equator,
					ecliptic: layers.ecliptic,
					galactic_equator: layers.galacticEquator
				}
			})
		});
		if (!response.ok) throw new Error(`Export failed: ${response.status}`);
		const url = URL.createObjectURL(await response.blob());
		downloadFile(url, `skychart-${Date.now()}.${extension}`);
		URL.revokeObjectURL(url);
	} catch (error) {
		console.error(error);
	}
}
