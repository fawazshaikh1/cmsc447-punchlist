import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — what a project's admins can bring back (spec 8.2): every markup
 * deleted in the last 30 days, as it was when it went.
 *
 * Read-only on purpose. Restoring is an ordinary create through EditorService,
 * so it is checked, recorded and undoable like any other; the server forgets
 * its copy as soon as the markup is saved again.
 */
export class TrashRepository {
  static REQUIRED = ['list'];

  constructor() {
    enforceContract(this, new.target, TrashRepository);
  }

  /**
   * @param {number} projectId
   * @returns {Promise<import('../reversals/DeletedItem').DeletedItem[]>} Newest first.
   */
  async list(projectId) {
    return abstractMethod('TrashRepository', 'list', projectId);
  }
}
