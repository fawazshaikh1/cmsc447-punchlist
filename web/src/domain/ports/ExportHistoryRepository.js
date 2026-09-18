import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — where the record of past exports is kept.
 *
 * ===========================================================================
 * WHY THIS IS SEPARATE FROM AnnotationRepository
 * ===========================================================================
 * The two have opposite lifecycles. Annotations are edited and deleted all day.
 * Export records are written once and never changed — they are history, and
 * history that can be edited is not history.
 *
 * Keeping them apart means the append-only rule is visible in the interface
 * (there is no `update` and no `delete`) rather than being a convention someone
 * has to remember. In Sprint 2 this maps to its own Postgres table with no
 * UPDATE grant, which is the same guarantee enforced a level lower.
 *
 * Every method is async for the reason given in AnnotationRepository: local
 * storage is synchronous and the Go API will not be, and a signature that
 * changes later forces every caller to change with it.
 */
export class ExportHistoryRepository {
  static REQUIRED = ['record', 'listForDocument', 'sealedIdsForSheet'];

  constructor() {
    enforceContract(this, new.target, ExportHistoryRepository);
  }

  /**
   * Appends one export to the history. Never overwrites.
   * @param {import('../export/ExportRecord').ExportRecord} exportRecord
   * @returns {Promise<void>}
   */
  async record(exportRecord) {
    return abstractMethod('ExportHistoryRepository', 'record', exportRecord);
  }

  /**
   * @param {string} documentName
   * @returns {Promise<import('../export/ExportRecord').ExportRecord[]>}
   *          Newest first.
   */
  async listForDocument(documentName) {
    return abstractMethod('ExportHistoryRepository', 'listForDocument', documentName);
  }

  /**
   * Every annotation id on this sheet that a flattened export has made
   * permanent.
   *
   * A dedicated method rather than making callers fold over listForDocument,
   * because this is the hot question — asked whenever a sheet opens — and
   * because it lets a SQL implementation answer it with an index instead of
   * shipping the whole history to the browser.
   *
   * @param {string} documentName
   * @param {string} sheetId
   * @returns {Promise<Set<string>>}
   */
  async sealedIdsForSheet(documentName, sheetId) {
    return abstractMethod('ExportHistoryRepository', 'sealedIdsForSheet', sheetId);
  }
}
