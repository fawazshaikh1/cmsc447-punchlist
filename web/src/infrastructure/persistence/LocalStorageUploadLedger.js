import { UploadLedger } from '../../domain/ports/UploadLedger';

const STORAGE_KEY = 'punchlist.uploadedToServer';

/**
 * Which sheets and documents this browser has already uploaded, kept in local
 * storage beside the data it describes. TIER 3.
 *
 * One small list under one key rather than a key per sheet, so it is easy to
 * find and, if ever needed, to clear by hand to force a re-upload. Read once
 * and held in memory; written through on every addition.
 *
 * If storage is unavailable or the entry is damaged, the ledger starts empty.
 * That only means an upload is attempted again — and the server ignores
 * anything it already has — so it fails safe.
 */
export class LocalStorageUploadLedger extends UploadLedger {
  /** @param {Storage} [storage] Injectable so tests can pass a fake. */
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
    this.keys = new Set(this.#read());
  }

  has(key) {
    return this.keys.has(key);
  }

  add(key) {
    this.keys.add(key);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.keys]));
    } catch {
      // Quota or private mode: kept in memory for this session, retried next.
    }
  }

  #read() {
    try {
      const parsed = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [];
    } catch {
      return [];
    }
  }
}
