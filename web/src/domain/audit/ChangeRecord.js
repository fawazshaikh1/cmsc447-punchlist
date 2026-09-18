/**
 * One thing somebody did to one annotation.
 *
 * ===========================================================================
 * ATTRIBUTION IS A RECORDED FACT, NOT A FIELD ON THE ANNOTATION
 * ===========================================================================
 * This is the same shape as `ExportRecord`, for the same reasons, and the
 * repetition is deliberate — it is the pattern this codebase uses whenever
 * something needs to be known ABOUT an annotation without being PART of one.
 *
 * The obvious alternative is `createdBy` / `updatedBy` / `updatedAt` columns on
 * `Annotation`. It fails on three counts:
 *
 * 1. IT WOULD MEAN EDITING THE MODEL TWICE. Once now to add nullable fields
 *    nothing fills, and again in Sprint 2 to fill them — plus every `with*`
 *    method on six markup types would have to remember to carry them through,
 *    and the one that forgot would silently lose the attribution on edit.
 * 2. IT ONLY REMEMBERS THE LAST CHANGE. The stakeholder asked for last-updated
 *    AND a full history (D14). Columns give the first; a log gives both, since
 *    "last updated by" is just the newest entry.
 * 3. IT CANNOT DESCRIBE WHAT CHANGED. "Rivera, 14:22" is less useful than
 *    "Rivera moved it, 14:22" when two people are working the same sheet.
 *
 * So nothing on the annotation changes, now or in Sprint 2. The log is written
 * beside it, and every question about who-did-what is a read of the log.
 *
 * ---------------------------------------------------------------------------
 * COMMENTS SLOT IN WITHOUT A SCHEMA CHANGE
 * ---------------------------------------------------------------------------
 * `intent` uses the same vocabulary as `EditPolicy.INTENT`, which already
 * includes `comment`. When threaded comments are built (FR-11), recording one
 * is this record with `intent: 'comment'` and the text in `detail`. No new
 * table, no migration, and "who commented" is answered by the same query that
 * already answers "who edited".
 */
export class ChangeRecord {
  /**
   * @param {object} fields
   * @param {string} fields.id
   * @param {string} fields.annotationId What was changed.
   * @param {string} fields.sheetId Denormalised so a sheet's activity is one
   *        read rather than a join against every annotation on it.
   * @param {string} fields.intent One of EditPolicy.INTENT — created, moved,
   *        updated, deleted, status, comment.
   * @param {import('../identity/Actor').Actor} fields.actor Who did it.
   * @param {string} fields.at ISO-8601, UTC.
   * @param {string} [fields.detail] Short human summary, e.g. 'Set status of'.
   *        Free text on purpose: it is for reading, never for branching on.
   */
  constructor({ id, annotationId, sheetId, intent, actor, at, detail = '' }) {
    this.id = id;
    this.annotationId = annotationId;
    this.sheetId = sheetId;
    this.intent = intent;
    this.actor = actor;
    this.at = at;
    this.detail = detail;
    Object.freeze(this);
  }

  /** `this device moved it` — the sentence the panel shows. */
  describe() {
    return `${this.actor.toString()} ${VERBS[this.intent] ?? 'changed'} it`;
  }

  toJSON() {
    return {
      id: this.id,
      annotationId: this.annotationId,
      sheetId: this.sheetId,
      intent: this.intent,
      // Stored as a snapshot, NOT as a reference. If someone changes their
      // display name or leaves a company, history must still say who made the
      // change at the time they made it — that is what an audit trail is for.
      actor: this.actor.toJSON(),
      at: this.at,
      detail: this.detail,
    };
  }

  /**
   * @param {ReturnType<ChangeRecord['toJSON']>} dto
   * @param {typeof import('../identity/Actor').Actor} ActorClass Injected so
   *        this module does not import Actor purely to reconstruct one — it
   *        keeps the record a pure data shape.
   */
  static fromJSON(dto, ActorClass) {
    return new ChangeRecord({ ...dto, actor: ActorClass.fromJSON(dto.actor) });
  }
}

/** Reads naturally after a name. Extend alongside EditPolicy.INTENT. */
const VERBS = Object.freeze({
  create: 'added',
  move: 'moved',
  update: 'edited',
  delete: 'deleted',
  status: 'changed the status of',
  comment: 'commented on',
});
