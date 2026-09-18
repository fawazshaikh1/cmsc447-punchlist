import { AnnotationRule } from './AnnotationRule';
import { assertInstanceOf } from '../support/contracts';

/** Registered against this instead of a kind when a rule applies to everything. */
const ALL_KINDS = '*';

/**
 * Maps an annotation `kind` to the rules it must satisfy.
 *
 * ===========================================================================
 * THE FIFTH REGISTRY, AND WHY IT EARNS ITS PLACE
 * ===========================================================================
 * The other four answer how to rebuild, draw, create and export a markup type.
 * This one answers what makes it FINISHED — and it exists for the same reason
 * they do. The alternative is a conditional somewhere central:
 *
 *     if (annotation.getKind() === 'pin' && !annotation.label) { ... }
 *
 * which every new rule and every new type would have to come back and edit, and
 * which puts knowledge of pins inside code that should not have any.
 *
 * Here, "a pin needs a description" is one file that registers itself. Sprint
 * 2's "a pin needs a responsible company" is a second file. Neither touches
 * `Pin.js`, `EditorService`, the panel, or each other.
 *
 * ---------------------------------------------------------------------------
 * RULES ARE ADDITIVE, NOT REPLACING
 * ---------------------------------------------------------------------------
 * Unlike the other registries, a kind may carry SEVERAL rules, so `register`
 * appends rather than overwrites. That is only safe under Vite's hot reload if
 * repeats are filtered — otherwise editing a rule file re-runs the barrel and
 * stacks a second copy, and the panel reports one missing description twice.
 *
 * The check is by constructor IDENTITY, plus — in development only — by class
 * NAME. Both are needed, and neither alone is right:
 *
 *   identity  correct always, but a hot reload produces a brand new class
 *             object for the same rule, so it lets the duplicate through
 *   name      catches that, but a minifier renames classes, and two rules that
 *             collapsed to the same short name would silently lose one
 *
 * So the loose check is confined to development, where hot reload is the only
 * way a duplicate can arise. A production bundle runs each module once, so
 * identity is sufficient there and cannot drop a rule by accident. Same
 * reasoning as AnnotationRegistry's DEV/production split, for the same hazard.
 */
export class AnnotationRuleRegistry {
  /** @type {Map<string, AnnotationRule[]>} kind (or '*') -> rules */
  static #rules = new Map();

  /** This class is a namespace and is never instantiated. */
  constructor() {
    throw new TypeError('AnnotationRuleRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} kind The annotation kind, or `AnnotationRuleRegistry.ALL`
   *        for a rule that applies to every type.
   * @param {AnnotationRule} rule
   */
  static register(kind, rule) {
    assertInstanceOf(rule, AnnotationRule, 'rule');

    const existing = AnnotationRuleRegistry.#rules.get(kind) ?? [];

    // Same rule twice means the module was re-executed (hot reload), not that
    // someone wants the check run twice. Appending blindly would make the panel
    // list one missing description as three separate problems.
    const alreadyRegistered = existing.some(
      (registered) =>
        registered.constructor === rule.constructor ||
        (import.meta.env?.DEV && registered.constructor.name === rule.constructor.name),
    );

    if (alreadyRegistered) return;

    AnnotationRuleRegistry.#rules.set(kind, [...existing, rule]);
  }

  /** Register against this to apply a rule to every annotation kind. */
  static get ALL() {
    return ALL_KINDS;
  }

  /**
   * Everything wrong with this annotation right now.
   *
   * Returns ALL violations rather than stopping at the first, so a user fixing
   * a markup sees the whole list and does not have to save three times to
   * discover three problems.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @returns {import('./RuleViolation').RuleViolation[]} Empty when complete.
   */
  static validate(annotation) {
    if (!annotation) return [];

    const applicable = [
      ...(AnnotationRuleRegistry.#rules.get(ALL_KINDS) ?? []),
      ...(AnnotationRuleRegistry.#rules.get(annotation.getKind()) ?? []),
    ];

    return applicable
      .map((rule) => rule.check(annotation))
      .filter((violation) => violation !== null);
  }

  /**
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @returns {boolean}
   */
  static isComplete(annotation) {
    return AnnotationRuleRegistry.validate(annotation).length === 0;
  }

  /** Test seam. Never call from application code. */
  static reset() {
    AnnotationRuleRegistry.#rules.clear();
  }
}
