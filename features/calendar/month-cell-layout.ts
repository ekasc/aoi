/**
 * How many event strips a month cell may draw.
 *
 * The month grid is six fixed rows inside the space the screen gives the
 * pager, and every line in a cell scales with the reader's text size while the
 * row does not. So the number of strips has to be computed from the room that
 * is actually left, not guessed: a cell that draws more than fits reaches into
 * the week below and the grid stops being readable exactly for the readers who
 * enlarged the text to read it.
 *
 * Constants are mirrored from the styles they belong to; the caller passes the
 * row height it was given. See `styles.dayCell`, `styles.strip` and
 * `styles.stripText` in `app/(app)/(tabs)/plans.tsx`.
 */

/** Cell padding: `dayCell.paddingVertical` twice. */
const CELL_PADDING = 12;
/** `dayCell` gap between the numeral and the strip row. */
const CELL_GAP = 3;
/** `stripRow` gap between strips. */
const STRIP_GAP = 2;
/** `strip` padding: `paddingVertical` twice. */
const STRIP_PADDING = 2;
/** `weekRow` hairline, taken off the row before anything is placed in it. */
const ROW_BORDER = 1;

/** `dayNumber` numeral: fontSize 19 with the platform's line box. */
const NUMERAL_LINE = 23;
/** `dayNumber` minHeight, which holds the box open at small type sizes. */
const NUMERAL_MIN = 28;
/** `stripText` lineHeight. */
const STRIP_LINE = 14;
/** The "+N more" line, a caption. */
const COUNT_LINE = 19;

/** Columns in the month grid. */
const MONTH_COLUMNS = 7;
/** `strip` padding: `paddingHorizontal` twice. */
const STRIP_PADDING_H = 6;
/** `stripDot` width. */
const STRIP_DOT = 5;
/** `strip` gap, between dots and before the title. */
const STRIP_DOT_GAP = 2;
/** `stripText` fontSize. */
const STRIP_FONT = 11;
/** Rough glyph advance for the body face, as a fraction of font size. */
const GLYPH_EM = 0.52;
/** The shortest run of a title that still reads as a word. */
const MIN_TITLE_CHARS = 5;

/** The most strips a cell ever draws, however much room there is. */
export const MAX_STRIPS_PER_CELL = 2;

/** What a cell draws when the space is not known yet. */
export const DEFAULT_STRIPS_PER_CELL = MAX_STRIPS_PER_CELL;

/** One column's share of the page width. */
export function monthCellWidth(windowWidth: number, columnGap: number): number {
  return (windowWidth - columnGap * (MONTH_COLUMNS - 1)) / MONTH_COLUMNS;
}

/**
 * Whether a strip has room to print its title.
 *
 * A cell is about 54pt wide on a normal phone and 44pt on the narrowest, which
 * after the dot and the padding leaves room for a handful of characters. Under
 * that, a title is a smudge: better to draw the strip as the bar it becomes
 * without text, which still says a plan is there and whose it is, and let the
 * day view carry the words. `dots` is how many the widest strip in the cell
 * draws, so a cell never mixes titled and untitled strips.
 */
export function monthStripTitlesFit(
  cellWidth: number,
  fontScale: number,
  dots: number,
): boolean {
  if (!(cellWidth > 0) || !(fontScale > 0)) {
    // Before the width is known, keep the titles: the first frame should not
    // be the one that decides they are gone.
    return true;
  }
  const titleWidth =
    cellWidth -
    STRIP_PADDING_H -
    dots * STRIP_DOT -
    (dots - 1) * STRIP_DOT_GAP -
    STRIP_DOT_GAP;
  return titleWidth >= MIN_TITLE_CHARS * STRIP_FONT * GLYPH_EM * fontScale;
}

const numeralHeight = (fontScale: number) =>
  Math.max(NUMERAL_MIN, NUMERAL_LINE * fontScale);

const stripsFit = (
  strips: number,
  available: number,
  stripHeight: number,
): boolean => strips * stripHeight + (strips - 1) * STRIP_GAP <= available;

export function monthStripsPerCell(fontScale: number, rowHeight: number): number {
  if (!(rowHeight > 0) || !(fontScale > 0)) {
    return DEFAULT_STRIPS_PER_CELL;
  }

  // The "+N more" line is always reserved, because a cell that has to drop
  // strips is a cell that has something to count.
  const fixed =
    CELL_PADDING +
    ROW_BORDER +
    numeralHeight(fontScale) +
    CELL_GAP +
    COUNT_LINE * fontScale;
  const available = rowHeight - fixed;
  const stripHeight = STRIP_LINE * fontScale + STRIP_PADDING;

  for (let strips = MAX_STRIPS_PER_CELL; strips > 0; strips -= 1) {
    if (stripsFit(strips, available, stripHeight)) {
      return strips;
    }
  }
  // No room for a strip: the numeral and the count still say the day has plans.
  return 0;
}
