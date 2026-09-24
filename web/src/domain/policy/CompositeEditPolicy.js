import { EditDecision } from './EditDecision';
import { EditPolicy } from './EditPolicy';
import { assertInstanceOf } from '../support/contracts';

/**
 * Requires unanimous consent from every policy it holds.
 *
 * ===========================================================================
 * WHY UNANIMOUS AND NOT MAJORITY OR FIRST-MATCH
 * ===========================================================================
 * Each policy guards a different concern and none of them knows the others
 * exist. If any one has a reason to refuse, that reason stands — a sealed
 * markup does not become editable because the user's role would have allowed
 * it, and vice versa.
 *
 * The FIRST refusal is the one reported. Ordering therefore matters for the
 * message quality, not for correctness: put the most explanatory policy first,
 * so a user who is blocked for two reasons hears the more useful one. See
 * ServiceContainer for the registered order.
 *
 * Adding a policy is adding an entry to that array. Nothing here changes, and
 * no existing policy learns about the new one.
 */
export class CompositeEditPolicy extends EditPolicy {
  /** @param {EditPolicy[]} policies Evaluated in order. */
  constructor(policies) {
    super();
    policies.forEach((policy, index) =>
      assertInstanceOf(policy, EditPolicy, `policies[${index}]`),
    );
    this.policies = [...policies];
  }

  /**
   * @param {import('./EditPolicy').EditRequest} request
   * @returns {EditDecision}
   */
  check(request) {
    for (const policy of this.policies) {
      const decision = policy.check(request);
      if (decision.denied) return decision;
    }
    return EditDecision.allow();
  }
}
