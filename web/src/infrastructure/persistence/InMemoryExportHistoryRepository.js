import { ExportHistoryRepository } from '../../domain/ports/ExportHistoryRepository';

/**
 * Export history held in a Map. For tests and for Storybook-style harnesses.
 *
 * Exists for the same reason InMemoryAnnotationRepository does: a unit test of
 * the sealing rules should not need a browser, a `localStorage` stub, or any
 * knowledge of how records are serialised. Constructing one of these and
 * calling `record` is the whole setup.
 */
export class InMemoryExportHistoryRepository extends ExportHistoryRepository {
  /**
   * @param {import('../../domain/export/ExportRecord').ExportRecord[]} [seed]
   *        Pre-existing history, for test arrangement.
   */
  constructor(seed = []) {
    super();
      /**
     * @type {Map<string, import('../../domain/export/ExportRecord').ExportRecord[]>}
     *       documentName -> records
     */
    this.byDocument = new Map();
    seed.forEach((record) => this.record(record));
  }

  async record(exportRecord) {
    const rows = this.byDocument.get(exportRecord.documentName) ?? [];
    rows.push(exportRecord);
    this.byDocument.set(exportRecord.documentName, rows);
  }

  async listForDocument(documentName) {
    return [...(this.byDocument.get(documentName) ?? [])].sort((a, b) =>
      b.exportedAt.localeCompare(a.exportedAt),
    );
  }

  async sealedIdsForSheet(documentName, sheetId) {
    const sealed = new Set();
    for (const record of await this.listForDocument(documentName)) {
      if (!record.seals) continue;
      for (const id of record.idsForSheet(sheetId)) sealed.add(id);
    }
    return sealed;
  }
}
