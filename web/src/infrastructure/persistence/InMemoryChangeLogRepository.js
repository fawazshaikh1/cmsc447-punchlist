import { ChangeLogRepository } from '../../domain/ports/ChangeLogRepository';

/**
 * Newest first, with ties broken by the order the records were written.
 *
 * ISO timestamps only resolve to the millisecond, and several changes routinely
 * land inside one: adding a pin and immediately dragging it, or clearing a
 * sheet, which records every removal in a tight loop. Sorting on the timestamp
 * alone leaves those in an arbitrary order, so "the most recent change" — the
 * one the panel shows and the one an undo has to appear above — could be any of
 * them.
 *
 * The append order is the tiebreak, because it is the real order. Both adapters
 * preserve it; a SQL implementation must ORDER BY (at DESC, id DESC) for the
 * same reason.
 *
 * @param {Array} records In the order they were appended.
 */
function newestFirst(records) {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => b.record.at.localeCompare(a.record.at) || b.index - a.index)
    .map(({ record }) => record);
}


/**
 * Change log held in a Map. For tests and harnesses.
 *
 * No cap, unlike the localStorage version — a test that needs to assert on
 * every recorded change should not have to know a retention rule exists.
 */
export class InMemoryChangeLogRepository extends ChangeLogRepository {
  constructor() {
    super();
    /** @type {Map<string, import('../../domain/audit/ChangeRecord').ChangeRecord[]>} */
    this.bySheet = new Map();
  }

  async record(change) {
    const rows = this.bySheet.get(change.sheetId) ?? [];
    rows.push(change);
    this.bySheet.set(change.sheetId, rows);
  }

  async listForAnnotation(sheetId, annotationId) {
    return newestFirst(
      (this.bySheet.get(sheetId) ?? []).filter(
        (record) => record.annotationId === annotationId,
      ),
    );
  }

  async latestBySheet(sheetId) {
    const latest = new Map();

    for (const record of this.bySheet.get(sheetId) ?? []) {
      const held = latest.get(record.annotationId);
      // `>=`, not `>`: two changes inside the same millisecond share a
      // timestamp, and ISO strings have no finer resolution. Placing a pin and
      // immediately dragging it does exactly that on a fast machine — and with
      // `>` the panel would report "added" as the most recent thing that
      // happened to a markup the user had just moved.
      //
      // Rows are iterated in the order they were appended, so `>=` makes the
      // later write win a tie, which is the truth. Both adapters preserve that
      // order; a SQL implementation must ORDER BY (at, id) for the same reason.
      if (!held || record.at >= held.at) latest.set(record.annotationId, record);
    }

    return latest;
  }
}
