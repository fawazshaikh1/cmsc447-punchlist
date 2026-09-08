import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * @typedef {object} ExportPage
 * @property {number} pageIndex ZERO-based page in the source document.
 * @property {import('../annotations/Annotation').Annotation[]} annotations
 *
 * @typedef {object} ExportRequest
 * @property {ArrayBuffer} sourceBytes The ORIGINAL, unmodified PDF.
 * @property {ExportPage[]} pages
 * @property {string} author Shown as the annotation author in Acrobat.
 */

/**
 * CONTRACT — writes annotations back into a PDF.
 *
 * ===========================================================================
 * WHY THIS IS THE MOST IMPORTANT CAPABILITY IN THE PRODUCT
 * ===========================================================================
 * Every construction team already has PDF viewers. What they do not have is a
 * field tool whose output opens as REAL, selectable, commentable annotations in
 * whatever software the architect, the GC and the subs each happen to use.
 *
 * The distinction that makes this possible, and that is worth understanding
 * before touching any implementation:
 *
 *   EDITING a PDF     — rewriting its content streams, reflowing text.
 *                       Genuinely hard. We never do this.
 *   ANNOTATING a PDF  — appending dictionaries to a page's /Annots array.
 *                       Straightforward, and what every viewer already renders.
 *
 * An implementation MUST NOT touch the existing content streams. The drawing
 * comes out byte-identical; only annotation objects are added. That single
 * constraint is what makes the operation safe on a 153-page, hundred-megabyte
 * drawing set.
 *
 * @see infrastructure/export/PdfLibSheetExporter.js for the implementation.
 */
export class SheetExporter {
  static REQUIRED = ['exportAnnotated'];

  constructor() {
    enforceContract(this, new.target, SheetExporter);
  }

  /**
   * @param {ExportRequest} request
   * @returns {Promise<Uint8Array>} The annotated PDF's bytes.
   */
  exportAnnotated(request) {
    return abstractMethod('SheetExporter', 'exportAnnotated', request);
  }
}
