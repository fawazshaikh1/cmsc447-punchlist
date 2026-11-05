/**
 * What one sheet is called: its number and title as the title block prints
 * them — "A-101", "LEVEL 1 FLOOR PLAN".
 *
 * ===========================================================================
 * WHY A SHEET NEEDS A NAME AT ALL
 * ===========================================================================
 * Everyone on a job refers to a sheet by its number. "Sheet 7 of 153" is the
 * app's word, not theirs: an architect asked about "sheet 7" goes looking for
 * A-107, or for whatever happens to be seventh in their copy of the set. A
 * punch list, a bookmark or a sort that says A-101 says what the person on
 * site would say.
 *
 * ---------------------------------------------------------------------------
 * WHERE A NAME COMES FROM
 * ---------------------------------------------------------------------------
 * DETECTED — read from the drawing (see findSheetName). Usually right, never
 *   guaranteed: a title block is free-form text.
 * EDITED — typed by an admin, which is how a wrong reading is put right. An
 *   edited name is never replaced by a later reading (see SheetNames).
 *
 * Titles are kept as printed. Most title blocks print in capitals, and
 * re-casing "HVAC PLAN" into "Hvac Plan" would be wrong more often than it
 * would be prettier.
 */
export class SheetName {
  static SOURCE = Object.freeze({ DETECTED: 'detected', EDITED: 'edited' });
  static MAX_NUMBER = 40;
  static MAX_TITLE = 120;

  /**
   * @param {object} fields
   * @param {number} fields.pageIndex Zero-based page of the drawing.
   * @param {string} [fields.number] "A-101". Whitespace is tidied; longer
   *        than MAX_NUMBER characters is cut.
   * @param {string} [fields.title] "LEVEL 1 FLOOR PLAN". Same tidying, cut at
   *        MAX_TITLE.
   * @param {string} [fields.source] One of SheetName.SOURCE.
   */
  constructor({ pageIndex, number = '', title = '', source = SheetName.SOURCE.DETECTED }) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      throw new TypeError(`A sheet name needs a page index of 0 or more; got ${JSON.stringify(pageIndex)}.`);
    }
    if (!Object.values(SheetName.SOURCE).includes(source)) {
      throw new TypeError(`Unknown sheet name source "${source}".`);
    }

    this.pageIndex = pageIndex;
    this.number = tidy(number, SheetName.MAX_NUMBER);
    this.title = tidy(title, SheetName.MAX_TITLE);
    this.source = source;
    Object.freeze(this);
  }

  /** "A-101 · LEVEL 1 FLOOR PLAN", or whichever half is known, or ''. */
  get label() {
    return [this.number, this.title].filter(Boolean).join(' · ');
  }

  /** @returns {{ pageIndex: number, number: string, title: string, source: string }} */
  toJSON() {
    return { pageIndex: this.pageIndex, number: this.number, title: this.title, source: this.source };
  }

  /** @param {{ pageIndex: number, number?: string, title?: string, source?: string }} json */
  static fromJSON(json) {
    return new SheetName(json);
  }
}

/** Trims, collapses runs of whitespace (new lines included) and caps length. */
function tidy(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  // Counted in characters, not UTF-16 units, so a title is never cut through
  // the middle of a letter outside the basic plane.
  const characters = [...text];
  return characters.length > max ? characters.slice(0, max).join('').trimEnd() : text;
}
