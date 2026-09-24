import { Actor } from '../../domain/identity/Actor';
import { IdentityProvider } from '../../domain/ports/IdentityProvider';

/**
 * The signed-in user, from the Go API's session endpoint.
 *
 * ===========================================================================
 * !! NOT WIRED IN. THIS IS THE SPRINT 2 DESTINATION, WRITTEN EARLY. !!
 * ===========================================================================
 * It is here for the same reason `RoleEditPolicy` and `HttpAnnotationRepository`
 * are: to prove the seam is real. A port that has only ever had one
 * implementation is a guess about a boundary. A port with a second
 * implementation written against it is a boundary that has been tested.
 *
 * Switching to it is one line in the composition root:
 *
 *     - new AnonymousIdentityProvider()
 *     + new SessionIdentityProvider('/api')
 *
 * plus calling `refresh()` once at startup and again after sign-in. Nothing
 * else in the codebase changes — `EditorService` already asks for an actor on
 * every write, the change log already stores it, and `RoleEditPolicy` already
 * reads the role off it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SESSION IS CACHED AND `current()` NEVER AWAITS
 * ---------------------------------------------------------------------------
 * `current()` is called during permission checks, which run in render, and
 * inside writes. Neither can await. So the session is fetched out of band and
 * held; `current()` returns whatever is known at this instant.
 *
 * An expired session therefore does not make an in-flight edit explode — it
 * makes the NEXT permission check fail, which is the behaviour you want. A
 * user midway through typing a description should finish and be told, not lose
 * the sentence to a thrown error.
 *
 * ---------------------------------------------------------------------------
 * THE ENDPOINT THIS EXPECTS FROM THE GO TEAM
 * ---------------------------------------------------------------------------
 *     GET /api/session
 *     200 { "id": "usr_7f3a", "displayName": "J. Rivera",
 *           "company": "Apex Electrical", "role": "power_collaborator" }
 *     401 (not signed in)
 *
 * `role` is the role on the CURRENT PROJECT, not a global one — the stakeholder
 * was specific that a person can be admin of one project and a collaborator on
 * another. When project switching exists, this takes a project id and the
 * endpoint scopes the role to it.
 */
export class SessionIdentityProvider extends IdentityProvider {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchImpl] Injectable for tests.
   */
  constructor(baseUrl, fetchImpl = globalThis.fetch.bind(globalThis)) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.actor = Actor.ANONYMOUS;
  }

  /** Synchronous by contract. Returns the last known session. */
  current() {
    return this.actor;
  }

  /**
   * Re-reads the session. Call at startup, after sign-in, and after sign-out.
   *
   * Never throws. A network failure means we do not know who is using the app,
   * and the safe reading of that is "nobody" — which makes permission checks
   * fail closed rather than silently granting whatever the last user had.
   *
   * @returns {Promise<import('../../domain/identity/Actor').Actor>}
   */
  async refresh() {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/session`, {
        // The session cookie is the whole point of the request.
        credentials: 'include',
      });

      if (!response.ok) {
        this.actor = Actor.ANONYMOUS;
        return this.actor;
      }

      this.actor = Actor.fromJSON(await response.json());
    } catch {
      this.actor = Actor.ANONYMOUS;
    }

    return this.actor;
  }
}
