/**
 * The fact that a set of markups was issued in a flattened PDF.
 *
 * ===========================================================================
 * THIS RECORD IS THE LOCK
 * ===========================================================================
 * There is no `sealed` field anywhere on an annotation. "Sealed" is derived:
 * an annotation is sealed if some ExportRecord lists its id.
 *
 * That indirection is deliberate and it buys three things.
 *
 * 1. THE ANNOTATION MODEL DID NOT CHANGE. No new field on the base class, no
 *    edit to Pin, Rectangle, Cloud, Arrow, Ink or Text, no change to the JSON
 *    already sitting in users' browsers. The instruction was to add rather than
 *    to alter, and a derived lock is how that is actually achieved.
 *
 * 2. THE LOCK CANNOT DRIFT FROM THE TRUTH. A boolean is something a bug can
 *    flip. This is a statement that an export happened, with a timestamp and a
 *    list — it either happened or it did not.
 *
 * 3. IT IS ALREADY THE AUDIT TRAIL. The stakeholder asked to see who last
 *    touched an item. "Issued to the client by Fawaz on 18 September, with
 *    eleven other markups" is that answer, and it came for free.
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY FLATTENED EXPORTS SEAL
 * ---------------------------------------------------------------------------
 * A flattened export paints the markups into the page content. What the
 * recipient opens is a picture of the drawing as it stood — it cannot be
 * un-drawn, and no viewer will ever show it differently. That is a handover.
 *
 * A native export writes live PDF annotation objects, which any reader can
 * move or delete. It is a working copy, not an issue, so it does not seal.
 * `mode` records which happened, so the distinction stays visible in the data
 * rather than living only in this comment.
 */
export class ExportRecord {
  /** Flattened exports seal their contents. Native exports do not. */
  static MODE = Object.freeze({
    FLATTENED: 'flattened',
    NATIVE: 'native',
  });

  /**
   * @param {object} fields
   * @param {string} fields.id
   * @param {string} fields.documentName File the markups were issued from.
   * @param {string} fields.mode One of ExportRecord.MODE.
   * @param {string} fields.exportedAt ISO-8601, UTC.
   * @param {string} fields.exportedBy Display name. Becomes a user id in
   *        Sprint 2; kept as a string so that change is additive.
   * @param {Record<string, string[]>} fields.annotationIdsBySheet
   *        Sheet id -> the annotation ids issued on it. Grouped by sheet rather
   *        than a flat list so that "what was issued on this sheet?" — the
   *        question the editor actually asks, on every render — is a lookup
   *        instead of a scan.
   */
  constructor({ id, documentName, mode, exportedAt, exportedBy, annotationIdsBySheet }) {
    if (!Object.values(ExportRecord.MODE).includes(mode)) {
      // Loud, because a typo here would silently produce a record that seals
      // nothing, and the failure would only surface as "the lock did not work".
      throw new RangeError(
        `ExportRecord mode must be one of ${Object.values(ExportRecord.MODE).join(', ')} — received "${mode}".`,
      );
    }

    this.id = id;
    this.documentName = documentName;
    this.mode = mode;
    this.exportedAt = exportedAt;
    this.exportedBy = exportedBy;
    this.annotationIdsBySheet = annotationIdsBySheet;

    Object.freeze(this.annotationIdsBySheet);
    Object.freeze(this);
  }

  /** True when this export made its contents permanent. */
  get seals() {
    return this.mode === ExportRecord.MODE.FLATTENED;
  }

  /** @returns {string[]} Ids sealed on one sheet by this export. */
  idsForSheet(sheetId) {
    return this.annotationIdsBySheet[sheetId] ?? [];
  }

  /** Total markups covered, for the confirmation dialog's wording. */
  get annotationCount() {
    return Object.values(this.annotationIdsBySheet).reduce(
      (total, ids) => total + ids.length,
      0,
    );
  }

  /** Storage DTO. Flat and boring on purpose — this outlives the app. */
  toJSON() {
    return {
      id: this.id,
      documentName: this.documentName,
      mode: this.mode,
      exportedAt: this.exportedAt,
      exportedBy: this.exportedBy,
      annotationIdsBySheet: this.annotationIdsBySheet,
    };
  }

  /** @param {ReturnType<ExportRecord['toJSON']>} dto */
  static fromJSON(dto) {
    return new ExportRecord(dto);
  }
}
