import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — where a project's sheet names are kept, so every device shows the
 * same "A-101" for the same page (spec 5.2).
 *
 * Names are filed by DRAWING NAME, not by drawing id: a drawing is known by
 * its name within a project (its sheets are named after it), and the punch
 * list, which spans drawings, only ever has the name to hand.
 */
export class SheetNameRepository {
  static REQUIRED = ['listForProject', 'save'];

  constructor() {
    enforceContract(this, new.target, SheetNameRepository);
  }

  /**
   * Every drawing's names in a project.
   * @param {number} projectId
   * @returns {Promise<Map<string, import('../sheets/SheetNames').SheetNames>>} By drawing name.
   */
  async listForProject(projectId) {
    return abstractMethod('SheetNameRepository', 'listForProject', projectId);
  }

  /**
   * Saves names for one drawing: a reading of its title blocks ('detected',
   * which only fills pages without a name) or an admin's rename ('edited',
   * which replaces).
   *
   * @param {number} projectId
   * @param {string} documentName
   * @param {{ source: string, names: import('../sheets/SheetName').SheetName[] }} change
   * @returns {Promise<import('../sheets/SheetNames').SheetNames>} The drawing's
   *          names as they now stand.
   */
  async save(projectId, documentName, change) {
    return abstractMethod('SheetNameRepository', 'save', projectId, documentName, change);
  }
}
