import { ExportRecord } from '../../domain/export/ExportRecord';
import { ExportHistoryRepository } from '../../domain/ports/ExportHistoryRepository';
import { HttpJsonClient } from './HttpJsonClient';

/**
 * Export history kept by the Go API, in Postgres. TIER 3.
 *
 * ---------------------------------------------------------------------------
 * ENDPOINT CONTRACT (backend/history.go)
 * ---------------------------------------------------------------------------
 *   POST /api/exports                                  -> 204, append only
 *   GET  /api/exports?document=NAME                    -> 200 [record], newest first
 *   GET  /api/exports/sealed?document=NAME&sheetId=ID  -> 200 [annotationId]
 *
 * `sealedIdsForSheet` is answered by the server rather than by folding over
 * the whole history here: it is asked every time a sheet opens, and the
 * server answers it from an index without sending every export to the browser.
 *
 * ---------------------------------------------------------------------------
 * WHY A FAILED READ IS NOT SWALLOWED HERE
 * ---------------------------------------------------------------------------
 * The local-storage version skips an unreadable row. This one lets a failed
 * REQUEST throw. If the sealed-ids call failed and this returned an empty set,
 * every issued markup would quietly become editable — the lock failing open.
 * Throwing reaches the error banner instead, where someone can see it.
 */
export class HttpExportHistoryRepository extends ExportHistoryRepository {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  /** @param {ExportRecord} exportRecord */
  async record(exportRecord) {
    await this.http.postJson('/exports', exportRecord.toJSON());
  }

  async listForDocument(documentName) {
    const rows = await this.http.getJson(`/exports?document=${encodeURIComponent(documentName)}`);
    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        try {
          return ExportRecord.fromJSON(row);
        } catch (error) {
          console.error('[punchlist] Skipping an unreadable export record from the server.', { row, error });
          return null;
        }
      })
      .filter(Boolean);
  }

  async sealedIdsForSheet(documentName, sheetId) {
    const ids = await this.http.getJson(
      `/exports/sealed?document=${encodeURIComponent(documentName)}&sheetId=${encodeURIComponent(sheetId)}`,
    );
    return new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string'));
  }
}
