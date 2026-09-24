import { EditDecision } from './EditDecision';
import { EditPolicy } from './EditPolicy';

/**
 * Permits everything.
 *
 * ===========================================================================
 * WHY A CLASS THAT DOES NOTHING IS WORTH HAVING
 * ===========================================================================
 * This is the Null Object pattern. Without it, every caller that might not have
 * a policy configured would need `if (this.policy)` before asking, and that
 * `if` would be repeated at every call site and eventually forgotten at one of
 * them — which is exactly the kind of omission that turns into "the lock did
 * not apply on the iPad".
 *
 * With it, a policy is always present and every caller is unconditional.
 *
 * It is also the honest expression of where the project stands today: accounts
 * and roles do not exist yet, so nothing is refused on those grounds. When
 * roles arrive, this is swapped for RoleEditPolicy in the composition root and
 * no other file changes.
 */
export class AllowAllPolicy extends EditPolicy {
  /**
   * @param {import('./EditPolicy').EditRequest} _request
   * @returns {EditDecision}
   */
  check(_request) {
    return EditDecision.allow();
  }
}
