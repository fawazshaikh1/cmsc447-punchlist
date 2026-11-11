import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — each person's starred sheets in a project, on every device
 * (spec 7.2). A bookmark is a sheet id; what the sheet is called comes from
 * the sheet names, so a rename shows in the bookmarks too.
 */
export class BookmarkRepository {
  static REQUIRED = ['list', 'add', 'remove'];

  constructor() {
    enforceContract(this, new.target, BookmarkRepository);
  }

  /** @param {number} projectId @returns {Promise<string[]>} Sheet ids, oldest first. */
  async list(projectId) {
    return abstractMethod('BookmarkRepository', 'list', projectId);
  }

  /** @param {number} projectId @param {string} sheetId @returns {Promise<void>} */
  async add(projectId, sheetId) {
    return abstractMethod('BookmarkRepository', 'add', projectId, sheetId);
  }

  /** @param {number} projectId @param {string} sheetId @returns {Promise<void>} */
  async remove(projectId, sheetId) {
    return abstractMethod('BookmarkRepository', 'remove', projectId, sheetId);
  }
}
