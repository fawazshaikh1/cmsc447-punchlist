import { Actor } from './Actor';
import { IdentityProvider } from '../ports/IdentityProvider';

/**
 * Always reports the same actor. **The Sprint 1 default.**
 *
 * ===========================================================================
 * WHY THIS IS IN THE DOMAIN AND `SessionIdentityProvider` IS NOT
 * ===========================================================================
 * The split is about I/O, not about importance. Returning a value you were
 * handed is pure logic and belongs in tier 2; asking a server who is signed in
 * is an adapter and belongs in tier 3. Putting this here means tests, the
 * verify script and `EditorService`'s own default can all use it without
 * reaching across a tier boundary for something that never touches a network.
 *
 * ---------------------------------------------------------------------------
 * IT IS ALSO THE HONEST DESCRIPTION OF SPRINT 1
 * ---------------------------------------------------------------------------
 * Not a stub, and not a fake. There genuinely is one user of this application
 * right now — whoever is holding the tablet — and we genuinely do not know
 * their name. `Actor.ANONYMOUS` says exactly that, and every change recorded
 * before sign-in exists will read "this device", which is true.
 *
 * The moment accounts land, `SessionIdentityProvider` replaces this in the
 * composition root and real names start appearing in a log that has been
 * recording all along.
 */
export class StaticIdentityProvider extends IdentityProvider {
  /**
   * @param {Actor} [actor] Defaults to the anonymous placeholder. Passing a
   *        real actor is what makes this useful in tests: arrange a signed-in
   *        user without a server, a session or a browser.
   */
  constructor(actor = Actor.ANONYMOUS) {
    super();
    this.actor = actor;
  }

  current() {
    return this.actor;
  }
}
