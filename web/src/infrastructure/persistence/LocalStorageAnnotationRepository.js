import { AnnotationRegistry } from '../../domain/annotations/AnnotationRegistry';
import { AnnotationRepository } from '../../domain/ports/AnnotationRepository';

const STORAGE_PREFIX = 'punchlist.annotations.';

/**
 * Repository backed by `localStorage`. TIER 3. **The Sprint 1 default.**
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN JUST USING THE IN-MEMORY ONE
 * ---------------------------------------------------------------------------
 * The product has to demonstrate that a pin's coordinate SURVIVES. Surviving a
 * zoom is proven by the SVG overlay; surviving a page reload needs real
 * persistence. With this wired in, the acceptance criterion is demonstrable to
 * a stakeholder in ten seconds — drop pins, press F5, they are still there —
 * months before the Go API exists.
 *
 * Storing the serialised DTO rather than the object graph means the JSON
 * written here is byte-for-byte what the Go API will accept in Sprint 2, so
 * that migration is a data copy rather than a transformation.
 *
 * ---------------------------------------------------------------------------
 * LIMITS, ACKNOWLEDGED
 *   ~5MB per origin      thousands of pins — fine for a spike, not a real store
 *   synchronous          main-thread, irrelevant at this scale
 *   per-browser          nothing is shared between users. Sprint 2 fixes that.
 */
export class LocalStorageAnnotationRepository extends AnnotationRepository {
  /** @param {Storage} [storage] Injectable so tests can pass a fake. */
  constructor(storage = window.localStorage) {
    super();
    this.storage = storage;
  }

  async listBySheet(sheetId) {
    return this.#read(sheetId)
      // `tryFromJSON`, not `fromJSON`: a row written by a newer build that
      // knows markup types this one does not should never blank the whole
      // sheet. Skip what cannot be decoded, show the rest.
      .map((dto) => AnnotationRegistry.tryFromJSON(dto))
      .filter((annotation) => annotation !== null);
  }

  async save(annotation) {
    const rows = this.#read(annotation.sheetId);
    const index = rows.findIndex((row) => row.id === annotation.id);
    const dto = annotation.toJSON();

    // Upsert, matching the contract. See AnnotationRepository for why
    // idempotent writes matter to the Sprint 3 offline outbox.
    if (index >= 0) rows[index] = dto;
    else rows.push(dto);

    this.#write(annotation.sheetId, rows);
  }

  async delete(id) {
    // The contract deletes by id alone, but localStorage is partitioned by
    // sheet, so we sweep. Acceptable at spike scale; the HTTP and SQL
    // implementations both index by id and do this in a single operation.
    for (const key of this.#sheetKeys()) {
      const sheetId = key.slice(STORAGE_PREFIX.length);
      const rows = this.#read(sheetId);
      const remaining = rows.filter((row) => row.id !== id);
      if (remaining.length !== rows.length) {
        this.#write(sheetId, remaining);
        return;
      }
    }
  }

  async clearSheet(sheetId) {
    this.storage.removeItem(STORAGE_PREFIX + sheetId);
  }

  // --- internals ----------------------------------------------------------

  #read(sheetId) {
    try {
      const raw = this.storage.getItem(STORAGE_PREFIX + sheetId);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Corrupt or hand-edited JSON, or storage blocked by browser settings.
      // An unreadable cache is not worth crashing the viewer over: the user
      // loses their local pins, not the ability to open the drawing.
      return [];
    }
  }

  #write(sheetId, rows) {
    try {
      this.storage.setItem(STORAGE_PREFIX + sheetId, JSON.stringify(rows));
    } catch (error) {
      // QuotaExceededError, or a private window that blocks writes outright.
      throw new Error(
        'Could not save annotations to local storage (quota exceeded or private browsing).',
        { cause: error },
      );
    }
  }

  #sheetKeys() {
    const keys = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    return keys;
  }
}
