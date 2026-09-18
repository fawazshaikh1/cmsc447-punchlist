import { ChangeLogRepository } from '../ports/ChangeLogRepository';

/**
 * Remembers nothing.
 *
 * The Null Object for the change log, and `EditorService`'s default. Without
 * it, every recording call site would need `if (this.changeLog)` — and the one
 * that eventually forgot would throw during a save, losing a user's edit
 * because a history feature was not configured.
 *
 * With it, the service records unconditionally and a caller that does not want
 * history simply gets none. A test that is not asserting on history passes this
 * and reads no differently from one that is.
 */
export class NullChangeLog extends ChangeLogRepository {
  async record() {
    // Deliberately nothing.
  }

  async listForAnnotation() {
    return [];
  }

  async latestBySheet() {
    return new Map();
  }
}
