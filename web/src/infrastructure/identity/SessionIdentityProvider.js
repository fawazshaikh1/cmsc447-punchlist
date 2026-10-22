import { Actor } from '../../domain/identity/Actor';
import { IdentityProvider } from '../../domain/ports/IdentityProvider';

/**
 * The signed-in person, on the project they have open, from the Go API.
 *
 * Wired in server mode (SCRUM-44). Every change the editor records, every
 * permission RoleEditPolicy checks and every export's "issued by" reads
 * `current()`, so the moment this holds a real Actor, real names and roles
 * appear in all of them — none of those places changed to make that happen.
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
 * THE ROLE IS PER PROJECT
 * ---------------------------------------------------------------------------
 *     GET /api/session?project=12
 *     200 { "id": "7", "displayName": "J. Rivera",
 *           "company": "Apex Electrical", "role": "power_collaborator" }
 *     401 (not signed in)
 *
 * The stakeholder was specific that a person can be admin of one project and
 * a collaborator on another, so the role is asked for the open project, and
 * asked again whenever a different one is opened.
 */
export class SessionIdentityProvider extends IdentityProvider {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchImpl] Injectable for tests.
   */
  constructor(baseUrl, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.actor = Actor.ANONYMOUS;
    /** @type {number|null} */
    this.projectId = null;
  }

  /** Synchronous by contract. Returns the last known session. */
  current() {
    return this.actor;
  }

  /**
   * Works as the signed-in person on this project, and reads their role on
   * it. Resolves with the actor; never throws (see refresh).
   *
   * @param {number|null} projectId
   */
  async useProject(projectId) {
    this.projectId = projectId;
    return this.refresh();
  }

  /** Back to nobody — after signing out. */
  clear() {
    this.projectId = null;
    this.actor = Actor.ANONYMOUS;
  }

  /**
   * Re-reads the session for the current project.
   *
   * Never throws. A network failure means we do not know who is using the app,
   * and the safe reading of that is "nobody" — which makes permission checks
   * fail closed rather than silently granting whatever the last user had.
   *
   * @returns {Promise<Actor>}
   */
  async refresh() {
    const asked = this.projectId;
    const query = asked === null ? '' : `?project=${encodeURIComponent(asked)}`;
    let actor = Actor.ANONYMOUS;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/session${query}`, {
        // The session cookie is the whole point of the request.
        credentials: 'same-origin',
      });
      if (response.ok) actor = Actor.fromJSON(await response.json());
    } catch {
      actor = Actor.ANONYMOUS;
    }

    // A slower answer for a project that has since been switched away from
    // must not overwrite the newer one.
    if (asked === this.projectId) this.actor = actor;
    return this.actor;
  }
}
