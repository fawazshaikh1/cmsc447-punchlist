import { Actor } from '../identity/Actor';
import { MediaRef } from '../media/MediaRef';

/**
 * A photo attached to a punch item (SCRUM-88): which item, the stored image,
 * an optional caption, who added it and when.
 *
 * Attached, not placed: unlike a photo markup it has no spot on the drawing.
 * It is the evidence for the item — the damage, or the finished fix — and it
 * goes on the item's page in the issued PDF. Anyone on the project may attach
 * one, a subcontractor photographing their own work included.
 */
export class ItemPhoto {
  /**
   * @param {object} fields
   * @param {string} fields.id
   * @param {string} fields.annotationId The item.
   * @param {MediaRef} fields.media
   * @param {string} fields.caption '' for none.
   * @param {Actor} fields.addedBy
   * @param {Date} fields.addedAt
   */
  constructor({ id, annotationId, media, caption, addedBy, addedAt }) {
    this.id = id;
    this.annotationId = annotationId;
    this.media = media;
    this.caption = caption;
    this.addedBy = addedBy;
    this.addedAt = addedAt;
    Object.freeze(this);
  }

  /**
   * From the server's row.
   * @param {object} row
   * @returns {ItemPhoto|null} Null for a row this build cannot read — left out
   *          rather than failing the list.
   */
  static fromJSON(row) {
    try {
      if (!row?.id || !row.annotationId || !row.media?.key) return null;
      return new ItemPhoto({
        id: String(row.id),
        annotationId: String(row.annotationId),
        media: MediaRef.fromJSON(row.media),
        caption: typeof row.caption === 'string' ? row.caption : '',
        addedBy: Actor.fromJSON(row.addedBy ?? { id: 'anonymous', displayName: 'someone' }),
        addedAt: new Date(row.addedAt),
      });
    } catch {
      return null;
    }
  }
}
