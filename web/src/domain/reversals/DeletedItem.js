import { AnnotationRegistry } from '../annotations/AnnotationRegistry';
import { Actor } from '../identity/Actor';

/**
 * A markup someone deleted in the last 30 days (spec 8.2): the markup itself,
 * exactly as it was, and who deleted it and when.
 *
 * The server keeps the copy (a trigger on every delete, so no delete path can
 * skip it). Bringing it back is an ordinary create through EditorService with
 * the same id and creation date, so it keeps its number, fields, history and
 * comments, is recorded, and can be undone.
 */
export class DeletedItem {
  static DRAWING_REMOVED = 'Its drawing is no longer in the project.';

  /**
   * @param {object} fields
   * @param {import('../annotations/Annotation').Annotation} fields.annotation
   * @param {Date} fields.deletedAt
   * @param {Actor|null} fields.deletedBy Null when no record says who.
   * @param {boolean} fields.drawingRemoved Its drawing has left the project.
   */
  constructor({ annotation, deletedAt, deletedBy, drawingRemoved }) {
    this.annotation = annotation;
    this.deletedAt = deletedAt;
    this.deletedBy = deletedBy;
    this.drawingRemoved = Boolean(drawingRemoved);
    Object.freeze(this);
  }

  /**
   * Why it cannot be brought back, or null when it can. A markup on a drawing
   * that has gone would come back onto a sheet nobody can open.
   * @returns {string|null}
   */
  restoreRefusal() {
    return this.drawingRemoved ? DeletedItem.DRAWING_REMOVED : null;
  }

  /**
   * From the server's row: the markup's own fields plus `deletedAt`,
   * `deletedBy` and `drawingRemoved`.
   *
   * @param {object} row
   * @returns {DeletedItem|null} Null for a markup this build cannot read —
   *          left out of the list rather than failing it.
   */
  static fromJSON(row) {
    let annotation = null;
    try {
      annotation = AnnotationRegistry.tryFromJSON(row);
    } catch {
      annotation = null;
    }
    if (!annotation) return null;
    return new DeletedItem({
      annotation,
      deletedAt: new Date(row.deletedAt),
      deletedBy: row.deletedBy && typeof row.deletedBy === 'object' ? Actor.fromJSON(row.deletedBy) : null,
      drawingRemoved: row.drawingRemoved === true,
    });
  }
}
