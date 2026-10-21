import { isProjectRole, ProjectRole } from './ProjectRole';
import { SheetScope } from './SheetScope';

/**
 * A project as the signed-in person sees it: its name, and their role on it.
 *
 * The role travels with the project rather than with the person because it is
 * a fact about the pair — see ProjectRole.
 */
export class Project {
  /**
   * @param {object} fields
   * @param {number} fields.id
   * @param {string} fields.name
   * @param {string} fields.role This person's role on it.
   */
  constructor({ id, name, role }) {
    if (!Number.isInteger(id) || id < 1) throw new TypeError('A project needs a positive whole-number id.');
    if (typeof name !== 'string' || name.trim() === '') throw new TypeError('A project needs a name.');
    if (!isProjectRole(role)) throw new TypeError(`Unknown project role "${role}".`);

    this.id = id;
    this.name = name;
    this.role = role;
    Object.freeze(this);
  }

  /** Whether this person may add people and change their roles. */
  get canManagePeople() {
    return this.role === ProjectRole.ADMIN;
  }

  /** How this project's sheets are named — see SheetScope. */
  get sheetScope() {
    return SheetScope.forProject(this.id);
  }

  /** @param {{id: number, name: string, role: string}} dto */
  static fromJSON(dto) {
    return new Project({ id: dto.id, name: dto.name, role: dto.role });
  }
}
