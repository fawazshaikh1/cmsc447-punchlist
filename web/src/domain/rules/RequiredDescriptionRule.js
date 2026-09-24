import { AnnotationRule } from './AnnotationRule';
import { RuleViolation } from './RuleViolation';

/**
 * A punch item must say what is wrong with it.
 *
 * ===========================================================================
 * WHY THIS IS A HARD RULE AND NOT A NUDGE
 * ===========================================================================
 * A pin with no description is worse than no pin at all. It reaches the
 * architect as a numbered marker on a drawing with nothing attached — and
 * whoever receives it has to come back and ask what it meant, or guess, or
 * ignore it. Multiply that by a hundred-sheet set walked in an afternoon and
 * the punch list stops being trusted.
 *
 * It is also unrecoverable after the fact. The person who dropped the pin
 * remembers what they saw for about an hour; the drawing is issued days later.
 * So the description is collected at the moment of placement, while the user is
 * standing in front of the defect, and the pin does not exist until it has one.
 *
 * ---------------------------------------------------------------------------
 * APPLIED BY CAPABILITY, NOT BY TYPE NAME
 * ---------------------------------------------------------------------------
 * The check is "does this carry a description at all?", answered by looking for
 * `withLabel` — the same capability test the properties panel uses to decide
 * whether to render the box. A future markup type that gains a description
 * inherits this rule the moment it registers for it, and a type that has no
 * description concept can never trip it even by accident.
 */
export class RequiredDescriptionRule extends AnnotationRule {
  /** Shared so callers can match on it without copying the string. */
  static CODE = 'description-required';

  /**
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @returns {RuleViolation | null}
   */
  check(annotation) {
    // Not a describable annotation: silently satisfied. A rule must never
    // report a problem about a concept its subject does not have.
    if (typeof annotation.withLabel !== 'function') return null;

    // Whitespace is not a description. Without the trim, a space bar press
    // satisfies the rule and produces exactly the blank pin it exists to stop.
    if (typeof annotation.label === 'string' && annotation.label.trim() !== '') {
      return null;
    }

    return new RuleViolation(
      RequiredDescriptionRule.CODE,
      'This pin needs a description — say what needs fixing, so whoever picks ' +
        'it up knows what they are looking at.',
      'label',
    );
  }
}
