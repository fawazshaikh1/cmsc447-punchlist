import { IssueRepository } from '../../domain/ports/IssueRepository';
import { IssueRecord } from '../../domain/reversals';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * A project's issues and voiding one, from the Go API (backend/reversals.go).
 *
 *   GET  /api/projects/{id}/issues     [issue], newest first
 *   POST /api/exports/{id}/void        { reason }
 */
export class HttpIssueRepository extends IssueRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async list(projectId) {
    const rows = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/issues`);
    return (Array.isArray(rows) ? rows : []).map((row) => IssueRecord.fromJSON(row));
  }

  async void(exportId, reason) {
    await this.http.postJson(`/exports/${HttpJsonClient.segment(exportId)}/void`, { reason: String(reason).trim() });
  }
}
