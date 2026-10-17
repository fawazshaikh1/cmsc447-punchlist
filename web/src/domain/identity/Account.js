/**
 * The signed-in person's account: who they said they were when they
 * registered.
 *
 * Different from Actor, deliberately. An Account is the person; an Actor is
 * the person *on a project*, carrying the role they have there, and is what
 * gets written beside every change. The same Account is a different Actor on
 * each of their projects.
 */
export class Account {
  /**
   * @param {object} fields
   * @param {string} fields.id
   * @param {string} fields.email
   * @param {string} fields.displayName
   * @param {string} [fields.company]
   * @param {string} [fields.title]
   */
  constructor({ id, email, displayName, company = '', title = '' }) {
    if (typeof id !== 'string' || id === '') throw new TypeError('An account needs an id.');
    if (typeof email !== 'string' || !email.includes('@')) throw new TypeError('An account needs an email.');

    this.id = id;
    this.email = email;
    this.displayName = displayName;
    this.company = company;
    this.title = title;
    Object.freeze(this);
  }

  /** `Name (Company)`, matching Actor.toString(). */
  toString() {
    return this.company ? `${this.displayName} (${this.company})` : this.displayName;
  }

  static fromJSON(dto) {
    return new Account(dto);
  }
}
