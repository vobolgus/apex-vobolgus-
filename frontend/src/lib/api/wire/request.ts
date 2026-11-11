/**
 * What a client sends: the queries of the catalogue and export routes and the
 * JSON bodies of the export routes, as they are on the wire (backend/src/request.rs
 * and the handlers).
 *
 * Written by the backend from its own types (backend/src/wire.rs), not by hand:
 * `WIRE_TYPES=write cargo test -p backend wire` writes it again after a change there.
 */

/** The magnitude range a star route is asked for; both ends are optional. */
export type CatalogQuery = {
	/** The faintest star wanted; the route's own default when absent. */
	max_mag?: number | null;
	/** The brightest star wanted; none are left out when absent. */
	min_mag?: number | null;
};

/** The query of `/api/export`. */
export type ExportQuery = {
	/** `svg` asks for the SVG; anything else, or nothing, for the PDF. */
	format?: string | null;
};

/** One chart, as `POST /api/export` takes it and as a document carries it. */
export type RenderConfig = {
	/**
	 * `"stereo"` or `"pinhole"`. Text here, so that any other name is refused by
	 * the chart's own check with its own message, and not by the JSON reader.
	 */
	projection: Projection;
	/**
	 * The instant the planets are placed at and the horizon chart is turned to:
	 * RFC 3339, `YYYY-MM-DD HH:MM:SS` or a bare date, read as UTC.
	 */
	datetime?: string | null;
	/**
	 * Observer position. Orients the chart when there is no `view`, so it is
	 * required then; with a `view` it is unused.
	 */
	latitude?: number | null;
	/** The observer's longitude, degrees east. */
	longitude?: number | null;
	/** The faintest star drawn, in visual magnitude. */
	magnitude_limit?: number | null;
	/**
	 * With a `view`: across the disc for "stereo", horizontal for "pinhole".
	 * Without one, pinhole only, across the frame diagonal.
	 */
	fov_deg?: number | null;
	/** Width over height of a pinhole chart without a `view`. */
	aspect_ratio?: number | null;
	/**
	 * The one constellation whose figure, boundary and name are drawn, by
	 * abbreviation; a pinhole chart without a `view` is aimed at it too.
	 */
	constellation?: string | null;
	/**
	 * Where a pinhole chart without a `view` looks: a vector in the J2000
	 * equatorial frame, of any length.
	 */
	center_direction?: [number, number, number] | null;
	/** Degrees a pinhole chart without a `view` is rolled about its axis. */
	tilt_angle?: number | null;
	/**
	 * The generator preview's camera. When present it decides what the chart
	 * shows and how big it is, instead of the observer and `center_direction`.
	 */
	view?: ViewConfig | null;
	/** What is drawn besides the stars. */
	layers: LayersConfig;
	/** The chart's colours, font and star sizes. */
	style: StyleConfig;
	/** Places ringed on the chart: where a close-up chart looks, on the wide one. */
	marks?: Array<SkyMark>;
	/** Print the observer's place and the time in the chart's corner. */
	print_info?: boolean | null;
	/** A line of text centred under the chart. */
	footer_text?: string | null;
};

/** How the sky is flattened onto a chart. On the wire it is its name in small letters. */
export type Projection = 'stereo' | 'pinhole';

/** A ring on the sky: every point `radius_deg` from (`ra_deg`, `dec_deg`). */
export type SkyMark = {
	/** Right ascension of the ring's centre, degrees, J2000. */
	ra_deg: number;
	/** Declination of the ring's centre, degrees, J2000. */
	dec_deg: number;
	/** The ring's angular radius, degrees. */
	radius_deg: number;
};

/**
 * Camera basis in the equatorial frame (x → RA 0h, z → north pole), and the
 * chart size. Sizes are px of the preview, so stars and lines keep its proportions.
 */
export type ViewConfig = {
	/** Screen right. */
	right: [number, number, number];
	/** Screen up. */
	up: [number, number, number];
	/** The chart centre. */
	forward: [number, number, number];
	/** The chart's width, in the units `px` is given in. */
	width: number;
	/** The chart's height, in the same units. */
	height: number;
	/**
	 * Length of one preview px in the units of `width` and `height`, default 1.
	 * Star radii and line widths are multiplied by it: a chart sized in mm with
	 * a fixed `px` keeps its stars the same size on paper however large it is.
	 */
	px?: number | null;
};

/**
 * The layers of a chart, each on or off. `horizontal_grid` and `poles` are read
 * and draw nothing.
 */
export type LayersConfig = {
	/** The ecliptic, a line. */
	ecliptic: boolean;
	/** The celestial equator, a line. */
	equator: boolean;
	/** The galactic equator, a line. */
	galactic_equator: boolean;
	/** The Sun, the Moon and the planets at the chart's instant. */
	planets: boolean;
	/** Altitude and azimuth circles; not drawn. */
	horizontal_grid: boolean;
	/** Parallels of declination and meridians of right ascension. */
	equatorial_grid: boolean;
	/** The constellations' stick figures. */
	constellations: boolean;
	/** The constellations' IAU boundaries. */
	constellation_boundaries?: boolean;
	/** The constellations' names, and the planets' beside them. */
	constellation_names: boolean;
	/** A cross at the zenith of the observer's horizon chart. */
	zenith: boolean;
	/** The celestial poles; not drawn. */
	poles: boolean;
};

