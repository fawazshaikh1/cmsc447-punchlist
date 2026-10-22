import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — the signed-in person's projects, and who is on each.
 *
 * Every method acts as the signed-in person. Whether they are allowed to is
 * the server's decision (an admin manages people; anyone may see who is on a
 * project they are on), and a refusal arrives as a thrown error carrying the
 * server's explanation.
 */
export class ProjectRepository {
  static REQUIRED = ['list', 'create', 'members', 'setMember', 'removeMember', 'items'];

  constructor() {
    enforceContract(this, new.target, ProjectRepository);
  }

  /** @returns {Promise<import('../projects/Project').Project[]>} */
  async list() {
    return abstractMethod('ProjectRepository', 'list');
  }

  /**
   * Starts a project. Whoever creates it is its admin.
   * @param {string} name
   * @returns {Promise<import('../projects/Project').Project>}
   */
  async create(name) {
    return abstractMethod('ProjectRepository', 'create', name);
  }

  /**
   * @param {number} projectId
   * @returns {Promise<import('../projects/Member').Member[]>}
   */
  async members(projectId) {
    return abstractMethod('ProjectRepository', 'members', projectId);
  }

  /**
   * Adds the account with this email to the project, or changes its role.
   * @param {number} projectId
   * @param {string} email
   * @param {string} role One of ProjectRole.
   * @returns {Promise<import('../projects/Member').Member>}
   */
  async setMember(projectId, email, role) {
    return abstractMethod('ProjectRepository', 'setMember', projectId, email, role);
  }

  /**
   * @param {number} projectId
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async removeMember(projectId, userId) {
    return abstractMethod('ProjectRepository', 'removeMember', projectId, userId);
  }

  /**
   * Every markup in the project, on every drawing — for the punch list.
   * In sheet order, and in the order each sheet lists them, so numbering
   * them gives the numbers the pins show.
   *
   * @param {number} projectId
   * @returns {Promise<import('../annotations/Annotation').Annotation[]>}
   */
  async items(projectId) {
    return abstractMethod('ProjectRepository', 'items', projectId);
  }
}
