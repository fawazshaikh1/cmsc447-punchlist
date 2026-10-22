import { EditDecision } from './EditDecision';
import { EditPolicy } from './EditPolicy';

/**
 * Refuses changes the signed-in user's project role does not cover.
 *
 * Wired in server mode (SCRUM-47), where people sign in and have a role on the
 * project they opened. Browser mode keeps it out: nobody signs in there, and
 * `Actor.ANONYMOUS` has no role, so this would correctly refuse everything.
 *
 * It takes NO arguments. It reads the actor off the request, which
 * `EditorService` fills from `IdentityProvider` on every check — so the two
 * halves of "who is signed in" meet here without either knowing the other.
 *
 * The server applies the same table (backend/access.go). This copy decides
 * what the interface OFFERS — a collaborator never sees a Delete button the
 * server would refuse — and the server's is the one that counts.
 *
 * ---------------------------------------------------------------------------
 * THE ROLES, AS THE STAKEHOLDER DESCRIBED THEM (2026-09-11)
 * ---------------------------------------------------------------------------
 *   admin              Adds and deletes sheets. Scoped to a project. Decides
 *                      what role a self-registered user gets.
 *   power_collaborator Edits sheets and works the punch list generally.
 *   collaborator       Adds photos and comments only — cannot move, delete or
 *                      change the status of an item.
 *
 * Sheet-level rights (add/delete a sheet) are a different question from
 * annotation-level rights and are NOT modelled here. They belong to a sheet
 * policy alongside this one when sheet management is built — another policy
 * class, not another branch in this one.
 */
export class RoleEditPolicy extends EditPolicy {
  /**
   * Which intents each role may carry out on an annotation.
   *
   * A lookup table rather than a chain of `if`s: adding a role is adding a row,
   * and the whole permission model stays readable on one screen, which is what
   * makes it reviewable by someone who is not a programmer.
   */
  static RIGHTS = Object.freeze({
    admin: Object.freeze([
      EditPolicy.INTENT.CREATE,
      EditPolicy.INTENT.MOVE,
      EditPolicy.INTENT.RESIZE,
      EditPolicy.INTENT.UPDATE,
      EditPolicy.INTENT.DELETE,
      EditPolicy.INTENT.STATUS,
      EditPolicy.INTENT.COMMENT,
      EditPolicy.INTENT.ISSUE,
    ]),
    power_collaborator: Object.freeze([
      EditPolicy.INTENT.CREATE,
      EditPolicy.INTENT.MOVE,
      EditPolicy.INTENT.RESIZE,
      EditPolicy.INTENT.UPDATE,
      EditPolicy.INTENT.DELETE,
      EditPolicy.INTENT.STATUS,
      EditPolicy.INTENT.COMMENT,
      EditPolicy.INTENT.ISSUE,
    ]),
    // A collaborator may add photos and comments, so CREATE is allowed but
    // MOVE, DELETE and STATUS are not — and CREATE only of the kinds in
    // CREATABLE below.
    collaborator: Object.freeze([
      EditPolicy.INTENT.CREATE,
      EditPolicy.INTENT.COMMENT,
    ]),
  });

  /**
   * Roles whose CREATE is limited to certain kinds of markup. A role with no
   * entry may create any kind its RIGHTS allow. Kept in step with
   * `collaboratorKinds` in backend/access.go.
   */
  static CREATABLE = Object.freeze({
    collaborator: Object.freeze(['photo']),
  });

  /**
   * @param {import('./EditPolicy').EditRequest} request
   * @returns {EditDecision}
   */
  check({ annotation, kind, intent, actor }) {
    // Fail closed. An unidentified user is not an unrestricted one: a session
    // that expired, or a request made before sign-in finished, is refused.
    if (!actor || actor.isAnonymous) {
      return EditDecision.deny(
        'Sign in to change items on this sheet.',
        'unauthenticated',
      );
    }

    const allowed = RoleEditPolicy.RIGHTS[actor.role] ?? [];
    const creatable = RoleEditPolicy.CREATABLE[actor.role];
    const markupKind = annotation?.getKind?.() ?? kind;
    const kindRefused =
      intent === EditPolicy.INTENT.CREATE && creatable !== undefined && !creatable.includes(markupKind);

    if (allowed.includes(intent) && !kindRefused) return EditDecision.allow();

    return EditDecision.deny(
      'Your role on this project does not allow that change. Ask the project ' +
        'administrator if you need wider access.',
      'role',
    );
  }
}
