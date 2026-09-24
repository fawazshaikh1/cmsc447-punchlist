/**
 * Thrown when a policy refuses a change that was attempted anyway.
 *
 * ===========================================================================
 * WHY A NAMED ERROR AND NOT A RETURN VALUE
 * ===========================================================================
 * The interface asks the policy BEFORE offering an action, so in normal use
 * this is never thrown: a sealed markup shows its fields disabled and there is
 * nothing to click.
 *
 * It is thrown when something gets past that — a stale React state, a keyboard
 * shortcut that skipped the disabled control, a future caller written by a
 * teammate who did not know to check. Those are exactly the paths that must not
 * silently succeed, because each one would write to a record we have told the
 * user is permanent.
 *
 * Carrying the EditDecision means the catch site can show the user the same
 * sentence the panel would have shown, instead of inventing its own wording.
 */
export class EditNotPermittedError extends Error {
  /** @param {import('./EditDecision').EditDecision} decision */
  constructor(decision) {
    super(decision.reason);
    this.name = 'EditNotPermittedError';
    this.decision = decision;
    /** Machine-readable cause — 'sealed', 'role', 'unauthenticated'. */
    this.code = decision.code;
  }
}
