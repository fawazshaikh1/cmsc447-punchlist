import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — what the Tasks tab reads about a whole project, beyond its items
 * (spec 6.4, 6.5): which tasks an issue has locked on any drawing, who last
 * changed each one, and one task's history on every sheet it has been on.
 *
 * The sheet editor asks these questions of one sheet through
 * ExportHistoryRepository and ChangeLogRepository. The Tasks tab spans every
 * drawing at once, and asking sheet by sheet would be a request per page.
 */
export class TaskRepository {
  static REQUIRED = ['sealedIds', 'latestChanges', 'historyFor'];

  constructor() {
    enforceContract(this, new.target, TaskRepository);
  }

  /**
   * @param {number} projectId
   * @returns {Promise<Set<string>>} Every markup in the project an issued PDF has locked.
   */
  async sealedIds(projectId) {
    return abstractMethod('TaskRepository', 'sealedIds', projectId);
  }

  /**
   * @param {number} projectId
   * @returns {Promise<Map<string, import('../audit/ChangeRecord').ChangeRecord>>}
   *          The newest change to each markup, by markup id.
   */
  async latestChanges(projectId) {
    return abstractMethod('TaskRepository', 'latestChanges', projectId);
  }

  /**
   * @param {string} annotationId
   * @returns {Promise<import('../audit/ChangeRecord').ChangeRecord[]>} Newest
   *          first, across every sheet the item has been on.
   */
  async historyFor(annotationId) {
    return abstractMethod('TaskRepository', 'historyFor', annotationId);
  }
}
