/**
 * The answer to "may this be changed right now?".
 *
 * ===========================================================================
 * WHY A VALUE OBJECT AND NOT A BOOLEAN
 * ===========================================================================
 * A policy that returns `false` tells the user nothing. On a construction site
 * the difference between "you cannot edit this because it was issued to the
 * architect on 18 September" and a greyed-out button with no explanation is the
 * difference between a tool people trust and one they work around.
 *
 * So a decision carries its reason, and the interface shows it verbatim. The
 * `code` lets the UI react differently — a seal is permanent and deserves an
 * explanation, a missing permission deserves "ask your project admin" — without
 * anyone parsing the message text.
 */
export class EditDecision {
  /**
   * @param {boolean} allowed
   * @param {string} [reason] Shown to the user. Written for them, not for us.
   * @param {string} [code] Machine-readable cause, e.g. 'sealed', 'role'.
   */
  constructor(allowed, reason = '', code = '') {
    this.allowed = allowed;
    this.reason = reason;
    this.code = code;
    Object.freeze(this);
  }

  /** @returns {EditDecision} */
  static allow() {
    // One shared instance: decisions are immutable and the allow case is by far
    // the most common, evaluated on every render of every properties panel.
    return ALLOWED;
  }

  /**
   * @param {string} reason Plain language, addressed to the user.
   * @param {string} code
   * @returns {EditDecision}
   */
  static deny(reason, code) {
    return new EditDecision(false, reason, code);
  }

  /** True when the change must be refused. Convenience for readability. */
  get denied() {
    return !this.allowed;
  }
}

const ALLOWED = new EditDecision(true);
