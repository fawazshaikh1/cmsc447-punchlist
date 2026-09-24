/**
 * Something an annotation is missing before it counts as real work.
 *
 * ===========================================================================
 * WHY A VIOLATION IS A VALUE, NOT A THROWN STRING
 * ===========================================================================
 * The same fact gets used three ways: to refuse a save, to mark a markup on the
 * sheet, and to warn before a drawing is issued. If the rule expressed itself
 * by throwing, only the first of those would be possible — the other two need
 * to ASK without anything going wrong.
 *
 * `field` is what lets the properties panel highlight the offending input
 * rather than showing a general complaint at the top, which on a tablet is the
 * difference between a user fixing it and a user closing the panel.
 */
export class RuleViolation {
  /**
   * @param {string} code Stable machine name, e.g. 'description-required'.
   *        Never shown to the user; used to group and to test against.
   * @param {string} message Plain language, addressed to the user.
   * @param {string} [field] Which input is at fault, e.g. 'label'.
   */
  constructor(code, message, field = '') {
    this.code = code;
    this.message = message;
    this.field = field;
    Object.freeze(this);
  }
}
