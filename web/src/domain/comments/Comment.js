import { Actor } from '../identity/Actor';

/**
 * One comment on an item (spec 7.1) — what was said, by whom, when, and the
 * comment it answers, if it is a reply.
 *
 * Kept by the server as a change record with intent `comment`, so it is
 * signed by the server and append-only: a comment is never edited or deleted
 * (FR-12.4), exactly like the rest of an item's history.
 */
export class Comment {
  /**
   * @param {object} fields
   * @param {string} fields.id
   * @param {string} fields.annotationId The item it is about.
   * @param {string} fields.sheetId
   * @param {string} fields.text
   * @param {Actor} fields.author
   * @param {string} fields.at ISO-8601.
   * @param {string} [fields.replyTo] The comment this answers; '' for none.
   */
  constructor({ id, annotationId, sheetId, text, author, at, replyTo = '' }) {
    this.id = id;
    this.annotationId = annotationId;
    this.sheetId = sheetId;
    this.text = text;
    this.author = author;
    this.at = at;
    this.replyTo = replyTo ?? '';
    Object.freeze(this);
  }

  /**
   * From a change record as the server sends it.
   * @param {{ id: string, annotationId: string, sheetId: string, actor: object, at: string, detail: string, replyTo?: string }} row
   * @returns {Comment}
   */
  static fromRecord(row) {
    return new Comment({
      id: row.id,
      annotationId: row.annotationId,
      sheetId: row.sheetId,
      text: typeof row.detail === 'string' ? row.detail : '',
      author: Actor.fromJSON(row.actor),
      at: row.at,
      replyTo: typeof row.replyTo === 'string' ? row.replyTo : '',
    });
  }
}
