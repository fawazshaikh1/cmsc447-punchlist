/**
 * Turns media keys into URLs a browser can render, and revokes them once.
 *
 * ===========================================================================
 * THE LEAK THIS EXISTS TO PREVENT
 * ===========================================================================
 * `URL.createObjectURL` pins its Blob in memory until `revokeObjectURL` is
 * called. A marker component that created one per render would pin a new copy
 * of a 300KB photograph on every zoom, pan and selection change — on an iPad,
 * a few minutes of work would be enough to have the tab killed.
 *
 * So URLs are created once per key and shared. Markers ask for a key and get
 * back a string; nobody calls `createObjectURL` anywhere else.
 *
 * ---------------------------------------------------------------------------
 * WHY A CACHE AND NOT A HOOK'S OWN STATE
 * ---------------------------------------------------------------------------
 * The same photo can be on screen in three places at once — the marker, the
 * properties panel, and a future thumbnail strip. Per-component state would
 * decode and pin it three times, and the three would revoke independently, so
 * whichever unmounted first would break the other two.
 *
 * One cache means one URL per photo for as long as anything is showing it.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DOES NOT EVICT
 * ---------------------------------------------------------------------------
 * The bound is the number of photos on the open sheet, which the product caps
 * at five per item. `dispose()` clears everything when the document closes,
 * which is the only moment the whole set genuinely stops being needed. An LRU
 * here would add a policy nobody can tune and a class of bug — a revoked URL
 * still referenced by a marker renders as a broken image — for no real ceiling.
 */
export class MediaUrlCache {
  /** @param {import('../../domain/ports/MediaStore').MediaStore} store */
  constructor(store) {
    this.store = store;
    /** @type {Map<string, string>} key -> object URL */
    this.urls = new Map();
    /** @type {Map<string, Promise<string|null>>} key -> in-flight load */
    this.pending = new Map();
    /** @type {Set<() => void>} */
    this.listeners = new Set();
  }

  /** The URL for a key if it is already loaded, else null. Synchronous. */
  peek(key) {
    return this.urls.get(key) ?? null;
  }

  /**
   * Loads a key and returns its URL.
   *
   * Concurrent calls for the same key share one read. Without that, a sheet
   * with the same photo in the overlay and the panel would hit IndexedDB twice
   * on open and briefly hold two URLs for one Blob.
   *
   * @param {string} key
   * @returns {Promise<string|null>} null when the photo is not in the store.
   */
  async load(key) {
    if (!key) return null;

    const existing = this.urls.get(key);
    if (existing) return existing;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const work = (async () => {
      try {
        const blob = await this.store.get(key);
        if (!blob) return null;

        const url = URL.createObjectURL(blob);
        this.urls.set(key, url);
        this.#notify();
        return url;
      } catch {
        // A store that cannot be read yields a placeholder, not a crash. The
        // marker draws a "missing photo" frame, the same as the PDF writer.
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, work);
    return work;
  }

  /** @param {() => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Revokes every URL. Call when the document closes.
   *
   * Not on sheet change: the user flicks between sheets constantly, and
   * re-reading every photo from IndexedDB each time would put a visible stall
   * on an interaction that should be instant.
   */
  dispose() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.pending.clear();
    this.#notify();
  }

  #notify() {
    for (const listener of [...this.listeners]) listener();
  }
}
