import { RevisionRepository } from '../../domain/ports/RevisionRepository';
import { RevisionLink } from '../../domain/revisions';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * A project's drawing revisions, from the Go API (backend/revisions.go).
 *
 *   GET /api/projects/{id}/revisions                                   [link]
 *   PUT /api/projects/{id}/documents/{doc}/revision-of/{previous}      admins
 */
export class HttpRevisionRepository extends RevisionRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async list(projectId) {
    const rows = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/revisions`);
    return (Array.isArray(rows) ? rows : []).map((row) => RevisionLink.fromJSON(row));
  }

  async link(projectId, documentId, previousId) {
    const project = HttpJsonClient.segment(projectId);
    await this.http.sendJson(
      'PUT',
      `/projects/${project}/documents/${HttpJsonClient.segment(documentId)}/revision-of/${HttpJsonClient.segment(previousId)}`,
    );
  }
}
