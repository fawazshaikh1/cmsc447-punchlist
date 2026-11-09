import { SheetName } from './SheetName';

/**
 * The names of one drawing's sheets, by page — and the answer for a page that
 * has none: "Sheet 3", exactly what the app has always shown.
 *
 * Immutable: every change returns a new collection, so a component holding
 * one never sees it change underneath it.
 *
 * ---------------------------------------------------------------------------
 * A NAME SOMEONE TYPED WINS
 * ---------------------------------------------------------------------------
 * Detection fills pages that have no name; it never replaces one. An admin who
 * corrected A-101 to A-100 has said something the drawing could not, and the
 * next device to read the drawing must not quietly undo it. A page an admin
 * cleared on purpose — an edited name with nothing in it — counts as named
 * for the same reason.
 */
export class SheetNames {
  /** @type {Map<number, SheetName>} */
  #byPage;

  /** @param {SheetName[]} [names] One per page; a later one for the same page wins. */
  constructor(names = []) {
    this.#byPage = new Map();
    for (const name of names) {
      if (!(name instanceof SheetName)) throw new TypeError('SheetNames holds SheetName values.');
      this.#byPage.set(name.pageIndex, name);
    }
    Object.freeze(this);
  }

  static EMPTY = new SheetNames();

  /** @param {number} pageIndex @returns {SheetName|null} */
  nameFor(pageIndex) {
    return this.#byPage.get(pageIndex) ?? null;
  }

  /** "A-101 · LEVEL 1 FLOOR PLAN", or "Sheet N" when nothing is known. */
  labelFor(pageIndex) {
    return this.nameFor(pageIndex)?.label || fallback(pageIndex);
  }

  /** "A-101", or "Sheet N" — for places too narrow for the title. */
  numberFor(pageIndex) {
    return this.nameFor(pageIndex)?.number || fallback(pageIndex);
  }

  /** @param {number} pageCount @returns {number[]} Pages with no name stored. */
  missingPages(pageCount) {
    const missing = [];
    for (let page = 0; page < pageCount; page++) {
      if (!this.#byPage.has(page)) missing.push(page);
    }
    return missing;
  }

  /**
   * Names read from the drawing, kept only for pages that have none.
   * @param {SheetName[]} detected
   * @returns {SheetNames}
   */
  withDetected(detected) {
    const fresh = detected.filter((name) => !this.#byPage.has(name.pageIndex));
    return fresh.length === 0 ? this : new SheetNames([...this.toArray(), ...fresh]);
  }

  /** A name typed by an admin, replacing whatever the page had. */
  withEdited(name) {
    return new SheetNames([...this.toArray(), name]);
  }

  /** @returns {SheetName[]} By page. */
  toArray() {
    return [...this.#byPage.values()].sort((a, b) => a.pageIndex - b.pageIndex);
  }
}

function fallback(pageIndex) {
  return `Sheet ${pageIndex + 1}`;
}
