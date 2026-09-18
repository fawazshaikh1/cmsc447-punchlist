/**
 * Whoever is doing the work.
 *
 * ===========================================================================
 * THIS EXISTS BEFORE SIGN-IN DOES, AND THAT IS THE POINT
 * ===========================================================================
 * Accounts are Sprint 2. But if the code only learns about users when accounts
 * arrive, then every place that records a change, checks a permission, or
 * stamps an export has to be found and edited at that moment — across services,
 * repositories, the audit log and the export history. That is the change nobody
 * has time for late in a semester, and the one most likely to be done in a
 * hurry and half-finished.
 *
 * So the concept lands now, with a single anonymous instance standing in. Every
 * code path already carries an actor, already writes it down, and already reads
 * it back. Sprint 2 swaps ONE adapter — `IdentityProvider` — and real names
 * start appearing in records that were already being written.
 *
 * ---------------------------------------------------------------------------
 * THE FIELDS ARE THE ONES THE STAKEHOLDER ASKED FOR
 * ---------------------------------------------------------------------------
 * They described self-registration with email, name, company and title, with
 * the project admin granting a role afterwards. `company` is here because their
 * punch lists are organised by responsible company, so it is display data, not
 * just account data — "J. Rivera (Apex Electrical)" is what a superintendent
 * needs to see next to an item.
 */
export class Actor {
  /**
   * @param {object} fields
   * @param {string} fields.id Stable identifier. A database id in Sprint 2.
   * @param {string} fields.displayName What appears beside a change.
   * @param {string} [fields.company] Employer, as given at registration.
   * @param {string} [fields.role] Project role: admin | power_collaborator |
   *        collaborator. Empty until an admin grants one. Read by
   *        RoleEditPolicy, which is written and waiting.
   */
  constructor({ id, displayName, company = '', role = '' }) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Actor requires a non-empty string id.');
    }

    this.id = id;
    this.displayName = displayName;
    this.company = company;
    this.role = role;
    Object.freeze(this);
  }

  /**
   * The stand-in used while nobody signs in.
   *
   * NOT null, deliberately. A null actor would mean every caller needs
   * `actor?.displayName` and a fallback string, and one of them would forget —
   * producing "undefined edited this item" in front of a stakeholder. A real
   * object with honest values keeps every call site unconditional, and the id
   * stays stable so Sprint 2 can recognise and migrate pre-account records.
   */
  static get ANONYMOUS() {
    return ANONYMOUS;
  }

  /** True when this is the placeholder rather than a signed-in person. */
  get isAnonymous() {
    return this.id === ANONYMOUS_ID;
  }

  /** `Name (Company)`, or just the name. What the interface shows. */
  toString() {
    return this.company ? `${this.displayName} (${this.company})` : this.displayName;
  }

  toJSON() {
    return {
      id: this.id,
      displayName: this.displayName,
      company: this.company,
      role: this.role,
    };
  }

  /** @param {ReturnType<Actor['toJSON']>} dto */
  static fromJSON(dto) {
    return new Actor(dto);
  }
}

const ANONYMOUS_ID = 'anonymous';

const ANONYMOUS = new Actor({
  id: ANONYMOUS_ID,
  // Reads correctly in a sentence: "Last updated by this device, 2 minutes
  // ago." Honest about what we actually know, which is nothing about who.
  displayName: 'this device',
});
