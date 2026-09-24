import { EditDecision } from './EditDecision';
import { EditPolicy } from './EditPolicy';

/**
 * Refuses changes the signed-in user's project role does not cover.
 *
 * ===========================================================================
 * !! NOT WIRED IN. THIS IS A SEAM, NOT A FEATURE. !!
 * ===========================================================================
 * Roles are deliberately not switched on yet. This class exists now so the
 * shape is settled while the reasoning is fresh, and so the team can see
 * exactly how much work roles will be when accounts land:
 *
 *     // ServiceContainer.jsx — the entire change, later
 *     new CompositeEditPolicy([
 *       new SealedByExportPolicy(() => activeSeals.ids),
 *   +   new RoleEditPolicy(),
 *     ])
 *
 * Note it takes NO arguments. It reads the actor off the request, which
 * `EditorService` has been putting there since the day it was written — filled
 * by `IdentityProvider`, which returns an anonymous placeholder today and a
 * real user the moment `SessionIdentityProvider` is wired. So the two halves of
 * "who is signed in" meet here without either one being edited.
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
      EditPolicy.INTENT.UPDATE,
      EditPolicy.INTENT.DELETE,
      EditPolicy.INTENT.STATUS,
      EditPolicy.INTENT.COMMENT,
    ]),
    power_collaborator: Object.freeze([
      EditPolicy.INTENT.CREATE,
      EditPolicy.INTENT.MOVE,
      EditPolicy.INTENT.UPDATE,
      EditPolicy.INTENT.DELETE,
      EditPolicy.INTENT.STATUS,
      EditPolicy.INTENT.COMMENT,
    ]),
    // A collaborator may add photos and comments, so CREATE is allowed but
    // MOVE, DELETE and STATUS are not. Restricting WHICH kinds they may create
    // is a further refinement that belongs here when photo markups exist — a
    // change to this table, not to any caller.
    collaborator: Object.freeze([
      EditPolicy.INTENT.CREATE,
      EditPolicy.INTENT.COMMENT,
    ]),
  });

  /**
   * @param {import('./EditPolicy').EditRequest} request
   * @returns {EditDecision}
   */
  check({ intent, actor }) {
    // Fail closed. An unidentified user is not an unrestricted one — if this
    // policy is wired up before sign-in works, the safe outcome is refusal.
    // `Actor.ANONYMOUS` has no role, so today it would land here, which is
    // precisely why this is not wired in yet.
    if (!actor || actor.isAnonymous) {
      return EditDecision.deny(
        'Sign in to change items on this sheet.',
        'unauthenticated',
      );
    }

    const allowed = RoleEditPolicy.RIGHTS[actor.role] ?? [];
    if (allowed.includes(intent)) return EditDecision.allow();

    return EditDecision.deny(
      'Your role on this project does not allow that change. Ask the project ' +
        'administrator if you need wider access.',
      'role',
    );
  }
}
