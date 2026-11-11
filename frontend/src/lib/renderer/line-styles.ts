/**
 * How the chart's lines are stroked: the reference circles and the constellations.
 * Data only, apart from the drawing (`reference-lines.ts`), so that what asks the
 * backend for the same colours (`$lib/api/render-config`) reads them without it.
 */

export interface DashPattern {
	dashDeg: number;
	gapDeg: number;
}

export interface ReferenceLineStyle {
	strokeStyle: string;
	lineWidth: number;
	alpha: number;
	dashPattern?: DashPattern;
}

export const REFERENCE_LINE_STYLES: {
	equator: ReferenceLineStyle;
	ecliptic: ReferenceLineStyle;
	galacticEquator: ReferenceLineStyle;
} = {
	equator: {
		strokeStyle: '#000000',
		lineWidth: 1,
		alpha: 1
	},
	ecliptic: {
		strokeStyle: '#dc2626',
		lineWidth: 1,
		alpha: 0.95
	},
	galacticEquator: {
		strokeStyle: '#b58cff',
		lineWidth: 1,
		alpha: 0.9
	}
};

export const CONSTELLATION_LINE_STYLE: ReferenceLineStyle = {
	strokeStyle: '#000000',
	lineWidth: 0.6,
	alpha: 0.35
};

export const CONSTELLATION_BOUNDARY_STYLE: ReferenceLineStyle = {
	strokeStyle: '#000000',
	lineWidth: 0.4,
	alpha: 0.15
};
