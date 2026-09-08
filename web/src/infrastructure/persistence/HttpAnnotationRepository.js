import { AnnotationRegistry } from '../../domain/annotations/AnnotationRegistry';
import { AnnotationRepository } from '../../domain/ports/AnnotationRepository';

/**
 * Repository backed by the Go API. TIER 3.
 *
 * ===========================================================================
 * NOT WIRED IN SPRINT 1 — the API does not exist yet.
 * ===========================================================================
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
  constructor(baseUrl, fetchFn = globalThis.fetch.bind(globalThis)) {
    super();
    this.baseUrl = baseUrl;
    this.fetchFn = fetchFn;
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
    const response = await this.fetchFn(`${this.baseUrl}${path}`, init);
    if (!response.ok && !tolerate.includes(response.status)) {
      throw new Error(
        `${init?.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText}`,
      );
    }
    return response;
  }
}
