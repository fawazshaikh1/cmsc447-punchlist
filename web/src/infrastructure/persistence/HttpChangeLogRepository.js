import { ChangeRecord } from '../../domain/audit/ChangeRecord';
import { Actor } from '../../domain/identity/Actor';
import { ChangeLogRepository } from '../../domain/ports/ChangeLogRepository';
import { HttpJsonClient } from './HttpJsonClient';

/**
 * Change history kept by the Go API, in Postgres. TIER 3.
 *
 * ---------------------------------------------------------------------------
 * ENDPOINT CONTRACT (backend/history.go)
 * ---------------------------------------------------------------------------
 *   POST /api/sheets/{sheetId}/changes                        -> 204, append only;
 *                                                               a repeated id is ignored
 *   GET  /api/sheets/{sheetId}/annotations/{id}/changes       -> 200 [record], newest first
 *   GET  /api/sheets/{sheetId}/changes/latest                 -> 200 { annotationId: record }
 *
 * Append-only on both sides: this class has no update or delete because the
 * port has none, and the server answers a repeated id with "already there"
 * rather than a second copy — so a retry after a dropped connection is safe.
 *
 * A row that cannot be decoded is skipped, matching the local-storage version:
 * losing one history line is a contained harm, and it must not stop a sheet
 * from opening.
 */
export class HttpChangeLogRepository extends ChangeLogRepository {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  /** @param {ChangeRecord} change */
  async record(change) {
    await this.http.postJson(`/sheets/${HttpJsonClient.segment(change.sheetId)}/changes`, change.toJSON());
  }

  async listForAnnotation(sheetId, annotationId) {
    const rows = await this.http.getJson(
      `/sheets/${HttpJsonClient.segment(sheetId)}/annotations/${HttpJsonClient.segment(annotationId)}/changes`,
    );
    return (Array.isArray(rows) ? rows : []).map(decode).filter(Boolean);
  }

  async latestBySheet(sheetId) {
    const byAnnotation = await this.http.getJson(`/sheets/${HttpJsonClient.segment(sheetId)}/changes/latest`);

    /** @type {Map<string, ChangeRecord>} */
    const latest = new Map();
    for (const [annotationId, row] of Object.entries(byAnnotation ?? {})) {
      const record = decode(row);
      if (record) latest.set(annotationId, record);
    }
    return latest;
  }
}

function decode(row) {
  try {
    return ChangeRecord.fromJSON(row, Actor);
  } catch {
    return null;
  }
}
