import { ChangeRecord } from '../../domain/audit/ChangeRecord';
import { Actor } from '../../domain/identity/Actor';
import { TaskRepository } from '../../domain/ports/TaskRepository';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * The Tasks tab's project-wide reads, from the Go API (backend/tasks.go).
 *
 *   GET /api/projects/{id}/sealed            [markup id]
 *   GET /api/projects/{id}/changes/latest    { markup id: change }
 *   GET /api/annotations/{id}/changes        [change], newest first
 */
export class HttpTaskRepository extends TaskRepository {
  /**
   * @param {string} baseUrl e.g. '/api'.
   * @param {typeof fetch} [fetchFn]
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async sealedIds(projectId) {
    const ids = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/sealed`);
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  }

  async latestChanges(projectId) {
    const byId = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/changes/latest`);
    const latest = new Map();
    for (const [annotationId, row] of Object.entries(byId ?? {})) {
      const record = decode(row);
      if (record) latest.set(annotationId, record);
    }
    return latest;
  }

  async historyFor(annotationId) {
    const rows = await this.http.getJson(`/annotations/${HttpJsonClient.segment(annotationId)}/changes`);
    return (Array.isArray(rows) ? rows : []).map(decode).filter(Boolean);
  }
}

/** A record the browser cannot read is left out rather than failing the list. */
function decode(row) {
  try {
    return ChangeRecord.fromJSON(row, Actor);
  } catch {
    return null;
  }
}
