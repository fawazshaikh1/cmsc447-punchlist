import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * CONTRACT (abstract base class) — the persistence boundary for annotations.
 *
 * ===========================================================================
 * WHY EVERY METHOD RETURNS A PROMISE EVEN THOUGH SPRINT 1 USES A Map
 * ===========================================================================
 * The Sprint 1 implementations are a `Map` and `localStorage`, both of which
 * could return synchronously. They do not, on purpose.
 *
 * Sprint 2 replaces them with HTTP calls to the Go API, and Sprint 3 adds an
 * IndexedDB offline cache — both unavoidably asynchronous. If this contract
 * were synchronous today, that swap would change the return type of every
 * method, which would change every call site, every hook, and every component
 * that touches annotations.
 *
 * Choosing Promises now costs one `await` per call and buys a drop-in
 * replacement later. This is the single highest-leverage decision in the
 * persistence design, and it is the reason the Sprint 2 migration is one line
 * in the composition root rather than a refactor.
 *
 * ---------------------------------------------------------------------------
 * IMPLEMENTATIONS (infrastructure/persistence/)
 *   InMemoryAnnotationRepository      unit tests; fast and disposable
 *   LocalStorageAnnotationRepository  Sprint 1 default; survives page reload
 *   HttpAnnotationRepository          Sprint 2; talks to the Go API
 *
 * Adding one is a new file plus one line in ServiceContainer. No existing code
 * changes.
 */
export class AnnotationRepository {
  static REQUIRED = ['listBySheet', 'save', 'delete', 'clearSheet'];

  constructor() {
    enforceContract(this, new.target, AnnotationRepository);
  }

  /**
   * All annotations on one sheet, in creation order.
   * Returns an empty array for an unknown sheet — absence is not an error.
   *
   * @param {string} sheetId
   * @returns {Promise<import('../annotations/Annotation').Annotation[]>}
   */
  listBySheet(sheetId) {
    return abstractMethod('AnnotationRepository', 'listBySheet', sheetId);
  }

  /**
   * Inserts or replaces by id (upsert).
   *
   * Upsert rather than separate create/update because the Sprint 3 offline
   * outbox will replay queued writes that may or may not already exist on the
   * server. Idempotent writes make that replay safe to retry blindly, which is
   * what you want from a device that just came back online in a stairwell.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @returns {Promise<void>}
   */
  save(annotation) {
    return abstractMethod('AnnotationRepository', 'save', annotation);
  }

  /**
   * Removes by id. Deleting something already gone is NOT an error — same
   * idempotency requirement as `save`.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  delete(id) {
    return abstractMethod('AnnotationRepository', 'delete', id);
  }

  /**
   * Removes every annotation on a sheet.
   * @param {string} sheetId
   * @returns {Promise<void>}
   */
  clearSheet(sheetId) {
    return abstractMethod('AnnotationRepository', 'clearSheet', sheetId);
  }
}
