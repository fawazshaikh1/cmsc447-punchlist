import { AnnotationRegistry } from '../../domain/annotations/AnnotationRegistry';
import { AnnotationRepository } from '../../domain/ports/AnnotationRepository';
import { HttpJsonClient } from './HttpJsonClient';

/**
 * Repository backed by the Go API. TIER 3.
 *
 * ===========================================================================
 * WIRED WHEN `VITE_API_BASE` IS SET (SCRUM-41) — see ServiceContainer.
 * ===========================================================================
 * Written in Sprint 1, before the API existed, and unchanged in what it sends:
 * the Go service was built to the contract below.
 *
 * It is written now, and fully implemented rather than stubbed, because it is
 * the concrete proof that the contract abstraction pays for itself. Switching
 * the entire application from local storage to the server is one line in
 * ServiceContainer.jsx:
 *
 *     - new LocalStorageAnnotationRepository()
 *     + new HttpAnnotationRepository('/api')
 *
 * No component, no hook, no domain class changes. That is the "add, don't
 * modify" property stated as a diff rather than as a promise.
 *
 * ---------------------------------------------------------------------------
 * ENDPOINT CONTRACT expected of the Go service
 * ---------------------------------------------------------------------------
 * Agree this with whoever owns the backend BEFORE they build it — the payload
 * shape is already fixed by `Annotation.toJSON()` and by what localStorage is
 * writing today, so there is nothing left to negotiate:
 *
 *   GET    /api/sheets/{sheetId}/annotations  -> 200 [ {id,sheetId,kind,createdAt,x,y,payload} ]
 *   PUT    /api/annotations/{id}              -> 204   (upsert, idempotent)
 *   DELETE /api/annotations/{id}              -> 204   (404 tolerated)
 *   DELETE /api/sheets/{sheetId}/annotations  -> 204
 *
 * PUT rather than POST for saves, keyed by a client-generated id: see
 * IdGenerator for why identity is assigned on the client, and
 * AnnotationRepository for why idempotency matters to the offline outbox.
 *
 * Postgres note: store `payload` as `jsonb` and the rest as real columns. That
 * is what lets a new markup type ship without a migration.
 */
export class HttpAnnotationRepository extends AnnotationRepository {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, fetchFn) {
    super();
    // Shared with the change-log and export-history repositories, so all
    // three report "Cannot reach the Punch List server" the same way rather
    // than a bare "Failed to fetch" when the backend is not running.
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async listBySheet(sheetId) {
    const response = await this.#request(`/sheets/${encodeURIComponent(sheetId)}/annotations`);
    const rows = await response.json();
    return rows
      .map((dto) => AnnotationRegistry.tryFromJSON(dto))
      .filter((annotation) => annotation !== null);
  }

  async save(annotation) {
    await this.#request(`/annotations/${encodeURIComponent(annotation.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(annotation.toJSON()),
    });
  }

  async delete(id) {
    await this.#request(`/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' }, [404]);
  }

  async clearSheet(sheetId) {
    await this.#request(`/sheets/${encodeURIComponent(sheetId)}/annotations`, { method: 'DELETE' });
  }

  /**
   * @param {number[]} [tolerate] Status codes treated as success. Used so that
   *        deleting an already-deleted annotation is a no-op, matching the
   *        contract and keeping outbox replay safe to retry.
   */
  async #request(path, init, tolerate = []) {
    return this.http.request(path, init, tolerate);
  }
}
