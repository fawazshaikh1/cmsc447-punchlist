import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — reads each page's name from a drawing's own text (spec 5.2).
 *
 * The reading itself is the domain's (`findSheetName`); getting text and its
 * position off a PDF page is a PDF library's job, which is why this is a port.
 */
export class SheetNameDetector {
  static REQUIRED = ['detect'];

  constructor() {
    enforceContract(this, new.target, SheetNameDetector);
  }

  /**
   * @param {ArrayBuffer} bytes The drawing. Not detached or kept.
   * @param {{ signal?: AbortSignal }} [options] Abort to stop between pages —
   *        when the person opens another drawing before this one is read.
   * @returns {Promise<import('../sheets/SheetName').SheetName[]>} One per page
   *          that had a readable name; pages without one are left out.
   */
  async detect(bytes, options) {
    return abstractMethod('SheetNameDetector', 'detect', bytes, options);
  }
}
