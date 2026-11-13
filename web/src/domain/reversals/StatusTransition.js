import { PinStatus } from '../annotations/Pin';
import { STATUS_LABELS } from '../punchlist/statusLabels';

/**
 * Which way a status change goes (spec 8.1).
 *
 * A task moves forward — Open, Ready for review, Closed — as the work is done
 * and checked. Moving it BACK says the work was not good enough, and the
 * person who did it needs to know why, so a backward move asks for a reason
 * and posts it as a comment. Forward moves, and staying put, ask nothing:
 * asking on every change would teach people to type "ok" without reading.
 *
 * Pure, so it is checked in Node (verify-reversals).
 */
const ORDER = Object.freeze([PinStatus.OPEN, PinStatus.READY_FOR_REVIEW, PinStatus.CLOSED]);

export class StatusTransition {
  /** The statuses from first to last. */
  static ORDER = ORDER;

  /**
   * @param {string|undefined} from
   * @param {string|undefined} to
   * @returns {boolean} True only for a move between two known statuses
   *          towards Open — never for a markup that has no status.
   */
  static isBackward(from, to) {
    const before = ORDER.indexOf(from);
    const after = ORDER.indexOf(to);
    return before !== -1 && after !== -1 && after < before;
  }

  /**
   * The changes in a batch that send an item back. A create or a delete
   * moves nothing, so neither is one.
   *
   * @template {{ previous?: object|null, next?: object|null }} Change
   * @param {Change[]} changes
   * @returns {Change[]}
   */
  static backwardIn(changes) {
    return changes.filter(
      ({ previous = null, next = null }) => previous && next && StatusTransition.isBackward(previous.status, next.status),
    );
  }

  /**
   * What the undo button and the status record say.
   * @param {string} to
   */
  static sendBackLabel(to) {
    return `Send back to ${STATUS_LABELS[to] ?? to}`;
  }

  /**
   * The comment that tells the person doing the work why it came back.
   * @param {string} from @param {string} to @param {string} reason
   */
  static sendBackComment(from, to, reason) {
    return `Sent back from ${STATUS_LABELS[from] ?? from} to ${STATUS_LABELS[to] ?? to}: ${String(reason).trim()}`;
  }
}
