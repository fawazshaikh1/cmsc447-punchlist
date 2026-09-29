import { MediaStore } from '../../domain/ports/MediaStore';

const DB_NAME = 'punchlist-media';
const DB_VERSION = 1;
const STORE = 'photos';

/**
 * Image bytes in IndexedDB. **The Sprint 1 default.**
 *
 * ===========================================================================
 * WHY NOT localStorage, LIKE EVERYTHING ELSE
 * ===========================================================================
 * `localStorage` stores strings, so a photograph would have to be base64 — a
 * 33% size penalty on data that is already the largest thing in the app — and
 * the whole origin gets about 5MB. Two photos from an iPad would exhaust it,
 * and the failure would surface as a quota error while saving a punch item,
 * taking the user's text with it.
 *
 * IndexedDB stores Blobs natively, with no encoding penalty, and its quota is a
 * share of free disk rather than a fixed 5MB. It is also asynchronous, which
 * matters on a tablet: writing 4MB synchronously would jank the drawing.
 *
 * The cost is that IndexedDB's API is from another era, which is why this file
 * is mostly plumbing. That plumbing is the entire price of the decision, and it
 * is paid once, here, behind a three-method port.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 * It is per-browser and per-device, like every Sprint 1 store. A photo taken on
 * the iPad is not on the laptop. Sprint 2 replaces this with `S3MediaStore` and
 * that stops being true — one line in the composition root.
 */
export class IndexedDbMediaStore extends MediaStore {
  /** @param {IDBFactory} [indexedDbFactory] Injectable for tests. */
  constructor(indexedDbFactory = globalThis.indexedDB) {
    super();
    this.factory = indexedDbFactory;
    /** @type {Promise<IDBDatabase>|null} Opened once, reused. */
    this.connection = null;
  }

  async put(blob) {
    // The key is ours, not the caller's — see the port for why. Prefixed so a
    // key is recognisable in devtools while debugging a missing photo.
    const key = `photo_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

    const db = await this.#open();
    await this.#transact(db, 'readwrite', (store) => store.put(blob, key));

    return key;
  }

  async get(key) {
    const db = await this.#open();
    const value = await this.#transact(db, 'readonly', (store) => store.get(key));

    // `undefined` for an unknown key becomes `null`, because the port promises
    // null and a marker that checks `=== null` should not have to know that
    // IndexedDB uses a different absent value.
    return value ?? null;
  }

  async remove(key) {
    const db = await this.#open();
    await this.#transact(db, 'readwrite', (store) => store.delete(key));
  }

  // --- internals ----------------------------------------------------------

  /**
   * Opens the database once and reuses the connection.
   *
   * Cached as the PROMISE rather than the resolved database, so two photos
   * captured in quick succession share one open rather than racing to create
   * two connections and two upgrade transactions.
   */
  #open() {
    if (this.connection) return this.connection;

    this.connection = new Promise((resolve, reject) => {
      if (!this.factory) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }

      const request = this.factory.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        // No key path: the key is passed in on every put, because it is a
        // string we generate rather than a field inside the Blob.
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open the photo store.'));

      // Private browsing in Safari can leave the request pending forever rather
      // than erroring. Without this the capture dialog would hang with no
      // explanation; with it, the user gets told within a few seconds.
      request.onblocked = () => reject(new Error('The photo store is blocked by another tab.'));
    });

    // A failed open must not be cached, or every later attempt inherits the
    // failure even after the user grants storage access.
    this.connection.catch(() => {
      this.connection = null;
    });

    return this.connection;
  }

  /**
   * Runs one operation in a transaction and resolves with its result.
   *
   * Resolves on the TRANSACTION completing rather than on the request
   * succeeding: a write is not durable until its transaction commits, and
   * reporting success before then would let the app store an annotation whose
   * photo is not actually saved.
   */
  #transact(db, mode, operate) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operate(tx.objectStore(STORE));

      let result;
      request.onsuccess = () => {
        result = request.result;
      };

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('The photo store rejected the operation.'));
      tx.onabort = () =>
        reject(
          tx.error ??
            new Error('The photo store ran out of space. Free some room and try again.'),
        );
    });
  }
}
