import { TrashRepository } from '../../domain/ports/TrashRepository';
import { DeletedItem } from '../../domain/reversals';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Recently deleted markups, from the Go API (backend/reversals.go).
 *
 *   GET /api/projects/{id}/trash   [markup + deletedAt, deletedBy, drawingRemoved]
 */
export class HttpTrashRepository extends TrashRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async list(projectId) {
    const rows = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/trash`);
    return (Array.isArray(rows) ? rows : []).map((row) => DeletedItem.fromJSON(row)).filter(Boolean);
  }
}
