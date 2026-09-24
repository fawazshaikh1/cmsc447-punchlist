import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — the append-only record of who changed what.
 *
 * ===========================================================================
 * APPEND-ONLY IS EXPRESSED IN THE INTERFACE, NOT IN A COMMENT
 * ===========================================================================
 * There is no `update` and no `delete`. History that can be rewritten is not
 * history, and the cheapest way to guarantee that is to give callers no way to
 * try. In Sprint 2 this maps to a Postgres table with INSERT and SELECT grants
 * only — the same rule enforced one level down.
 *
 * `latestBySheet` exists as its own method rather than leaving callers to fold
 * over `listForAnnotation`, because "last updated and by whom, visible without
 * opening anything" (D14) is asked for every markup on a sheet at once. As a
 * single call it is one read here and one indexed query in SQL; as a fold it
 * would be eighty round trips on a busy sheet.
 */
export class ChangeLogRepository {
  static REQUIRED = ['record', 'listForAnnotation', 'latestBySheet'];

  constructor() {
    enforceContract(this, new.target, ChangeLogRepository);
  }

  /**
   * Appends one change. Never overwrites.
   * @param {import('../audit/ChangeRecord').ChangeRecord} change
   * @returns {Promise<void>}
   */
  async record(change) {
    return abstractMethod('ChangeLogRepository', 'record', change);
  }

  /**
   * The full history of one annotation, newest first.
   * @param {string} sheetId
   * @param {string} annotationId
   * @returns {Promise<import('../audit/ChangeRecord').ChangeRecord[]>}
   */
  async listForAnnotation(sheetId, annotationId) {
    return abstractMethod('ChangeLogRepository', 'listForAnnotation', annotationId);
  }

  /**
   * The most recent change to each annotation on a sheet.
   * @param {string} sheetId
   * @returns {Promise<Map<string, import('../audit/ChangeRecord').ChangeRecord>>}
   *          Keyed by annotation id.
   */
  async latestBySheet(sheetId) {
    return abstractMethod('ChangeLogRepository', 'latestBySheet', sheetId);
  }
}
