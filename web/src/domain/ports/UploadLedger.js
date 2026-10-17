import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — remembers which sheets and documents have already had their
 * browser-saved data uploaded to the server.
 *
 * Exists so the one-time upload really is one time. Without it, every sheet
 * opened in server mode would re-read its local storage and re-send its whole
 * history on every visit. The server would ignore the duplicates, but the
 * requests would still be made, every time, forever.
 *
 * Keys are opaque strings chosen by BrowserUploadService. Synchronous on
 * purpose: it is a handful of flags, and answering from memory keeps the check
 * free on every read after the first.
 */
export class UploadLedger {
  static REQUIRED = ['has', 'add'];

  constructor() {
    enforceContract(this, new.target, UploadLedger);
  }

  /** @param {string} key @returns {boolean} */
  has(key) {
    return abstractMethod('UploadLedger', 'has', key);
  }

  /** @param {string} key */
  add(key) {
    return abstractMethod('UploadLedger', 'add', key);
  }
}
