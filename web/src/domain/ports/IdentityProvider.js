import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — who is using the application right now.
 *
 * ===========================================================================
 * THE ENTIRE SPRINT 2 SIGN-IN CHANGE, FROM THE DOMAIN'S POINT OF VIEW
 * ===========================================================================
 *     // ServiceContainer.jsx
 *     - new AnonymousIdentityProvider()
 *     + new SessionIdentityProvider('/api')
 *
 * That is it. `EditorService` already asks this on every write, the change log
 * already stores what it returns, the export history already stamps it, and
 * `RoleEditPolicy` already reads the role off it. None of them learns anything
 * new when real people start signing in — they were built asking the question
 * from the first day, and getting an honest placeholder answer.
 *
 * ---------------------------------------------------------------------------
 * WHY `current()` IS SYNCHRONOUS
 * ---------------------------------------------------------------------------
 * It is called inside `EditorService` writes and during permission checks that
 * run in render. An async signature would force both to become async — which
 * for the render path is impossible, and for the write path would mean a token
 * refresh could happen midway through recording a change.
 *
 * So the rule for an implementation is: hold the session in memory and return
 * it. Fetching, refreshing and expiry are the adapter's business, handled
 * out of band, and `current()` reports whatever it knows at this instant.
 *
 * That is not a limitation. An expired session should not make an in-flight
 * edit throw — it should make the NEXT permission check fail, which is exactly
 * what returning a signed-out actor here does.
 */
export class IdentityProvider {
  static REQUIRED = ['current'];

  constructor() {
    enforceContract(this, new.target, IdentityProvider);
  }

  /**
   * @returns {import('../identity/Actor').Actor} Never null — see
   *          `Actor.ANONYMOUS` for why a placeholder beats a nullable.
   */
  current() {
    return abstractMethod('IdentityProvider', 'current');
  }
}
