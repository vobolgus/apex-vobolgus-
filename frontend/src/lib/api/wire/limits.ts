/**
 * What a request may hold at most (backend/src/limits.rs): of the backend's limits,
 * the ones the page keeps to itself. A document past them cannot be exported, so the
 * editor does not build one.
 *
 * Written by the backend from its own types (backend/src/wire.rs), not by hand:
 * `WIRE_TYPES=write cargo test -p backend wire` writes it again after a change there.
 */

/** Rings on one chart: a finder card needs one. */
export const MAX_MARKS = 16;

/** Pages in one document. */
export const MAX_PAGES = 100;

/** Charts on one page. */
export const MAX_ITEMS_PER_PAGE = 50;

/**
 * Charts in the whole document. A chart costs about the same to draw whatever its
 * size (every star to the magnitude limit, roughly 1 MB of PDF), so the work and the
 * file are capped here: the page and item counts alone would allow 5000.
 */
export const MAX_CHARTS = 200;

/** Blocks of text on one page. */
export const MAX_TEXTS_PER_PAGE = 50;

/**
 * Lines in one block of text: a page of 6 pt type is under 200, and a table is a
 * line a cell (40 rows of 8 columns under a header).
 */
export const MAX_LINES_PER_TEXT = 400;

/** Characters in one line: far more than a page is wide at any size worth reading. */
export const MAX_LINE_CHARS = 400;
