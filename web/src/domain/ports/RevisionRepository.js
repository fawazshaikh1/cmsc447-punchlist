import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — which drawing in a project replaces which (SCRUM-90).
 */
export class RevisionRepository {
  static REQUIRED = ['list', 'link'];

  constructor() {
    enforceContract(this, new.target, RevisionRepository);
  }

  /**
   * @param {number} projectId
   * @returns {Promise<import('../revisions/RevisionLink').RevisionLink[]>} Oldest first.
   */
  async list(projectId) {
    return abstractMethod('RevisionRepository', 'list', projectId);
  }

  /**
   * Marks `documentId` as the revision that replaces `previousId`. Admins only.
   * @param {number} projectId @param {number} documentId @param {number} previousId
   * @returns {Promise<void>}
   */
  async link(projectId, documentId, previousId) {
    return abstractMethod('RevisionRepository', 'link', projectId, documentId, previousId);
  }
}
