/**
 * Add to PDF, and the chart's flight to its page (whose geometry and timing are
 * `flight.ts`'s).
 *
 * A frozen copy of the chart goes where it fits in the document (a new page if
 * nowhere; the charts on its page may move to make room), with a thumbnail of the
 * preview to show until its vector preview loads. The pages panel opens on that
 * page and flashes it; the toast offers to take the Add back. Meanwhile a copy of
 * the chart, drawn as the thumbnail draws it, flies there from the preview (`fly`,
 * the action of the copy's element) and lands (`land`): the thumbnail draws the
 * chart, then the copy goes.
 */

import { tick } from 'svelte';
import type { ChartLayers, ChartView } from '$lib/document/types';
import { MAX_CHARTS, MAX_PAGES } from '$lib/api/wire/limits';
import type { DocumentStore } from '$lib/document/document.svelte';
import { snapshotChart } from '$lib/document/render';
import type { ChartSnapshot } from '$lib/document/types';
import { chartThumbnail, drawChartThumbnail } from '$lib/renderer/chart-thumbnail';
import { catalog } from '$lib/state/catalog.svelte';
import { prefersReducedMotion } from '$lib/ui/motion';
import {
	chartBoxOnScreen,
	FLIGHT_FADE,
	flightEdgeKeyframes,
	flightKeyframes,
	flightPixelRatio,
	flightScale,
	flightStarScale,
	PDF_FLIGHT_EASING,
	PDF_FLIGHT_MS,
	type FlightBox,
	type Landing,
	type LandingTarget
} from './flight';

/** What the flight asks of the pages panel (`PagesPanel`'s exports). */
export interface FlightPanel {
	/** Bring a page into view; with a `landing`, say where the copy comes down on it. */
	reveal(pageId: string, landing?: Landing): Promise<LandingTarget | null>;
	/** Where every chart is on the thumbnails just now, by its id. */
	chartBoxes(): Record<string, FlightBox>;
}

/** What Add to PDF needs of the page. */
export interface PdfFlightHost {
	readonly store: DocumentStore;
	/** The preview's canvas: the thumbnail is cut from it, and the copy takes off over it. */
	readonly canvas: HTMLCanvasElement | null;
	/** The view the chart is frozen with. */
	readonly chartView: ChartView;
	readonly layers: ChartLayers;
	/** The pages panel, once it is there. */
	readonly panel: FlightPanel | undefined;
	/** Read `message` out. */
	announce(message: string): void;
	/** Show a toast, with an Undo when `undo` is given. */
	notify(message: string, undo?: () => void): void;
}

/** The copy of the chart in the air, on its way to its place on a page's thumbnail. */
interface FlightCopy {
	/** One per flight: a new flight is a new element. */
	id: number;
	chart: ChartSnapshot;
	/** Where it takes off (the chart on screen) and where it lands, screen px. */
	from: FlightBox;
	to: FlightBox;
	/** The thumbnail chart's corner radius there, a CSS length or percentage. */
	corner: string;
}

/** What the copy's flight leads from: the chart that was added and where it was on screen. */
interface Departure {
	pageId: string;
	blockId: string;
	newPage: boolean;
	chart: ChartSnapshot;
	canvasBox: FlightBox | null;
	flying: boolean;
	before: Readonly<Record<string, FlightBox>> | undefined;
}

export class PdfFlight {
	/** A copy of the chart on its way to its page after Add to PDF; null when nothing is in the air. */
	copy = $state<FlightCopy | null>(null);
	/** The chart that copy stands for: its place on the page's thumbnail stays empty until it lands. */
	pendingId = $state<string | null>(null);
	readonly #host: PdfFlightHost;
	#flights = 0;

	constructor(host: PdfFlightHost) {
		this.#host = host;
	}

