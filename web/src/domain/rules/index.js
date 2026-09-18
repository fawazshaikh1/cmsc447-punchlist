import { AnnotationRuleRegistry } from './AnnotationRuleRegistry';
import { RequiredDescriptionRule } from './RequiredDescriptionRule';

/**
 * Barrel for the completeness layer — AND the one place rules are switched on.
 *
 * ===========================================================================
 * WHY REGISTRATION HAPPENS HERE AND NOT INSIDE EACH RULE FILE
 * ===========================================================================
 * The annotation, marker and tool registries each register from the subclass's
 * own file, because a type registering itself is the thing that makes adding a
 * type a zero-edit operation.
 *
 * Rules are different: which rules a project enforces is a POLICY DECISION, not
 * a property of the rule class. "Every pin needs a description" is a choice the
 * team made on 2026-09-18; a different project on the same codebase might not
 * want it, and should be able to leave it off without deleting a file.
 *
 * Keeping the list here means that choice is reviewable in one place — you can
 * read this file and know exactly what the product insists on — rather than
 * being scattered across rule files as an import side effect nobody can find.
 *
 * ---------------------------------------------------------------------------
 * TO ADD A RULE
 * ---------------------------------------------------------------------------
 * Write the class, add one line below. Nothing else in the codebase changes.
 *
 *     AnnotationRuleRegistry.register('pin', new RequiredCompanyRule());
 *     AnnotationRuleRegistry.register(AnnotationRuleRegistry.ALL, new MaxPhotosRule(5));
 */

// --- the rules this product enforces ---------------------------------------

// A punch item with no description is unusable by whoever receives it, and the
// person who dropped it will not remember what they saw by the time the drawing
// is issued. See the class for the full reasoning.
AnnotationRuleRegistry.register('pin', new RequiredDescriptionRule());

// --- exports ----------------------------------------------------------------

export { AnnotationRule } from './AnnotationRule';
export { RuleViolation } from './RuleViolation';
export { AnnotationRuleRegistry } from './AnnotationRuleRegistry';
export { AnnotationIncompleteError } from './AnnotationIncompleteError';
export { RequiredDescriptionRule } from './RequiredDescriptionRule';
