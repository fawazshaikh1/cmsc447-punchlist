import { ExportRecord } from '../../domain/export/ExportRecord';
import { ExportHistoryRepository } from '../../domain/ports/ExportHistoryRepository';

const STORAGE_PREFIX = 'punchlist.exports.';

/**
 * Export history backed by `localStorage`. **The Sprint 1 default.**
 *
 * ---------------------------------------------------------------------------
 * WHY THE SEAL MUST BE PERSISTED AND NOT HELD IN MEMORY
 * ---------------------------------------------------------------------------
 * The whole promise is "once this has been issued, it cannot be changed". A
 * lock that a page refresh clears is not a lock — and a refresh is exactly what
 * happens when someone reopens the drawing on Monday morning. So it goes to the
 * same store the annotations do, under its own key prefix, and it is read back
 * whenever a sheet opens.
 *
 * ---------------------------------------------------------------------------
 * PARTITIONED BY DOCUMENT, NOT BY SHEET
 * ---------------------------------------------------------------------------
 * One export covers the whole drawing set, so writing it once per document is
 * both truthful and cheap. A 153-page set that has been issued four times is
 * four rows, not six hundred. The per-sheet lookup that the editor needs is
 * then a narrow read of that one row.
 *
 * ---------------------------------------------------------------------------
 * APPEND-ONLY — enforced here, not merely intended
 * ---------------------------------------------------------------------------
 * There is no update and no delete. `record` pushes. That matches the port and
 * it matches what the data means: an export either happened or it did not, and
 * nothing that happens later changes that.
 */
export class LocalStorageExportHistoryRepository extends ExportHistoryRepository {
  /** @param {Storage} [storage] Injectable so tests can pass a fake. */
  constructor(storage = window.localStorage) {
    super();
    this.storage = storage;
  }

  /** @param {ExportRecord} exportRecord */
  async record(exportRecord) {
    const rows = this.#read(exportRecord.documentName);
    rows.push(exportRecord.toJSON());
    this.#write(exportRecord.documentName, rows);
  }

  async listForDocument(documentName) {
    return this.#read(documentName)
      .map((dto) => this.#tryFromJSON(dto))
      .filter((record) => record !== null)
      // Newest first, per the port. Sorting on read rather than trusting insert
      // order, because a Sprint 2 sync could append records out of sequence.
      .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
  }

  async sealedIdsForSheet(documentName, sheetId) {
    const sealed = new Set();

    for (const record of await this.listForDocument(documentName)) {
      // Native exports are working copies and seal nothing. The check lives on
      // ExportRecord so that "which modes seal?" is answered in one place.
      if (!record.seals) continue;
      for (const id of record.idsForSheet(sheetId)) sealed.add(id);
    }

    return sealed;
  }

  // --- internals ----------------------------------------------------------

  /**
   * A row we cannot decode is skipped rather than thrown on, matching the
   * annotation repository's reasoning: one bad row must not stop the drawing
   * from opening.
   *
   * The asymmetry with annotations is deliberate and worth stating. Skipping an
   * unreadable ANNOTATION loses a markup the user can redraw. Skipping an
   * unreadable EXPORT RECORD un-seals markups that were supposed to be
   * permanent — it fails OPEN. It is logged loudly for that reason, and it is
   * the main argument for moving this to Postgres in Sprint 2, where the schema
   * makes an undecodable row impossible.
   */
  #tryFromJSON(dto) {
    try {
      return ExportRecord.fromJSON(dto);
    } catch (error) {
      console.error(
        '[punchlist] Skipping an unreadable export record. Markups it sealed ' +
          'will appear editable again — this should be investigated.',
        { dto, error },
      );
      return null;
    }
  }

  #read(documentName) {
    try {
      const raw = this.storage.getItem(STORAGE_PREFIX + documentName);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #write(documentName, rows) {
    try {
      this.storage.setItem(STORAGE_PREFIX + documentName, JSON.stringify(rows));
    } catch (error) {
      // Unlike a failed annotation save, this one must be surfaced: the export
      // itself succeeded, so without this record the user is holding an issued
      // PDF whose markups this app still thinks are editable.
      throw new Error(
        'The PDF was created, but the record that seals those markups could ' +
          'not be saved (storage full or private browsing). They will still ' +
          'appear editable.',
        { cause: error },
      );
    }
  }
}
