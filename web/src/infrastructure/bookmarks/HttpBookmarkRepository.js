import { BookmarkRepository } from '../../domain/ports/BookmarkRepository';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Starred sheets kept by the Go API (backend/bookmarks.go).
 *
 *   GET    /api/projects/{id}/bookmarks           [{ sheetId, createdAt }]
 *   PUT    /api/projects/{id}/bookmarks/{sheet}   star
 *   DELETE /api/projects/{id}/bookmarks/{sheet}   unstar
 */
export class HttpBookmarkRepository extends BookmarkRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async list(projectId) {
    const rows = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/bookmarks`);
    return (Array.isArray(rows) ? rows : []).map((row) => row?.sheetId).filter((id) => typeof id === 'string');
  }

  async add(projectId, sheetId) {
    await this.http.sendJson('PUT', this.#path(projectId, sheetId));
  }

  async remove(projectId, sheetId) {
    await this.http.sendJson('DELETE', this.#path(projectId, sheetId));
  }

  #path(projectId, sheetId) {
    return `/projects/${HttpJsonClient.segment(projectId)}/bookmarks/${HttpJsonClient.segment(sheetId)}`;
  }
}
