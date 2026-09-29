import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * @typedef {object} EditRequest
 * @property {import('../annotations/Annotation').Annotation} annotation
 *           What the user is trying to change.
 * @property {string} intent  What they are trying to do — one of the INTENT
 *           constants below. Policies branch on this, so a future rule like
 *           "a collaborator may comment but not move" needs no new plumbing.
 * @property {object|null} actor The signed-in user, or null while accounts do
 *           not exist yet. Present in the request from day one precisely so
 *           that adding roles later changes no call sites.
 */

/**
 * CONTRACT — decides whether a change to an annotation is permitted.
 *
 * ===========================================================================
 * WHY THIS ABSTRACTION EXISTS
 * ===========================================================================
 * Two requirements that look unrelated turn out to be the same question:
 *
 *   "a markup that has been issued in a flattened export cannot be changed"
 *   "a collaborator may not change status, only add photos and comments"
 *
 * Both are asking *may this be changed right now?*, and both must be enforced
 * at the one place that writes (EditorService). Treating them as one concept
 * means the second is added by writing a new policy class and registering it —
 * not by finding every mutation and adding an `if`.
 *
 * Roles are NOT implemented yet, by instruction. `RoleEditPolicy` exists,
 * unwired, so the shape is already settled and switching it on is one line in
 * the composition root.
 *
 * ---------------------------------------------------------------------------
 * RULE FOR IMPLEMENTERS
 * ---------------------------------------------------------------------------
 * A policy answers about ONE concern and says nothing about the others. It
 * returns `EditDecision.allow()` for anything outside its remit, and
 * CompositeEditPolicy requires unanimous consent. That is what lets policies be
 * added without any of them knowing the others exist.
 */
export class EditPolicy {
  static REQUIRED = ['check'];

  /** What the user is attempting. Extend by adding a constant, not a branch. */
  static INTENT = Object.freeze({
    CREATE: 'create',
    MOVE: 'move',
    RESIZE: 'resize',
    UPDATE: 'update',
    DELETE: 'delete',
    STATUS: 'status',
    COMMENT: 'comment',
  });

  constructor() {
    enforceContract(this, new.target, EditPolicy);
  }

  /**
   * @param {EditRequest} request
   * @returns {import('./EditDecision').EditDecision}
   */
  check(request) {
    return abstractMethod('EditPolicy', 'check', request);
  }
}
