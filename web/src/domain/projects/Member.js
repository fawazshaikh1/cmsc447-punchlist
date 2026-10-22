import { isProjectRole } from './ProjectRole';

/**
 * One person on a project, as the members list shows them.
 *
 * Email is included because it is how an admin added them and how they would
 * be told apart from someone with the same name at another company.
 */
export class Member {
  /**
   * @param {object} fields
   * @param {string} fields.userId
   * @param {string} fields.email
   * @param {string} fields.displayName
   * @param {string} [fields.company]
   * @param {string} [fields.title]
   * @param {string} fields.role
   */
  constructor({ userId, email, displayName, company = '', title = '', role }) {
    if (typeof userId !== 'string' || userId === '') throw new TypeError('A member needs a user id.');
    if (!isProjectRole(role)) throw new TypeError(`Unknown project role "${role}".`);

    this.userId = userId;
    this.email = email;
    this.displayName = displayName;
    this.company = company;
    this.title = title;
    this.role = role;
    Object.freeze(this);
  }

  /** `Name (Company)` — the same form Actor uses beside a change. */
  toString() {
    return this.company ? `${this.displayName} (${this.company})` : this.displayName;
  }

  static fromJSON(dto) {
    return new Member(dto);
  }
}
