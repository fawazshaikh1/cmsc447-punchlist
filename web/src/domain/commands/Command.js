import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * CONTRACT — one reversible change to the annotation set.
 *
 * ===========================================================================
 * WHY THE COMMAND PATTERN RATHER THAN SNAPSHOTS
 * ===========================================================================
 * The obvious way to build undo is to snapshot the whole annotation list before
 * every change and restore it on undo. It is simpler, and it is wrong here:
 *
 *   - A sheet can hold hundreds of markups; a freehand stroke alone can carry
 *     hundreds of points. Snapshotting per keystroke of a drag is unbounded
 *     memory for unbounded strokes.
 *   - Snapshots describe STATE, so the UI cannot say what will be undone. A
 *     command knows it is "Delete cloud", which is what the button should read.
 *   - Snapshots do not survive a move to a server. A command is a description
 *     of an intent, which is exactly the shape the Sprint 3 offline outbox
 *     needs to queue and replay.
 *
 * Each command stores only what it needs to reverse itself: an add remembers
 * the id it created, a delete remembers the annotation it removed, an update
 * remembers the previous value.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT EVERY IMPLEMENTATION MUST HONOUR
 * ---------------------------------------------------------------------------
 * `undo()` must return the repository to exactly the state it was in before
 * `execute()` ran. If that cannot be guaranteed, the operation does not belong
 * in the history — put it outside and disable undo for it explicitly, rather
 * than shipping an undo that quietly loses data.
 */
export class Command {
  static REQUIRED = ['describe', 'execute', 'undo'];

  constructor() {
    enforceContract(this, new.target, Command);
  }

  /**
   * Short label for the UI, e.g. "Add cloud". Shown on the undo button and in
   * its tooltip, so a user knows what they are about to reverse.
   * @returns {string}
   */
  describe() {
    return abstractMethod('Command', 'describe');
  }

  /** @returns {Promise<void>} */
  execute() {
    return abstractMethod('Command', 'execute');
  }

  /** Exactly reverses `execute`. @returns {Promise<void>} */
  undo() {
    return abstractMethod('Command', 'undo');
  }
}
