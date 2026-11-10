import { ItemDetails } from '../details/ItemDetails';
import { PdfPoint } from '../geometry/PdfPoint';
import { assertInstanceOf } from '../support/contracts';
import { Annotation } from './Annotation';
import { AnnotationRegistry } from './AnnotationRegistry';
import { Pin, PinStatus, isPinStatus } from './Pin';

export const TASK_KIND = 'task';

/**
 * A task that is not on any drawing — "order replacement ceiling tiles",
 * "chase the elevator inspection" (spec 6.4).
 *
 * ===========================================================================
 * WHY IT IS AN ANNOTATION AT ALL
 * ===========================================================================
 * Stored as a markup of kind `task` on the project's own `~tasks` sheet, so
 * everything a pin already has applies to it unchanged: the server's role
 * checks, the change history, the edit policy, undo, and the item fields. A
 * separate "tasks" store would have needed every one of those again.
 *
 * It has no position. Its anchor is the page origin, kept only because a
 * stored markup has an x and a y, and it is never drawn: no marker is
 * registered for it, and the `~tasks` sheet belongs to no drawing, so it is
 * never in an issued PDF either. When someone decides where it belongs,
 * `placedAt` turns it into a pin that keeps everything it had.
 */
export class OffSheetTask extends Annotation {
  /** The origin stored for a task, which has no place on any page. */
  static NOWHERE = new PdfPoint(0, 0);

  /**
   * @param {string} id
   * @param {string} sheetId The project's `~tasks` sheet.
   * @param {string} label What needs doing.
   * @param {string} status One of PinStatus.
   * @param {Date|string} createdAt
   * @param {ItemDetails} [details]
   */
  constructor(id, sheetId, label, status, createdAt, details = ItemDetails.EMPTY) {
    super(id, sheetId, createdAt);

    if (!isPinStatus(status)) {
      throw new RangeError(
        `Task status must be one of ${Object.values(PinStatus).join(', ')}, received "${status}".`,
      );
    }
    assertInstanceOf(details, ItemDetails, 'Task details');

    this.label = typeof label === 'string' ? label : '';
    this.status = status;
    this.details = details;
    Object.freeze(this);
  }

  getKind() {
    return TASK_KIND;
  }

  getAnchor() {
    return OffSheetTask.NOWHERE;
  }

  serializePayload() {
    const payload = { label: this.label, status: this.status };
    if (!this.details.isEmpty()) payload.details = this.details.toJSON();
    return payload;
  }

  /** A task off the drawings has nowhere to move to. */
  movedBy() {
    return this;
  }

  withStatus(status) {
    return new OffSheetTask(this.id, this.sheetId, this.label, status, this.createdAt, this.details);
  }

  withLabel(label) {
    return new OffSheetTask(this.id, this.sheetId, label, this.status, this.createdAt, this.details);
  }

  withDetail(key, value) {
    const details = this.details.with(key, value);
    if (details === this.details) return this;
    return new OffSheetTask(this.id, this.sheetId, this.label, this.status, this.createdAt, details);
  }

  /**
   * The pin this task becomes on a sheet: the same id, description, status,
   * fields and creation time, so its history, its comments and its place in
   * the numbering all follow it.
   *
   * @param {string} sheetId
   * @param {PdfPoint} position
   * @returns {Pin}
   */
  placedAt(sheetId, position) {
    return new Pin(this.id, sheetId, position, this.label, this.status, this.createdAt, this.details);
  }

  static fromJSON(dto) {
    const payload = dto.payload ?? {};
    return new OffSheetTask(
      dto.id,
      dto.sheetId,
      typeof payload.label === 'string' ? payload.label : '',
      isPinStatus(payload.status) ? payload.status : PinStatus.OPEN,
      new Date(dto.createdAt),
      ItemDetails.fromJSON(payload.details),
    );
  }
}

AnnotationRegistry.register(TASK_KIND, OffSheetTask.fromJSON);
