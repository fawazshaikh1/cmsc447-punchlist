/**
 * Thrown when a save would store an annotation that is not finished.
 *
 * ===========================================================================
 * SEPARATE FROM EditNotPermittedError, ON PURPOSE
 * ===========================================================================
 * They look similar at the throw site and mean opposite things to the user:
 *
 *   EditNotPermittedError   the answer is no, and no amount of effort changes
 *                           it — the work has already been issued
 *   AnnotationIncompleteError  the answer is "not yet", and the user can fix it
 *                           in about four seconds
 *
 * One error type for both would leave the interface guessing which tone to use,
 * and the wrong guess is expensive in both directions: telling someone their
 * work is permanently locked when they just forgot a sentence, or telling them
 * to fix something they are not allowed to touch.
 */
export class AnnotationIncompleteError extends Error {
  /** @param {import('./RuleViolation').RuleViolation[]} violations */
  constructor(violations) {
    super(violations.map((violation) => violation.message).join(' '));
    this.name = 'AnnotationIncompleteError';
    this.violations = violations;
    /** Codes only, for a caller that needs to branch without reading prose. */
    this.codes = violations.map((violation) => violation.code);
  }
}
