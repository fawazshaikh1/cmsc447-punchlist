import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — where comments and replies on items are kept (spec 7.1).
 */
export class CommentRepository {
  static REQUIRED = ['listFor', 'post', 'counts'];

  constructor() {
    enforceContract(this, new.target, CommentRepository);
  }

  /**
   * @param {string} annotationId
   * @returns {Promise<import('../comments/Comment').Comment[]>} Every comment
   *          on the item, on every sheet it has been on.
   */
  async listFor(annotationId) {
    return abstractMethod('CommentRepository', 'listFor', annotationId);
  }

  /**
   * Says something about an item. The author is whoever is signed in — the
   * server decides, not the browser.
   *
   * @param {{ sheetId: string, annotationId: string, text: string, replyTo?: string }} comment
   * @returns {Promise<void>}
   */
  async post(comment) {
    return abstractMethod('CommentRepository', 'post', comment);
  }

  /**
   * @param {number} projectId
   * @returns {Promise<Map<string, number>>} How many comments each item has.
   */
  async counts(projectId) {
    return abstractMethod('CommentRepository', 'counts', projectId);
  }
}