/** A chart's colours (anything SVG takes as a paint), its font and its star sizes. */
export type StyleConfig = {
	/** Fill of the stars. */
	star_color: string;
	/** Stroke of the constellations' figures and boundaries. */
	constellation_line_color: string;
	/** Stroke of the grid, the equator and the horizon. */
	grid_color: string;
	/**
	 * Behind everything, the area around a stereo disc included. `none` paints
	 * nothing, so whatever the chart is drawn on shows through.
	 */
	background_color: string;
	/** Fill of the sky itself (the disc, or the pinhole frame). None leaves the background. */
	chart_color?: string | null;
	/** Stroke around the sky's edge, 1 preview px wide. A white disc on white paper needs it. */
	chart_outline?: string | null;
	/** `font-family` of the chart's own text. */
	font_family: string;
	/** What every star's and planet's radius is multiplied by. */
	magnitude_scale: number;
};

/** `POST /api/export/document`: pages of a multi-page PDF, each holding charts and text. */
export type DocumentRequest = {
	/** The pages, in order. */
	pages: Array<DocumentPage>;
};

/** One page, in mm. An empty page is a blank page. */
export type DocumentPage = {
	/** The page's width, mm. */
	width_mm: number;
	/** The page's height, mm. */
	height_mm: number;
	/** The charts on it. */
	items?: Array<DocumentItem>;
	/** Drawn over the charts. */
	texts?: Array<DocumentText>;
};

/**
 * A chart on a page: its box in mm from the page's top-left, y down, and what to draw.
 * The config's `view` sizes the chart's own coordinates, which are fitted into the box.
 */
export type DocumentItem = {
	/** The box's left edge, mm from the page's. */
	x_mm: number;
	/** The box's top edge, mm from the page's. */
	y_mm: number;
	/** The box's width, mm. */
	width_mm: number;
	/** The box's height, mm. */
	height_mm: number;
	/** The chart drawn in the box. */
	config: RenderConfig;
};

/**
 * A block of text on a page, already broken into lines: the page editor wraps it
 * (it shows the text as it is typed) and this server only sets each line where it is
 * told to, in the same font file (`crate::fonts`), so the PDF breaks where the editor did.
 */
export type DocumentText = {
	/** Which bundled family the text is set in. */
	font: TextFont;
	/** Set in the bold face. */
	bold?: boolean;
	/** Set in the italic face. */
	italic?: boolean;
	/** The font size, mm. */
	size_mm: number;
	/** Which point of a line its `x_mm` is. */
	anchor?: TextAnchor;
	/**
	 * Degrees the text is turned clockwise about (`cx_mm`, `cy_mm`). Its lines are
	 * given as they are before the turn.
	 */
	rotation_deg?: number;
	/** The centre of the turn, mm from the page's left edge. */
	cx_mm?: number;
	/** The centre of the turn, mm from the page's top edge. */
	cy_mm?: number;
	/** The lines, each where the editor put it. */
	lines: Array<DocumentTextLine>;
	/** Hairlines drawn with the text and turned with it: the rules of a table. */
	rules?: Array<DocumentRule>;
};

/** A straight line from (`x1_mm`, `y1_mm`) to (`x2_mm`, `y2_mm`), `width_mm` thick, black. */
export type DocumentRule = {
	/** Where the rule starts, mm from the page's left edge. */
	x1_mm: number;
	/** Where the rule starts, mm from the page's top edge. */
	y1_mm: number;
	/** Where the rule ends, mm from the page's left edge. */
	x2_mm: number;
	/** Where the rule ends, mm from the page's top edge. */
	y2_mm: number;
	/** The rule's thickness, mm. */
	width_mm: number;
};

/**
 * One line of text: where its baseline starts (or its middle, or its end: the
 * text's `anchor`), mm from the page's top-left, y down. A cell of a table is a
 * line with an anchor and a weight of its own.
 */
export type DocumentTextLine = {
	/** The anchor point of the line, mm from the page's left edge. */
	x_mm: number;
	/** The line's baseline, mm from the page's top edge. */
	y_mm: number;
	/** What the line says. */
	text: string;
	/** Which point of this line its `x_mm` is; the text's `anchor` when absent. */
	anchor?: TextAnchor | null;
	/** Set this line bold, or not, whatever the text is; the text's `bold` when absent. */
	bold?: boolean | null;
};

/** The bundled families a text may be set in (`crate::fonts`). */
export type TextFont = 'serif' | 'sans';

/** Which point of a line of text its `x_mm` is: SVG's `text-anchor`. */
export type TextAnchor = 'start' | 'middle' | 'end';
