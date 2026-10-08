import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * @typedef {object} EmbeddedMarkup
 * @property {number} pageIndex Zero-based page the markup was exported on.
 * @property {object} data The annotation as it was stored when exported —
 *           `Annotation.toJSON()`. Its `sheetId` names the sheet in the file
 *           it was exported FROM; a caller restoring it gives it a new one.
 */

/**
 * PORT — finds our own markups inside a PDF we exported as a working copy.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * A working copy is a native-annotation export: every markup is a real PDF
 * annotation an architect can select in Acrobat. Reopened in this app, those
 * same annotations used to come back as part of the page picture — drawn by
 * pdf.js into the canvas, looking exactly like pins, and impossible to select,
 * move or edit. The app keys markups by file name, the export renames the
 * file, so the reopened copy had no markups of its own at all.
 *
 * The exporter now writes each markup's data into its annotation. A reader
 * finds them again, asks the caller about each one, and takes out of the file
 * every markup the caller has turned back into a live, editable one — so it
 * is drawn once, by the app, and the next export does not add it a second
 * time on top of its old self.
 *
 * Annotations we did not write are never touched: an architect's comments in
 * the file stay exactly where they were, read-only, as before.
 */
export class WorkingCopyReader {
  static REQUIRED = ['read'];

  constructor() {
    enforceContract(this, new.target, WorkingCopyReader);
  }

  /**
   * @param {ArrayBuffer} bytes The PDF as opened.
   * @param {(markup: EmbeddedMarkup) => Promise<boolean>|boolean} take Called
   *        once per embedded markup, in the order they appear on each page.
   *        Return true when the app now owns that markup and it should leave
   *        the file; false to leave it exactly where it is.
   * @returns {Promise<ArrayBuffer>} The bytes to view and export from. THE
   *          SAME BUFFER, untouched, when nothing was taken out — a PDF that
   *          never passed through our exporter must come out byte-identical.
   */
  async read(bytes, take) {
    return abstractMethod('WorkingCopyReader', 'read', bytes, take);
  }
}
