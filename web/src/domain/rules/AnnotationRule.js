import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * CONTRACT — one thing an annotation must satisfy before it is real work.
 *
 * ===========================================================================
 * COMPLETENESS IS NOT PERMISSION
 * ===========================================================================
 * These sit beside `domain/policy/` and answer a different question. Keeping
 * them apart matters, because the two have opposite remedies:
 *
 *   EditPolicy   "MAY you change this?"      -> no is final; add a new markup
 *   AnnotationRule "IS this finished?"       -> no is fixable; type a sentence
 *
 * Merging them would force one error type and one message style onto both, and
 * a user told "this markup was issued and cannot be changed" in the same tone
 * as "this pin needs a description" learns to ignore whichever they meet more
 * often.
 *
 * ---------------------------------------------------------------------------
 * WHY RULES ARE CLASSES AND NOT A `validate()` METHOD ON THE ANNOTATION
 * ---------------------------------------------------------------------------
 * Putting it on the type reads well until the second rule arrives. "A pin needs
 * a description" is true today; "a pin needs a responsible company" and "a pin
 * needs a photo before it can be closed" are Sprint 2, and each would mean
 * reopening `Pin.js` and growing one method — the exact edit-existing-code
 * pattern the registries were built to avoid.
 *
 * As classes, each rule is one file plus one registration line, and `Pin.js` is
 * never touched again.
 *
 * ---------------------------------------------------------------------------
 * A RULE MUST BE PURE AND SYNCHRONOUS
 * ---------------------------------------------------------------------------
 * It is asked during render, once per markup on a sheet that may carry eighty
 * of them. No I/O, no clock, no randomness — given the same annotation it must
 * always answer the same way, or a markup would flicker between complete and
 * incomplete between frames.
 */
export class AnnotationRule {
  static REQUIRED = ['check'];

  constructor() {
    enforceContract(this, new.target, AnnotationRule);
  }

  /**
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @returns {import('./RuleViolation').RuleViolation | null} null when satisfied.
   */
  check(annotation) {
    return abstractMethod('AnnotationRule', 'check', annotation);
  }
}
