import { Actor } from '../../domain/identity/Actor';
import { ChangeRecord } from '../../domain/audit/ChangeRecord';
import { ChangeLogRepository } from '../../domain/ports/ChangeLogRepository';

const STORAGE_PREFIX = 'punchlist.changelog.';

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
 * Change log backed by `localStorage`. **The Sprint 1 default.**
 *
 * Partitioned by sheet, matching how it is read: the panel asks "who last
 * touched each markup on THIS sheet", and a sheet's log is one key.
 *
 * ---------------------------------------------------------------------------
 * A CAP, WHICH THE OTHER REPOSITORIES DO NOT HAVE
 * ---------------------------------------------------------------------------
 * Annotations are bounded by how many a person can draw. Change records are
 * not: every move during a drag-to-reposition is a change, and a busy sheet can
 * accumulate them faster than markups. With ~5MB per origin shared across every
 * sheet AND the annotations themselves, an uncapped log would eventually throw
 * a quota error on a SAVE — turning a history feature into data loss.
 *
 * So the log keeps the newest `MAX_PER_SHEET` entries. That is a real
 * limitation and it is the strongest argument for moving this to Postgres in
 * Sprint 2, where the table is append-only and nothing is discarded.
 *
 * The cap is safe for the one thing the interface promises today —
 * last-updated-and-by-whom — because that is always the newest entry, which is
 * the one never discarded.
 */
export class LocalStorageChangeLogRepository extends ChangeLogRepository {
  /** Roughly a long session on one sheet. Tuned to stay well inside quota. */
  static MAX_PER_SHEET = 500;

  /** @param {Storage} [storage] Injectable so tests can pass a fake. */
  constructor(storage = window.localStorage) {
    super();
    this.storage = storage;
  }

  /** @param {ChangeRecord} change */
  async record(change) {
    const rows = this.#read(change.sheetId);
    rows.push(change.toJSON());

    // Drop the OLDEST when over the cap. See the class comment for why a cap
    // exists at all and why losing the oldest is the right end to lose.
    const capped = rows.slice(-LocalStorageChangeLogRepository.MAX_PER_SHEET);

    this.#write(change.sheetId, capped);
  }

  async listForAnnotation(sheetId, annotationId) {
    return newestFirst(
      this.#read(sheetId)
        .filter((row) => row.annotationId === annotationId)
        .map((row) => this.#tryFromJSON(row))
        .filter((record) => record !== null),
    );
  }

  async latestBySheet(sheetId) {
    /** @type {Map<string, ChangeRecord>} */
    const latest = new Map();

    for (const row of this.#read(sheetId)) {
      const record = this.#tryFromJSON(row);
      if (!record) continue;

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

  // --- internals ----------------------------------------------------------

  /**
   * A row we cannot decode is skipped rather than thrown on.
   *
   * Losing one history entry is a small, contained harm — unlike an unreadable
   * EXPORT record, which would un-seal something. No alarm is raised for the
   * same reason: this is the least load-bearing data in the application.
   */
  #tryFromJSON(dto) {
    try {
      return ChangeRecord.fromJSON(dto, Actor);
    } catch {
      return null;
    }
  }

  #read(sheetId) {
    try {
      const raw = this.storage.getItem(STORAGE_PREFIX + sheetId);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #write(sheetId, rows) {
    try {
      this.storage.setItem(STORAGE_PREFIX + sheetId, JSON.stringify(rows));
    } catch {
      // SWALLOWED, and this is the one place in the codebase where that is
      // right. The caller has already saved the user's actual work; failing
      // the whole edit because we could not also write a history line would
      // trade something valuable for something incidental.
      //
      // Deliberately silent rather than logged: it would fire on every
      // subsequent edit once storage is full, burying anything useful.
    }
  }
}