	/**
	 * Add to PDF: the chart goes into the document, the panel shows where, and a copy
	 * flies there unless less motion is asked for.
	 */
	add = (): void => {
		const { store, layers } = this.#host;
		const chartView = this.#host.chartView;
		const chart = snapshotChart(chartView, layers);
		// The backend's limits: a document past them would not export.
		const blocker = store.addChartBlocker(chart);
		if (blocker) {
			this.#host.notify(
				blocker === 'charts'
					? `The PDF document is full: it holds ${MAX_CHARTS} charts at most`
					: `No room left: a PDF document has ${MAX_PAGES} pages at most`
			);
			return;
		}
		const canvas = this.#host.canvas;
		const thumb = canvas ? chartThumbnail(canvas, chartView) : undefined;
		// Where the chart is on screen now: adding it may bring the pages panel in and move it.
		const canvasBox = canvas?.getBoundingClientRect() ?? null;
		// A copy still in the air from the last Add comes down at once.
		void this.land();
		// And where the charts already on the pages are: this one may move them to make room.
		const before = this.#host.panel?.chartBoxes();
		const { pageId, blockId, newPage, relaid, undo } = store.addChart(chart, thumb);
		store.selectedPageId = pageId;
		const flying =
			canvasBox !== null &&
			canvasBox.width > 0 &&
			typeof canvas?.animate === 'function' &&
			!prefersReducedMotion();
		// Before the thumbnail is drawn: the chart's place on it stays empty until the copy lands.
		if (flying) this.pendingId = blockId;
		const added = `Added to page ${store.pageIndex(pageId) + 1}`;
		this.#host.announce(added);
		this.#host.notify(relaid ? `${added}, layout updated` : added, () => {
			// Taken back mid-flight: the copy has nowhere to land.
			if (this.pendingId === blockId) {
				this.pendingId = null;
				this.copy = null;
			}
			if (undo()) this.#host.announce('Add to PDF undone');
		});
		void this.#lead({ pageId, blockId, newPage, chart, canvasBox, flying, before });
	};

	/** The copy has arrived (or must make way): the thumbnail draws the chart, then the copy goes. */
	land = async (): Promise<void> => {
		if (this.pendingId === null && this.copy === null) return;
		const landed = this.copy?.id;
		this.pendingId = null;
		// One update for the thumbnail to draw before the copy over it is removed: no empty frame.
		await tick();
		if (this.copy?.id === landed) this.copy = null;
	};

	/**
	 * The copy's element: lay it out on its place on the thumbnail, draw it as the
	 * thumbnail will, and play it there from over the chart. It lands by itself when
	 * it arrives.
	 */
	fly = (node: HTMLElement, copy: FlightCopy) => {
		const { from, to } = copy;
		node.style.left = `${to.x}px`;
		node.style.top = `${to.y}px`;
		node.style.width = `${to.width}px`;
		node.style.height = `${to.height}px`;
		const canvas = node.querySelector('canvas');
		const startScale = flightScale(from, to);
		const density = flightPixelRatio(from, to, window.devicePixelRatio || 1);
		const timing = { duration: PDF_FLIGHT_MS, easing: PDF_FLIGHT_EASING, fill: 'both' } as const;
		const move = node.animate(flightKeyframes(from, to), timing);
		const fade = node.animate(FLIGHT_FADE, { duration: PDF_FLIGHT_MS, fill: 'both' });
		const edge = node
			.querySelector<HTMLElement>('.pdf-flight-edge')
			?.animate(flightEdgeKeyframes(from, to, 'var(--paper-chart-edge)'), timing);
		// Redrawn every frame with the stars sized for how large the copy is shown just
		// then: a few hundred dots, and on landing exactly the thumbnail's own drawing.
		let frame = 0;
		const draw = () => {
			if (!canvas) return;
			const progress = move.effect?.getComputedTiming().progress ?? 1;
			const scale = startScale + (1 - startScale) * progress;
			drawChartThumbnail(
				canvas,
				copy.chart,
				to.width,
				to.height,
				catalog.starVectors,
				density,
				flightStarScale(scale, startScale)
			);
			if (move.playState === 'running') frame = requestAnimationFrame(draw);
		};
		draw();
		move.onfinish = () => {
			// The last frame drawn may be a hair short of the end: land on the thumbnail's exact drawing.
			draw();
			void this.land();
		};
		return {
			destroy: () => {
				cancelAnimationFrame(frame);
				move.cancel();
				fade.cancel();
				edge?.cancel();
			}
		};
	};

	/**
	 * Lead the eye from the chart to its place on the page. The panel brings the
	 * page into view (a new page makes its entrance; the first one arrives with the
	 * panel) and says where the chart sits on its thumbnail; a copy of the chart,
	 * drawn as the thumbnail draws it, flies there from the preview and is replaced
	 * by the thumbnail's own drawing as it lands; charts already on the page move
	 * aside over the same time. Without a copy (less motion asked for) the panel
	 * simply reveals the page.
	 */
	async #lead(departure: Departure): Promise<void> {
		const { pageId, blockId, newPage, chart, canvasBox, flying, before } = departure;
		const target = await this.#host.panel?.reveal(
			pageId,
			flying ? { blockId, newPage, ms: PDF_FLIGHT_MS, before } : undefined
		);
		if (!flying || this.pendingId !== blockId) return;
		if (!target || !canvasBox) {
			this.pendingId = null;
			return;
		}
		this.#flights += 1;
		this.copy = {
			id: this.#flights,
			chart,
			from: chartBoxOnScreen(canvasBox, chart.view),
			to: target.box,
			corner: target.corner
		};
	}
}
