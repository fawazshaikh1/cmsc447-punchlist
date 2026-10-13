import { abstractMethod, enforceContract } from '../support/contracts';

/**
 * @typedef {object} FlagContext
 * @property {import('../details/CalendarDate').CalendarDate} today The day as
 *           the person holding the tablet sees it. Passed in rather than read
 *           from a clock here, so a flag is a pure function of its inputs and
 *           a check can ask "what about next Tuesday?".
 */

/**
 * Something worth drawing attention to on a markup — it is overdue, it is due
 * this week, nobody is assigned. CONTRACT.
 *
 * ===========================================================================
 * WHY A FLAG IS A CLASS IN ITS OWN FILE
 * ===========================================================================
 * The sheet already marks two states, issued and unfinished, and each one was
 * wired by hand: an id set computed in the editor hook, an attribute on the
 * marker wrapper, a CSS rule. Overdue would have been the third copy of that,
 * and "due soon" and "unassigned" the fourth and fifth.
 *
 * A flag instead says when it applies, how serious it is, and what to tell the
 * user — and registers. The sheet tints every flagged markup by its most
 * serious tone and the panel lists each flag's explanation, without either
 * naming a flag. The next one is a new file and one registration line.
 *
 * Unlike a rule (AnnotationRuleRegistry), a flag never blocks anything. Rules
 * decide whether a markup may be issued; flags only decide what is worth a
 * second look.
 */
export class MarkupFlag {
  /** Methods a concrete flag must provide. @see enforceContract */
  static REQUIRED = ['getId', 'getTone', 'appliesTo', 'describe'];

  /** How serious a flag is, least to most. Drives the colour on the sheet. */
  static TONES = Object.freeze(['info', 'warning', 'danger']);

  constructor() {
    enforceContract(this, new.target, MarkupFlag);
  }

  /** @returns {string} Lowercase, hyphenated, e.g. 'overdue'. Stable. */
  getId() {
    return abstractMethod('MarkupFlag', 'getId');
  }

  /** @returns {'info'|'warning'|'danger'} */
  getTone() {
    return abstractMethod('MarkupFlag', 'getTone');
  }

  /**
   * Whether this flag applies. Must not throw: it runs for every markup on
   * every render, and an odd markup must not take the sheet down.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @param {FlagContext} context
   * @returns {boolean}
   */
  appliesTo(annotation, context) {
    return abstractMethod('MarkupFlag', 'appliesTo', annotation, context);
  }

  /**
   * One sentence for the panel, e.g. "Overdue — was due 3 Oct 2026." Only
   * called when `appliesTo` returned true.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @param {FlagContext} context
   * @returns {string}
   */
  describe(annotation, context) {
    return abstractMethod('MarkupFlag', 'describe', annotation, context);
  }
}
