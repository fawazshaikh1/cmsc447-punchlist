import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — a project's issued PDFs, and voiding one (spec 8.3).
 *
 * Voiding is the only way a lock is ever lifted, so it is an admin's, needs a
 * reason, and leaves the issue in the log marked void.
 */
export class IssueRepository {
  static REQUIRED = ['list', 'void'];

  constructor() {
    enforceContract(this, new.target, IssueRepository);
  }

  /**
   * @param {number} projectId
   * @returns {Promise<import('../reversals/IssueRecord').IssueRecord[]>} Newest first.
   */
  async list(projectId) {
    return abstractMethod('IssueRepository', 'list', projectId);
  }

  /**
   * Unlocks every markup this issue locked, unless a later issue also holds it.
   * @param {string} exportId
   * @param {string} reason Why — kept with the void.
   * @returns {Promise<void>}
   */
  async void(exportId, reason) {
    return abstractMethod('IssueRepository', 'void', exportId, reason);
  }
}
